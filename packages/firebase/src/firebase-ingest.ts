import {
	type AuthConfig,
	authFromRuntimeEnv,
	type ObjectStore,
} from "@agentpond/core";
import {
	createIngestRequest,
	handleIngestRequest,
	type IngestionLogger,
	type IngestionSink,
	resolveIngestionSink,
} from "@agentpond/ingest";
import { FirebaseStorageObjectStore } from "./firebase-storage.js";

export type FirebaseIngestFunctionOptions = {
	auth?: AuthConfig | false;
	store?: ObjectStore;
	sink?: IngestionSink;
	logger?: IngestionLogger;
	pathPrefix?: string | string[] | FirebasePathPrefixResolver;
};

export type FirebasePathPrefixResolver = (
	req: FirebaseHttpRequest,
) => string | string[] | undefined;

export type FirebaseHttpRequest = {
	method?: string;
	path?: string;
	url?: string;
	originalUrl?: string;
	headers?: Record<string, string | string[] | undefined>;
	rawBody?: Buffer | Uint8Array | string;
	body?: Buffer | Uint8Array | string | unknown;
};

export type FirebaseHttpResponse = {
	status: (code: number) => FirebaseHttpResponse;
	set: (headers: Record<string, string>) => FirebaseHttpResponse;
	send: (body: string) => unknown;
};

export type FirebaseIngestFunction = (
	req: FirebaseHttpRequest,
	res: FirebaseHttpResponse,
) => Promise<void>;

export function createFirebaseIngestFunction(
	options: FirebaseIngestFunctionOptions = {},
): FirebaseIngestFunction {
	const auth = options.auth ?? firebaseAuthFromRuntimeEnv();
	const sink = resolveIngestionSink(options, () =>
		FirebaseStorageObjectStore.fromConfig(),
	);
	const pathPrefix = options.pathPrefix ?? inferFirebasePathPrefix;

	return async (req, res) => {
		const path = requestPath(req, pathPrefix);
		const response = await handleIngestRequest(
			createIngestRequest({
				method: req.method ?? "GET",
				path,
				headers: req.headers,
				body: requestBody(req),
			}),
			{
				...options,
				auth,
				sink,
			},
		);
		res
			.status(response.status)
			.set(Object.fromEntries(response.headers.entries()))
			.send(await response.text());
	};
}

function inferFirebasePathPrefix(req: FirebaseHttpRequest): string | undefined {
	const rawPath = req.originalUrl ?? req.url ?? req.path ?? "/";
	const path = rawPath.split("?", 1)[0] || "/";
	const apiIndex = path.indexOf("/api/public/");
	if (apiIndex <= 0) return undefined;
	return path.slice(0, apiIndex);
}

export function firebaseAuthFromRuntimeEnv(
	env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
	return authFromRuntimeEnv({
		...env,
		AGENTPOND_PROJECT_ID:
			env.AGENTPOND_PROJECT_ID ?? env.GCLOUD_PROJECT ?? env.GCP_PROJECT,
	});
}

export const firebaseIngestFunction: FirebaseIngestFunction = async (
	req,
	res,
) => createFirebaseIngestFunction()(req, res);

function requestPath(
	req: FirebaseHttpRequest,
	pathPrefix: FirebaseIngestFunctionOptions["pathPrefix"],
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
	req: FirebaseHttpRequest,
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
