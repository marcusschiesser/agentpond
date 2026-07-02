import { gunzipSync } from "node:zlib";
import {
	type AuthConfig,
	AuthError,
	authFromRuntimeEnv,
	bodyIdForEvent,
	type IngestionEvent,
	type IngestionSink,
	ingestionBatchSchema,
	otelBodyToResourceSpans,
	parseIngestionEvents,
	verifyBasicAuth,
} from "@agentpond/core";

export type { IngestionSink } from "@agentpond/core";

export type IngestionLogger = {
	info: (fields: Record<string, unknown>, message: string) => void;
};

export type IngestHandlerOptions = {
	auth?: AuthConfig | false;
	sink: IngestionSink;
	logger?: IngestionLogger;
};

const jsonHeaders = { "content-type": "application/json" };

export async function handleIngestRequest(
	request: Request,
	options: IngestHandlerOptions,
): Promise<Response> {
	const method = request.method.toUpperCase();
	if (method !== "POST") return jsonResponse(404, { error: "Not Found" });

	const path = new URL(request.url).pathname;
	if (path === "/api/public/ingestion") {
		return handleIngestionRequest(request, options);
	}
	if (path === "/api/public/otel/v1/traces") {
		return handleOtelTracesRequest(request, options);
	}

	return jsonResponse(404, { error: "Not Found" });
}

export async function handleIngestionRequest(
	request: Request,
	options: IngestHandlerOptions,
): Promise<Response> {
	if (request.method.toUpperCase() !== "POST") {
		return jsonResponse(404, { error: "Not Found" });
	}

	const requestAuth =
		options.auth === undefined ? authFromRuntimeEnv() : options.auth;
	const sink = sinkForOptions(options);
	const logger = options.logger ?? noopLogger;

	try {
		const auth = authenticateRequest(
			readHeader(request.headers, "authorization"),
			requestAuth,
		);
		const payload = parseJsonBody(
			await requestBody(request),
			readHeader(request.headers, "content-encoding"),
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

export async function handleOtelTracesRequest(
	request: Request,
	options: IngestHandlerOptions,
): Promise<Response> {
	if (request.method.toUpperCase() !== "POST") {
		return jsonResponse(404, { error: "Not Found" });
	}

	const requestAuth =
		options.auth === undefined ? authFromRuntimeEnv() : options.auth;
	const sink = sinkForOptions(options);
	const logger = options.logger ?? noopLogger;

	try {
		const auth = authenticateRequest(
			readHeader(request.headers, "authorization"),
			requestAuth,
		);
		const ingestionVersion = readHeader(
			request.headers,
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
			body: await requestBody(request),
			contentType: readHeader(request.headers, "content-type"),
			contentEncoding: readHeader(request.headers, "content-encoding"),
			projectId: auth.projectId,
		});
		if (resourceSpans.length === 0) return jsonResponse(200, {});

		await sink.writeOtelResourceSpans({
			projectId: auth.projectId,
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

function sinkForOptions(options: IngestHandlerOptions): IngestionSink {
	if (options.sink) return options.sink;
	throw new Error("AgentPond ingest requires a sink");
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
	auth: AuthConfig | false,
): { projectId: string; publicKey: string } {
	if (auth === false) {
		return {
			projectId: "default-project",
			publicKey: readBasicAuthPublicKey(authorization) ?? "pk-agentpond-dev",
		};
	}
	return verifyBasicAuth(authorization, auth);
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

async function requestBody(request: Request): Promise<Buffer> {
	return Buffer.from(await request.arrayBuffer());
}

function errorResponse(error: unknown): Response {
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

function readHeader(headers: Headers, name: string): string | undefined {
	return (
		headers.get(name) ?? headers.get(name.replaceAll("-", "_")) ?? undefined
	);
}

function headerToString(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (Array.isArray(value) && typeof value[0] === "string") return value[0];
	return undefined;
}

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: jsonHeaders,
	});
}

function requestLogSafe(error: unknown): void {
	if (process.env.NODE_ENV === "test") return;
	console.error(error);
}

const noopLogger: IngestionLogger = {
	info: () => undefined,
};
