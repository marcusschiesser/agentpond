import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
	createLambdaIngestHandler,
	S3ObjectStore,
	s3ConfigFromRuntimeEnv,
} from "@agentpond/aws";
import {
	type AuthConfig,
	eventTypes,
	MemoryObjectStore,
	sinkFromStore,
} from "@agentpond/core";

const auth: AuthConfig = {
	projectId: "project-a",
	publicKey: "pk",
	secretKey: "sk",
};

function authHeader(): string {
	return `Basic ${Buffer.from("pk:sk").toString("base64")}`;
}

test("S3 config reads provider settings from runtime env", () => {
	const originalBucket = process.env.AGENTPOND_S3_BUCKET;
	const originalEndpoint = process.env.AGENTPOND_S3_ENDPOINT;
	const originalS3Region = process.env.AGENTPOND_S3_REGION;
	const originalAccessKey = process.env.AWS_ACCESS_KEY_ID;
	const originalSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
	const originalRegion = process.env.AWS_REGION;
	const originalForcePathStyle = process.env.AGENTPOND_S3_FORCE_PATH_STYLE;

	try {
		process.env.AGENTPOND_S3_BUCKET = "runtime-bucket";
		process.env.AGENTPOND_S3_ENDPOINT = "http://localhost:9000";
		process.env.AGENTPOND_S3_REGION = "us-east-1";
		process.env.AWS_ACCESS_KEY_ID = "runtime-access";
		process.env.AWS_SECRET_ACCESS_KEY = "runtime-secret";
		process.env.AGENTPOND_S3_FORCE_PATH_STYLE = "false";

		assert.deepEqual(s3ConfigFromRuntimeEnv(), {
			bucket: "runtime-bucket",
			endpoint: "http://localhost:9000",
			region: "us-east-1",
			accessKeyId: "runtime-access",
			secretAccessKey: "runtime-secret",
			forcePathStyle: false,
		});

		process.env.AWS_REGION = "eu-central-1";

		assert.deepEqual(s3ConfigFromRuntimeEnv(), {
			bucket: "runtime-bucket",
			endpoint: "http://localhost:9000",
			region: "eu-central-1",
			accessKeyId: "runtime-access",
			secretAccessKey: "runtime-secret",
			forcePathStyle: false,
		});
	} finally {
		restoreEnv("AGENTPOND_S3_BUCKET", originalBucket);
		restoreEnv("AGENTPOND_S3_ENDPOINT", originalEndpoint);
		restoreEnv("AGENTPOND_S3_REGION", originalS3Region);
		restoreEnv("AWS_ACCESS_KEY_ID", originalAccessKey);
		restoreEnv("AWS_SECRET_ACCESS_KEY", originalSecretKey);
		restoreEnv("AWS_REGION", originalRegion);
		restoreEnv("AGENTPOND_S3_FORCE_PATH_STYLE", originalForcePathStyle);
	}
});

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

test("S3 object store creates sink with runtime prefix", async () => {
	const keys: string[] = [];
	const store = new S3ObjectStore({
		bucket: "agentpond",
		region: "us-east-1",
		forcePathStyle: true,
	});
	(
		store as unknown as {
			client: {
				send: (command: { input: { Key?: string } }) => Promise<unknown>;
			};
		}
	).client = {
		send: async (command) => {
			if (command.input.Key) keys.push(command.input.Key);
			return {};
		},
	};

	await store.toSink({ prefix: "prod" }).writeEvents({
		projectId: "project-a",
		events: [
			{
				id: "event-aws-sink-1",
				timestamp: "2026-06-14T00:00:00.000Z",
				type: eventTypes.TRACE_CREATE,
				body: { id: "trace-aws-sink-1" },
			},
		],
	});

	assert.equal(
		keys.every((key) => key.startsWith("prod/project-a/")),
		true,
	);
});

test("AWS Lambda ingest handler responds to health checks", async () => {
	const handler = createLambdaIngestHandler({
		auth,
		sink: sinkFromStore(new MemoryObjectStore()),
	});
	const response = await handler({
		rawPath: "/health",
		requestContext: { http: { method: "GET" } },
	});

	assert.equal(response.statusCode, 200);
	assert.deepEqual(JSON.parse(response.body), { ok: true });
	assert.equal(response.isBase64Encoded, false);
});

test("AWS Lambda ingest handler accepts JSON ingestion batches", async () => {
	const store = new MemoryObjectStore();
	const handler = createLambdaIngestHandler({
		auth,
		sink: sinkFromStore(store),
	});
	const response = await handler({
		rawPath: "/api/public/ingestion",
		requestContext: { http: { method: "POST" } },
		headers: {
			Authorization: authHeader(),
			"content-type": "application/json",
		},
		body: JSON.stringify({
			batch: [
				{
					id: "event-aws-1",
					timestamp: "2026-06-14T00:00:00.000Z",
					type: eventTypes.TRACE_CREATE,
					body: { id: "trace-aws-1", name: "AWS Trace" },
				},
			],
		}),
	});

	assert.equal(response.statusCode, 207);
	assert.deepEqual(JSON.parse(response.body).successes, [
		{ id: "event-aws-1", status: 201 },
	]);
	assert.equal((await store.listKeys("project-a/")).length > 0, true);
});

test("AWS Lambda ingest handler accepts base64 gzip OTEL JSON", async () => {
	const handler = createLambdaIngestHandler({
		auth,
		sink: sinkFromStore(new MemoryObjectStore()),
	});
	const response = await handler({
		rawPath: "/api/public/otel/v1/traces",
		requestContext: { http: { method: "POST" } },
		headers: {
			authorization: authHeader(),
			"content-type": "application/json",
			"content-encoding": "gzip",
			"x-langfuse-ingestion-version": "4",
		},
		body: gzipSync(JSON.stringify({ resourceSpans: [] })).toString("base64"),
		isBase64Encoded: true,
	});

	assert.equal(response.statusCode, 200);
	assert.deepEqual(JSON.parse(response.body), {});
});

test("AWS Lambda ingest handler maps auth errors", async () => {
	const handler = createLambdaIngestHandler({
		auth,
		sink: sinkFromStore(new MemoryObjectStore()),
	});
	const response = await handler({
		rawPath: "/api/public/ingestion",
		requestContext: { http: { method: "POST" } },
		headers: {
			authorization: `Basic ${Buffer.from("pk:wrong").toString("base64")}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({ batch: [] }),
	});

	assert.equal(response.statusCode, 401);
	assert.equal(JSON.parse(response.body).error, "UnauthorizedError");
});
