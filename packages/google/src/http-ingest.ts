import {
	type AgentPondConfig,
	type AuthConfig,
	authFromRuntimeEnv,
	sinkForConfig,
} from "@agentpond/core";
import {
	handleIngestRequest,
	type IngestionLogger,
	type IngestionSink,
} from "@agentpond/ingest";
import { GcsObjectStore } from "./gcs.js";

export type GoogleIngestFunctionOptions = {
	auth?: AuthConfig | false;
	sink?: IngestionSink;
	logger?: IngestionLogger;
	pathPrefix?: string | string[];
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
	const sink = options.sink ?? GcsObjectStore.fromRuntimeEnv().toSink();
	const auth = options.auth ?? googleAuthFromRuntimeEnv();

	return async (req, res) => {
		const response = await handleIngestRequest(
			{
				method: req.method ?? "GET",
				path: requestPath(req, options.pathPrefix),
				headers: req.headers,
				body: requestBody(req),
			},
			{
				...options,
				auth,
				sink,
			},
		);
		res.status(response.status).set(response.headers).send(response.body);
	};
}

export function googleAuthFromRuntimeEnv(
	env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
	return authFromRuntimeEnv({
		...env,
		AGENTPOND_PROJECT_ID:
			env.AGENTPOND_PROJECT_ID ?? env.GCLOUD_PROJECT ?? env.GCP_PROJECT,
	});
}

export function googleSinkForConfig(config: AgentPondConfig): IngestionSink {
	return sinkForConfig(config, {
		gcs: GcsObjectStore.fromEnvironment,
	});
}

function requestPath(
	req: GoogleHttpRequest,
	pathPrefix?: string | string[],
): string {
	const rawPath = req.originalUrl ?? req.url ?? req.path ?? "/";
	if (!pathPrefix) return rawPath;

	const path = rawPath.split("?", 1)[0] || "/";
	for (const prefix of normalizePathPrefixes(pathPrefix)) {
		const exactIndex = path === prefix ? 0 : -1;
		const segmentIndex = path.indexOf(`${prefix}/`);
		const index = exactIndex >= 0 ? exactIndex : segmentIndex;
		if (index < 0) continue;

		const suffix = path.slice(index + prefix.length);
		return suffix.startsWith("/") ? suffix : suffix ? `/${suffix}` : "/";
	}
	return path.startsWith("/") ? path : `/${path}`;
}

function normalizePathPrefixes(pathPrefix: string | string[]): string[] {
	const prefixes = Array.isArray(pathPrefix) ? pathPrefix : [pathPrefix];
	return prefixes
		.map((prefix) => {
			const withLeadingSlash = prefix.startsWith("/") ? prefix : `/${prefix}`;
			return withLeadingSlash.endsWith("/") && withLeadingSlash !== "/"
				? withLeadingSlash.slice(0, -1)
				: withLeadingSlash;
		})
		.filter((prefix) => prefix !== "/");
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
