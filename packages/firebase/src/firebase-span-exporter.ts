import type { FilesClientOptions } from "@agentpond/files-sdk";
import { AgentPondSpanExporter } from "@agentpond/otel";
import { configForInitializedFirebaseApp } from "./firebase-admin.js";
import {
	createFirebaseStorageStoreFromConfig,
	defaultFirebaseStoragePrefix,
} from "./firebase-storage.js";

export type FirebaseSpanExporterOptions = FilesClientOptions & {
	prefix?: string;
};

export function createFirebaseSpanExporter(
	options: FirebaseSpanExporterOptions = {},
) {
	const { projectId, storageBucket } = configForInitializedFirebaseApp();
	const store = createFirebaseStorageStoreFromConfig({
		bucket: storageBucket,
		retries: options.retries,
		timeout: options.timeout,
	});
	return new AgentPondSpanExporter({
		store,
		projectId,
		prefix: options.prefix ?? defaultFirebaseStoragePrefix,
	});
}
