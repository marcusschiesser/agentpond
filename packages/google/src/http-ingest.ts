import {
	configFromEnv,
	type AgentPondConfig,
	type ObjectStore,
} from "@agentpond/core";
import {
	handleIngestRequest,
	type AuthMode,
	type IngestionLogger,
	type IngestionSink,
} from "@agentpond/ingest";
import { type GcsConfig, gcsConfigFromEnv, GcsObjectStore } from "./gcs.js";

export type GoogleIngestFunctionOptions = {
	config?: AgentPondConfig;
	store?: ObjectStore;
	gcs?: GcsConfig;
	authMode?: AuthMode;
	sink?: IngestionSink;
	logger?: IngestionLogger;
};

export type GoogleHttpRequest = {
	method?: string;
	path?: string;
	url?: string;
	originalUrl?: string;
	headers?: Record<string, string | string[] | undefined>;
	rawBody?: Buffer | Uint8Array | string;
	body?: Buffer | Uint8Array | string | unknown;
};

export type GoogleHttpResponse = {
	status: (code: number) => GoogleHttpResponse;
	set: (headers: Record<string, string>) => GoogleHttpResponse;
	send: (body: string) => unknown;
};

export type GoogleHttpIngestFunction = (
	req: GoogleHttpRequest,
	res: GoogleHttpResponse,
) => Promise<void>;

export function createHttpIngestFunction(
	options: GoogleIngestFunctionOptions = {},
): GoogleHttpIngestFunction {
	const config = options.config ?? configFromEnv();
	const store =
		options.store ??
		(options.sink
			? undefined
			: new GcsObjectStore(
					options.gcs ?? gcsConfigFromEnv(config.environment?.envFilePath),
				));

	return async (req, res) => {
		const response = await handleIngestRequest(
			{
				method: req.method ?? "GET",
				path: req.originalUrl ?? req.url ?? req.path ?? "/",
				headers: req.headers,
				body: requestBody(req),
			},
			{
				...options,
				config,
				store,
			},
		);
		res.status(response.status).set(response.headers).send(response.body);
	};
}

function requestBody(
	req: GoogleHttpRequest,
): Buffer | Uint8Array | string | undefined {
	const body = req.rawBody ?? req.body;
	if (
		body === undefined ||
		Buffer.isBuffer(body) ||
		body instanceof Uint8Array ||
		typeof body === "string"
	) {
		return body;
	}
	return JSON.stringify(body);
}

export const httpIngestFunction = createHttpIngestFunction();
