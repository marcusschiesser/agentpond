import {
	type AgentPondConfig,
	FileSystemObjectStore,
	type ObjectStore,
	S3ObjectStore,
} from "@agentpond/core";

export function objectStoreForConfig(config: AgentPondConfig): ObjectStore {
	if (config.environment?.storeType === "local") {
		return new FileSystemObjectStore(config.environment.eventStorePath);
	}
	return new S3ObjectStore(config.s3);
}
