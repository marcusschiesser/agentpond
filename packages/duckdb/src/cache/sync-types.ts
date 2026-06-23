import type { ObjectStore } from "@agentpond/core";

export type SyncResult = {
	manifestsProcessed: number;
	objectsProcessed: number;
	eventsProcessed: number;
};

export type SyncProgress = SyncResult & {
	manifestsTotal: number;
	manifestsSeen: number;
	manifestsSkipped: number;
	objectsSkipped: number;
	phase:
		| "listed"
		| "manifest-skipped"
		| "manifest-processed"
		| "object-skipped"
		| "object-processed"
		| "events-processed"
		| "complete";
	currentManifestKey?: string;
	currentObjectKey?: string;
};

export type SyncFromStoreParams = {
	store: ObjectStore;
	projectId: string;
	prefix: string;
	onProgress?: (progress: SyncProgress) => void;
};
