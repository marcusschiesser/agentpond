import { gunzipSync } from "node:zlib";
import {
	type AgentPondConfig,
	AuthError,
	bodyIdForEvent,
	configFromEnv,
	type IngestionEvent,
	ingestionBatchSchema,
	type ObjectStore,
	ObjectStoreIngestionSink,
	otelBodyToResourceSpans,
	parseIngestionEvents,
	verifyBasicAuth,
} from "@agentpond/core";

export type AuthMode = "required" | "disabled";

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

export type IngestionLogger = {
	info: (fields: Record<string, unknown>, message: string) => void;
};

export type IngestHandlerOptions = {
	config?: AgentPondConfig;
	store?: ObjectStore;
	authMode?: AuthMode;
	sink?: IngestionSink;
	logger?: IngestionLogger;
};

export type IngestHttpRequest = {
	method: string;
	path: string;
	query?: string;
	headers?: Record<string, unknown>;
	body?: Buffer | Uint8Array | string;
};

export type IngestHttpResponse = {
	status: number;
	headers: Record<string, string>;
	body: string;
};

const jsonHeaders = { "content-type": "application/json" };

export async function handleIngestRequest(
	request: IngestHttpRequest,
	options: IngestHandlerOptions = {},
): Promise<IngestHttpResponse> {
	const method = request.method.toUpperCase();
	const path = request.path.split("?", 1)[0];

	if (method === "GET" && path === "/health") {
		return jsonResponse(200, { ok: true });
	}
	if (method !== "POST") return jsonResponse(404, { error: "Not Found" });

	const config = options.config ?? configFromEnv();
	const authMode = options.authMode ?? "required";
	const sink = sinkForOptions(options);
	const logger = options.logger ?? noopLogger;

	if (path === "/api/public/ingestion") {
		try {
			const auth = authenticateRequest(
				readHeader(request.headers ?? {}, "authorization"),
				config,
				authMode,
			);
			const payload = parseJsonBody(
				request.body,
				readHeader(request.headers ?? {}, "content-encoding"),
			);
			const parsed = ingestionBatchSchema.safeParse(payload);

			if (!parsed.success) {
				return jsonResponse(400, {
					message: "Invalid request data",
					errors: parsed.error.issues.map((issue) => issue.message),
				});
			}

			const { events, errors } = parseIngestionEvents(parsed.data.batch);
			if (events.length > 0) {
				await sink.writeEvents({
					projectId: auth.projectId,
					prefix: config.prefix,
					events,
				});
				logIngestedEvents(logger, {
					source: "ingestion",
					projectId: auth.projectId,
					events,
				});
			}
			return jsonResponse(207, {
				successes: events.map((event) => ({ id: event.id, status: 201 })),
				errors,
			});
		} catch (error) {
			return errorResponse(error);
		}
	}

	if (path === "/api/public/otel/v1/traces") {
		try {
			const auth = authenticateRequest(
				readHeader(request.headers ?? {}, "authorization"),
				config,
				authMode,
			);
			const ingestionVersion = readHeader(
				request.headers ?? {},
				"x-langfuse-ingestion-version",
			);
			if (ingestionVersion) {
				const parsedVersion = Number.parseInt(ingestionVersion, 10);
				if (Number.isNaN(parsedVersion) || parsedVersion > 4) {
					return jsonResponse(400, {
						error: `Unsupported x-langfuse-ingestion-version: "${ingestionVersion}". Maximum supported: "4".`,
					});
				}
			}

			const resourceSpans = await otelBodyToResourceSpans({
				body: request.body,
				contentType: readHeader(request.headers ?? {}, "content-type"),
				contentEncoding: readHeader(request.headers ?? {}, "content-encoding"),
				projectId: auth.projectId,
			});
			if (resourceSpans.length === 0) return jsonResponse(200, {});

			await sink.writeOtelResourceSpans({
				projectId: auth.projectId,
				prefix: config.prefix,
				resourceSpans,
			});
			logIngestedOtelPayload(logger, {
				projectId: auth.projectId,
				resourceSpanCount: resourceSpans.length,
			});
			return jsonResponse(200, {});
		} catch (error) {
			return errorResponse(error);
		}
	}

	return jsonResponse(404, { error: "Not Found" });
}

function sinkForOptions(options: IngestHandlerOptions): IngestionSink {
	if (options.sink) return options.sink;
	if (options.store) return new ObjectStoreIngestionSink(options.store);
	throw new Error("AgentPond ingest requires either a store or a sink");
}

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
	authMode: AuthMode,
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

function parseJsonBody(
	body: Buffer | Uint8Array | string | undefined,
	contentEncoding: unknown,
): unknown {
	const encoding = headerToString(contentEncoding);
	let buffer: Buffer;
	if (Buffer.isBuffer(body)) {
		buffer = body;
	} else if (body instanceof Uint8Array) {
		buffer = Buffer.from(body);
	} else if (typeof body === "string") {
		buffer = Buffer.from(body);
	} else {
		buffer = Buffer.alloc(0);
	}

	if (encoding?.toLowerCase().includes("gzip")) {
		buffer = gunzipSync(buffer);
	}
	return JSON.parse(buffer.toString("utf8"));
}

function errorResponse(error: unknown): IngestHttpResponse {
	if (error instanceof AuthError) {
		return jsonResponse(error.status, {
			error: error.name,
			message: error.message,
		});
	}
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("Invalid content type")) {
		return jsonResponse(400, { error: "Invalid content type" });
	}
	if (message.includes("Failed to parse OTel")) {
		return jsonResponse(400, { error: message });
	}
	if (message.includes("JSON")) {
		return jsonResponse(400, {
			message: "Invalid request data",
			errors: [message],
		});
	}
	requestLogSafe(error);
	return jsonResponse(500, { error: "Internal Server Error", message });
}

function readHeader(
	headers: Record<string, unknown>,
	name: string,
): string | undefined {
	const lowerName = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lowerName) return headerToString(value);
	}
	const underscoreName = name.replaceAll("-", "_").toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === underscoreName) return headerToString(value);
	}
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

function jsonResponse(status: number, body: unknown): IngestHttpResponse {
	return {
		status,
		headers: jsonHeaders,
		body: JSON.stringify(body),
	};
}

function requestLogSafe(error: unknown): void {
	if (process.env.NODE_ENV === "test") return;
	console.error(error);
}

const noopLogger: IngestionLogger = {
	info: () => undefined,
};
