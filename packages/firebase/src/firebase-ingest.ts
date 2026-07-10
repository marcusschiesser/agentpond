import { type AuthConfig, authFromRuntimeEnv } from "@agentpond/core";
import {
	createHttpIngestFunction,
	type GoogleHttpIngestFunction,
	type GoogleHttpRequest,
	type GoogleHttpResponse,
	type GoogleIngestFunctionOptions,
} from "@agentpond/google";
import { FirebaseStorageObjectStore } from "./firebase-storage.js";

export type FirebaseIngestFunctionOptions = Pick<
	GoogleIngestFunctionOptions,
	"auth" | "store" | "sink" | "logger" | "pathPrefix"
>;

export type FirebaseHttpRequest = GoogleHttpRequest;
export type FirebaseHttpResponse = GoogleHttpResponse;
export type FirebaseIngestFunction = GoogleHttpIngestFunction;

export function createFirebaseIngestFunction(
	options: FirebaseIngestFunctionOptions = {},
): FirebaseIngestFunction {
	const auth = options.auth ?? firebaseAuthFromRuntimeEnv();
	return createHttpIngestFunction({
		...options,
		auth,
		pathPrefix: options.pathPrefix ?? inferFirebasePathPrefix,
		...(options.sink
			? {}
			: {
					store: options.store ?? FirebaseStorageObjectStore.fromConfig(),
				}),
	});
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
