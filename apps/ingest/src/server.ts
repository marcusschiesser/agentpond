import { gunzipSync } from "node:zlib";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import {
  AcceptedEventWriter,
  AuthError,
  configFromEnv,
  ingestionBatchSchema,
  otelBodyToEvents,
  S3ObjectStore,
  verifyBasicAuth,
  type ApertoConfig,
  type ObjectStore,
} from "@aperto/core";

export type BuildServerOptions = {
  config?: ApertoConfig;
  store?: ObjectStore;
};

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const config = options.config ?? configFromEnv();
  const store = options.store ?? new S3ObjectStore(config.s3);
  const server = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: 16 * 1024 * 1024 });

  server.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });
  server.addContentTypeParser("application/x-protobuf", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, body);
  });

  server.get("/health", async () => ({ ok: true }));

  server.post("/api/public/ingestion", async (request, reply) => {
    try {
      if (!config.auth) throw new AuthError("Auth is not configured");
      const auth = verifyBasicAuth(request.headers.authorization, config.auth);
      const payload = parseJsonBody(request.body, request.headers["content-encoding"]);
      const parsed = ingestionBatchSchema.safeParse(payload);

      if (!parsed.success) {
        return reply.status(400).send({
          message: "Invalid request data",
          errors: parsed.error.issues.map((issue) => issue.message),
        });
      }

      const writer = new AcceptedEventWriter({
        store,
        projectId: auth.projectId,
        prefix: config.s3.prefix,
      });
      const result = await writer.processBatch(parsed.data.batch);
      return reply.status(207).send(result);
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  server.post("/api/public/otel/v1/traces", async (request, reply) => {
    try {
      if (!config.auth) throw new AuthError("Auth is not configured");
      const auth = verifyBasicAuth(request.headers.authorization, config.auth);
      const ingestionVersion = readHeader(request.headers, "x-langfuse-ingestion-version");
      if (ingestionVersion) {
        const parsedVersion = Number.parseInt(ingestionVersion, 10);
        if (Number.isNaN(parsedVersion) || parsedVersion > 4) {
          return reply.status(400).send({
            error: `Unsupported x-langfuse-ingestion-version: "${ingestionVersion}". Maximum supported: "4".`,
          });
        }
      }

      const contentType = request.headers["content-type"];
      const events = await otelBodyToEvents({
        body: request.body,
        contentType: Array.isArray(contentType) ? contentType[0] : contentType,
        contentEncoding: headerToString(request.headers["content-encoding"]),
        projectId: auth.projectId,
      });
      if (events.length === 0) return reply.status(200).send({});

      const writer = new AcceptedEventWriter({
        store,
        projectId: auth.projectId,
        prefix: config.s3.prefix,
      });
      await writer.writeAcceptedEvents(events);
      return reply.status(200).send({});
    } catch (error) {
      return handleRouteError(error, reply);
    }
  });

  return server;
}

function parseJsonBody(body: unknown, contentEncoding: unknown): unknown {
  const encoding = headerToString(contentEncoding);
  let buffer: Buffer;
  if (Buffer.isBuffer(body)) {
    buffer = body;
  } else if (typeof body === "string") {
    buffer = Buffer.from(body);
  } else {
    return body;
  }

  if (encoding?.toLowerCase().includes("gzip")) {
    buffer = gunzipSync(buffer);
  }
  return JSON.parse(buffer.toString("utf8"));
}

function handleRouteError(error: unknown, reply: FastifyReply) {
  if (error instanceof AuthError) {
    return reply.status(error.status).send({ error: error.name, message: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Invalid content type")) {
    return reply.status(400).send({ error: "Invalid content type" });
  }
  if (message.includes("Failed to parse OTel")) {
    return reply.status(400).send({ error: message });
  }
  if (message.includes("JSON")) {
    return reply.status(400).send({ message: "Invalid request data", errors: [message] });
  }
  requestLogSafe(error);
  return reply.status(500).send({ error: "Internal Server Error", message });
}

function readHeader(headers: Record<string, unknown>, name: string): string | undefined {
  return headerToString(headers[name]) ?? headerToString(headers[name.replaceAll("-", "_")]);
}

function headerToString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function requestLogSafe(error: unknown): void {
  if (process.env.NODE_ENV === "test") return;
  console.error(error);
}
