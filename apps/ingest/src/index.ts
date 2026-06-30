import { S3ObjectStore } from "@agentpond/aws";
import {
	type AgentPondConfig,
	configFromEnv,
	sinkForConfig as configuredSinkForConfig,
	type IngestionSink,
} from "@agentpond/core";
import { buildServer } from "@agentpond/fastify-ingest";
import { GcsObjectStore } from "@agentpond/google";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";
const config = configFromEnv();

const server = buildServer({
	auth: config.auth,
	sink: ingestionSinkForConfig(config),
});
await server.listen({ port, host });

function ingestionSinkForConfig(config: AgentPondConfig): IngestionSink {
	return configuredSinkForConfig(config, {
		gcs: GcsObjectStore.fromEnvironment,
		s3: S3ObjectStore.fromEnvironment,
	});
}
