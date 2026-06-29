import { S3ObjectStore } from "@agentpond/aws";
import {
	type AgentPondConfig,
	objectStoreForConfig as configuredObjectStoreForConfig,
	type ObjectStore,
} from "@agentpond/core";
import { GcsObjectStore } from "@agentpond/google";

export function objectStoreForConfig(config: AgentPondConfig): ObjectStore {
	return configuredObjectStoreForConfig(config, {
		gcs: GcsObjectStore.fromEnvironment,
		s3: S3ObjectStore.fromEnvironment,
	});
}
