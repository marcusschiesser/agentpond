import type { AuthConfig } from "@agentpond/core";
import { handleIngestRequest, type IngestionSink } from "@agentpond/ingest";
import Fastify, {
	type FastifyInstance,
	type FastifyLoggerOptions,
	type FastifyRequest,
} from "fastify";

export type BuildServerOptions = {
	sink: IngestionSink;
	auth?: AuthConfig | false;
	logger?: FastifyLoggerOptions;
};

export function buildServer(options: BuildServerOptions): FastifyInstance {
	const server = Fastify({
		logger: options.logger ?? process.env.NODE_ENV !== "test",
		bodyLimit: 16 * 1024 * 1024,
	});

	server.addContentTypeParser(
		"application/json",
		{ parseAs: "buffer" },
		(_request, body, done) => {
			done(null, body);
		},
	);
	server.addContentTypeParser(
		"application/x-protobuf",
		{ parseAs: "buffer" },
		(_request, body, done) => {
			done(null, body);
		},
	);

	server.route({
		method: ["GET", "POST"],
		url: "*",
		handler: async (request, reply) => {
			const response = await handleIngestRequest(
				{
					method: request.method,
					path: request.url,
					headers: request.headers,
					body: requestBody(request),
				},
				{
					...options,
					logger: request.log,
				},
			);
			for (const [name, value] of Object.entries(response.headers)) {
				reply.header(name, value);
			}
			return reply.status(response.status).send(response.body);
		},
	});

	return server;
}

function requestBody(request: FastifyRequest): Buffer | string | undefined {
	const body = request.body;
	if (Buffer.isBuffer(body)) return body;
	if (typeof body === "string") return body;
	if (body === undefined) return undefined;
	return Buffer.from(JSON.stringify(body));
}
