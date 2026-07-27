import { configFromRuntimeEnv } from "@agentpond/core";
import { buildServer } from "@agentpond/fastify-ingest";
import { FilesObjectStore } from "@agentpond/files-sdk";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";
const config = configFromRuntimeEnv();

const server = buildServer({
	auth: config.auth,
	sink: FilesObjectStore.fromRuntimeEnv().toSink({ prefix: config.prefix }),
});
await server.listen({ port, host });
