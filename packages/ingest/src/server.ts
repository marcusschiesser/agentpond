import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { S3ObjectStore, s3ConfigFromEnv } from "@agentpond/aws";
import {
	type AgentPondConfig,
	AuthError,
	bodyIdForEvent,
	configFromEnv,
	FileSystemObjectStore,
	type IngestionEvent,
	ingestionBatchSchema,
	type ObjectStore,
	ObjectStoreIngestionSink,
	otelBodyToResourceSpans,
	parseIngestionEvents,
	verifyBasicAuth,
} from "@agentpond/core";
import { GcsObjectStore, gcsConfigFromEnv } from "@agentpond/google";
import Fastify, {
	type FastifyInstance,
	type FastifyLoggerOptions,
	type FastifyReply,
} from "fastify";

export type BuildServerOptions = {
	config?: AgentPondConfig;
	store?: ObjectStore;
	authMode?: "required" | "disabled";
	sink?: IngestionSink;
	logger?: FastifyLoggerOptions;
};

export type IngestionSink = {
	writeEvents: (params: {
		projectId: string;
		prefix: string;
		events: IngestionEvent[];
	}) => Promise<unknown>;
	writeOtelResourceSpans: (params: {
		projectId: string;
		prefix: string;
		resourceSpans: unknown[];
	}) => Promise<unknown>;
};

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
	const config = options.config ?? configFromEnv();
	const store = options.store ?? objectStoreForConfig(config);
	const prefix = config.prefix;
	const authMode = options.authMode ?? "required";
	const sink = options.sink ?? new ObjectStoreIngestionSink(store);
	const server = Fastify({
		logger: options.logger ?? process.env.NODE_ENV !== "test",
		bodyLimit: 16 * 1024 * 1024,
	});

	server.addContentTypeParser(
		"application/json",
		{ parseAs: "buffer" },
		(_request, body, done) => {
			done(null, body);
		},
	);
	server.addContentTypeParser(
		"application/x-protobuf",
		{ parseAs: "buffer" },
		(_request, body, done) => {
			done(null, body);
		},
	);

	server.get("/health", async () => ({ ok: true }));

	server.post("/api/public/ingestion", async (request, reply) => {
		try {
			const auth = authenticateRequest(
				request.headers.authorization,
				config,
				authMode,
			);
			const payload = parseJsonBody(
				request.body,
				request.headers["content-encoding"],
			);
			const parsed = ingestionBatchSchema.safeParse(payload);

			if (!parsed.success) {
				return reply.status(400).send({
					message: "Invalid request data",
					errors: parsed.error.issues.map((issue) => issue.message),
				});
			}

			const { events, errors } = parseIngestionEvents(parsed.data.batch);
			if (events.length > 0) {
				await sink.writeEvents({
					projectId: auth.projectId,
					prefix,
					events,
				});
				logIngestedEvents(request.log, {
					source: "ingestion",
					projectId: auth.projectId,
					events,
				});
			}
			return reply.status(207).send({
				successes: events.map((event) => ({ id: event.id, status: 201 })),
				errors,
			});
		} catch (error) {
			return handleRouteError(error, reply);
		}
	});

	server.post("/api/public/otel/v1/traces", async (request, reply) => {
		try {
			const auth = authenticateRequest(
				request.headers.authorization,
				config,
				authMode,
			);
			const ingestionVersion = readHeader(
				request.headers,
				"x-langfuse-ingestion-version",
			);
			if (ingestionVersion) {
				const parsedVersion = Number.parseInt(ingestionVersion, 10);
				if (Number.isNaN(parsedVersion) || parsedVersion > 4) {
					return reply.status(400).send({
						error: `Unsupported x-langfuse-ingestion-version: "${ingestionVersion}". Maximum supported: "4".`,
					});
				}
			}

			const contentType = request.headers["content-type"];
			const resourceSpans = await otelBodyToResourceSpans({
				body: request.body,
				contentType: Array.isArray(contentType) ? contentType[0] : contentType,
				contentEncoding: headerToString(request.headers["content-encoding"]),
				projectId: auth.projectId,
			});
			if (resourceSpans.length === 0) return reply.status(200).send({});

			await sink.writeOtelResourceSpans({
				projectId: auth.projectId,
				prefix,
				resourceSpans,
			});
			logIngestedOtelPayload(request.log, {
				projectId: auth.projectId,
				resourceSpanCount: resourceSpans.length,
			});
			return reply.status(200).send({});
		} catch (error) {
			return handleRouteError(error, reply);
		}
	});

	return server;
}

