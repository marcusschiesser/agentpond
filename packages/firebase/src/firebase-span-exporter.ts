import { createFilesSpanExporter } from "@agentpond/files-sdk/otel";
import { configForInitializedFirebaseApp } from "./firebase-admin.js";
import {
	createFirebaseStorageStoreFromConfig,
	defaultFirebaseStoragePrefix,
} from "./firebase-storage.js";

export type FirebaseSpanExporterOptions = {
	prefix?: string;
};

export function createFirebaseSpanExporter(
	options: FirebaseSpanExporterOptions = {},
) {
	const { projectId, storageBucket } = configForInitializedFirebaseApp();
	const store = createFirebaseStorageStoreFromConfig({
		bucket: storageBucket,
	});
	return createFilesSpanExporter({
		store,
		projectId,
		prefix: options.prefix ?? defaultFirebaseStoragePrefix,
	});
}
