import { join } from "node:path";
import { S3ObjectStore, s3ConfigFromEnv } from "@agentpond/aws";
import {
	type AgentPondConfig,
	FileSystemObjectStore,
	type ObjectStore,
} from "@agentpond/core";
import { GcsObjectStore, gcsConfigFromEnv } from "@agentpond/google";

export function objectStoreForConfig(config: AgentPondConfig): ObjectStore {
	const storeType = config.environment?.storeType ?? "s3";
	if (storeType === "local") {
		const envDir = config.environment?.envDir;
		if (!envDir) {
			throw new Error("Local object storage requires an AgentPond environment");
		}
		return new FileSystemObjectStore(join(envDir, "events"));
	}
	if (storeType === "gcs") {
		return new GcsObjectStore(
			gcsConfigFromEnv(config.environment?.envFilePath),
		);
	}
	return new S3ObjectStore(s3ConfigFromEnv(config.environment?.envFilePath));
}
