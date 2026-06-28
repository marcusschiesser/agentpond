import { join } from "node:path";
import { S3ObjectStore, s3ConfigFromEnv } from "@agentpond/aws";
import {
	type AgentPondConfig,
	configFromEnv,
	FileSystemObjectStore,
	type ObjectStore,
} from "@agentpond/core";
import { buildServer } from "@agentpond/fastify-ingest";
import { GcsObjectStore, gcsConfigFromEnv } from "@agentpond/google";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";
const config = configFromEnv();

const server = buildServer({ config, store: objectStoreForConfig(config) });
await server.listen({ port, host });

function objectStoreForConfig(config: AgentPondConfig): ObjectStore {
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
