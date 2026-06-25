import { buildServer } from "@agentpond/ingest";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";

const server = buildServer();
await server.listen({ port, host });
