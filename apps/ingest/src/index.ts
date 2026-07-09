import { S3ObjectStore } from "@agentpond/aws";
import { configFromRuntimeEnv, sinkForRuntimeEnv } from "@agentpond/core";
import { buildServer } from "@agentpond/fastify-ingest";
import { GcsObjectStore } from "@agentpond/google";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";
const config = configFromRuntimeEnv();

const server = buildServer({
	auth: config.auth,
	sink: sinkForRuntimeEnv({
		gcs: GcsObjectStore.fromRuntimeEnv,
		s3: S3ObjectStore.fromRuntimeEnv,
	}),
});
await server.listen({ port, host });