function objectStoreForConfig(config: AgentPondConfig): ObjectStore {
	const storeType = config.environment?.storeType ?? "s3";
	if (storeType === "local") {
		const envDir = config.environment?.envDir;
		if (!envDir) {
			throw new Error("Local object storage requires an AgentPond environment");
		}
		return new FileSystemObjectStore(join(envDir, "events"));
	}
	if (storeType === "gcs") {
		return new GcsObjectStore(
			gcsConfigFromEnv(config.environment?.envFilePath),
		);
	}
	return new S3ObjectStore(s3ConfigFromEnv(config.environment?.envFilePath));
}

type IngestionLogger = {
	info: (fields: Record<string, unknown>, message: string) => void;
};

function logIngestedEvents(
	logger: IngestionLogger,
	params: {
		source: "ingestion" | "otel";
		projectId: string;
		events: IngestionEvent[];
	},
): void {
	for (const event of params.events) {
		const entityId = bodyIdForEvent(event);
		logger.info(
			{
				source: params.source,
				projectId: params.projectId,
				eventId: event.id,
				eventType: event.type,
				...(entityId ? { entityId } : {}),
			},
			"ingested event",
		);
	}
}

function logIngestedOtelPayload(
	logger: IngestionLogger,
	params: { projectId: string; resourceSpanCount: number },
): void {
	logger.info(
		{
			source: "otel",
			projectId: params.projectId,
			resourceSpanCount: params.resourceSpanCount,
		},
		"ingested otel payload",
	);
}

function authenticateRequest(
	authorization: string | undefined,
	config: AgentPondConfig,
	authMode: "required" | "disabled",
): { projectId: string; publicKey: string } {
	if (authMode === "disabled") {
		return {
			projectId: config.projectId,
			publicKey: readBasicAuthPublicKey(authorization) ?? "pk-agentpond-dev",
		};
	}
	if (!config.auth) throw new AuthError("Auth is not configured");
	return verifyBasicAuth(authorization, config.auth);
}

function readBasicAuthPublicKey(
	authorization: string | undefined,
): string | undefined {
	if (!authorization?.startsWith("Basic ")) return undefined;
	const decoded = Buffer.from(
		authorization.slice("Basic ".length),
		"base64",
	).toString("utf8");
	const separator = decoded.indexOf(":");
	return separator >= 0 ? decoded.slice(0, separator) : decoded;
}

function parseJsonBody(body: unknown, contentEncoding: unknown): unknown {
	const encoding = headerToString(contentEncoding);
	let buffer: Buffer;
	if (Buffer.isBuffer(body)) {
		buffer = body;
	} else if (typeof body === "string") {
		buffer = Buffer.from(body);
	} else {
		return body;
	}

	if (encoding?.toLowerCase().includes("gzip")) {
		buffer = gunzipSync(buffer);
	}
	return JSON.parse(buffer.toString("utf8"));
}

function handleRouteError(error: unknown, reply: FastifyReply) {
	if (error instanceof AuthError) {
		return reply
			.status(error.status)
			.send({ error: error.name, message: error.message });
	}
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("Invalid content type")) {
		return reply.status(400).send({ error: "Invalid content type" });
	}
	if (message.includes("Failed to parse OTel")) {
		return reply.status(400).send({ error: message });
	}
	if (message.includes("JSON")) {
		return reply
			.status(400)
			.send({ message: "Invalid request data", errors: [message] });
	}
	requestLogSafe(error);
	return reply.status(500).send({ error: "Internal Server Error", message });
}

function readHeader(
	headers: Record<string, unknown>,
	name: string,
): string | undefined {
	return (
		headerToString(headers[name]) ??
		headerToString(headers[name.replaceAll("-", "_")])
	);
}

function headerToString(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (Array.isArray(value) && typeof value[0] === "string") return value[0];
	return undefined;
}

function requestLogSafe(error: unknown): void {
	if (process.env.NODE_ENV === "test") return;
	console.error(error);
}
