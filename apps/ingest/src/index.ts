import { S3ObjectStore } from "@agentpond/aws";
import {
	type AgentPondConfig,
	configFromEnv,
	objectStoreForConfig as configuredObjectStoreForConfig,
	type ObjectStore,
} from "@agentpond/core";
import { buildServer } from "@agentpond/fastify-ingest";
import { GcsObjectStore } from "@agentpond/google";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";
const config = configFromEnv();

const server = buildServer({ config, store: objectStoreForConfig(config) });
await server.listen({ port, host });

function objectStoreForConfig(config: AgentPondConfig): ObjectStore {
	return configuredObjectStoreForConfig(config, {
		gcs: GcsObjectStore.fromEnvironment,
		s3: S3ObjectStore.fromEnvironment,
	});
}
