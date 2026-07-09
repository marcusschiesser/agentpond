import {
	type AgentPondConfig,
	type AuthConfig,
	type ObjectStore,
	authFromRuntimeEnv,
	sinkForConfig,
} from "@agentpond/core";
import {
	createIngestRequest,
	handleIngestRequest,
	type IngestionLogger,
	type IngestionSink,
	resolveIngestionSink,
} from "@agentpond/ingest";
import { GcsObjectStore } from "./gcs.js";

export type GoogleIngestFunctionOptions = {
	auth?: AuthConfig | false;
	store?: ObjectStore;
	sink?: IngestionSink;
	logger?: IngestionLogger;
	pathPrefix?: string | string[] | GooglePathPrefixResolver;
};

export type GooglePathPrefixResolver = (
	req: GoogleHttpRequest,
) => string | string[] | undefined;

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
	const sink = resolveIngestionSink(options, () =>
		GcsObjectStore.fromRuntimeEnv(),
	);
	const auth = options.auth ?? googleAuthFromRuntimeEnv();

	return async (req, res) => {
		const path = requestPath(req, options.pathPrefix);
		const response = await handleIngestRequest(requestForGoogle(req, path), {
			...options,
			auth,
			sink,
		});
		res
			.status(response.status)
			.set(Object.fromEntries(response.headers.entries()))
			.send(await response.text());
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
	pathPrefix?: GoogleIngestFunctionOptions["pathPrefix"],
): string {
	const rawPath = req.originalUrl ?? req.url ?? req.path ?? "/";
	const resolvedPathPrefix =
		typeof pathPrefix === "function" ? pathPrefix(req) : pathPrefix;
	if (!resolvedPathPrefix) return rawPath;

	const path = rawPath.split("?", 1)[0] || "/";
	for (const prefix of normalizePathPrefixes(resolvedPathPrefix)) {
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

function requestForGoogle(req: GoogleHttpRequest, path: string): Request {
	return createIngestRequest({
		method: req.method ?? "GET",
		path,
		headers: req.headers,
		body: requestBody(req),
	});
}

export const httpIngestFunction = createHttpIngestFunction();
