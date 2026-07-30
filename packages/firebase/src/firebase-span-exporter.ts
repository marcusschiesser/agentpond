import {
	type AgentPondContentPolicy,
	AgentPondSpanExporter,
} from "@agentpond/otel";
import { configForInitializedFirebaseApp } from "./firebase-admin.js";
import { FirebaseStorageObjectStore } from "./firebase-storage.js";

export type FirebaseSpanExporterOptions = {
	contentPolicy?: AgentPondContentPolicy;
	prefix?: string;
};

export function createFirebaseSpanExporter(
	options: FirebaseSpanExporterOptions = {},
): AgentPondSpanExporter {
	const { projectId, storageBucket } = configForInitializedFirebaseApp();
	const store = FirebaseStorageObjectStore.fromConfig({
		bucket: storageBucket,
		prefix: options.prefix,
	});
	return new AgentPondSpanExporter({
		contentPolicy: options.contentPolicy,
		store,
		projectId,
	});
}
