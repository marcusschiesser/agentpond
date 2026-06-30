import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { createLambdaIngestHandler, s3ConfigFromEnv } from "@agentpond/aws";
import {
	type AgentPondConfig,
	eventTypes,
	MemoryObjectStore,
	sinkFromStore,
} from "@agentpond/core";

const config: AgentPondConfig = {
	projectId: "project-a",
	dbPath: "/tmp/agentpond-aws-test.duckdb",
	prefix: "",
	auth: {
		projectId: "project-a",
		publicKey: "pk",
		secretKey: "sk",
	},
};

function authHeader(): string {
	return `Basic ${Buffer.from("pk:sk").toString("base64")}`;
}

test("S3 config reads provider settings from env files below process env", () => {
	const originalAccessKey = process.env.AWS_ACCESS_KEY_ID;
	const originalSecretKey = process.env.AWS_SECRET_ACCESS_KEY;
	const originalRegion = process.env.AWS_REGION;
	const envFile = join(
		mkdtempSync(join(tmpdir(), "agentpond-aws-")),
		"aws.env",
	);
	writeFileSync(
		envFile,
		[
			"AGENTPOND_S3_BUCKET=file-bucket",
			"AGENTPOND_S3_ENDPOINT=http://localhost:9000",
			"AGENTPOND_S3_REGION=us-east-1",
			"AGENTPOND_S3_ACCESS_KEY_ID=file-access",
			"AGENTPOND_S3_SECRET_ACCESS_KEY=file-secret",
			"AGENTPOND_S3_FORCE_PATH_STYLE=false",
			"",
		].join("\n"),
		"utf8",
	);

	try {
		delete process.env.AWS_ACCESS_KEY_ID;
		delete process.env.AWS_SECRET_ACCESS_KEY;
		delete process.env.AWS_REGION;

		assert.deepEqual(s3ConfigFromEnv(envFile), {
			bucket: "file-bucket",
			endpoint: "http://localhost:9000",
			region: "us-east-1",
			accessKeyId: "file-access",
			secretAccessKey: "file-secret",
			forcePathStyle: false,
		});

		process.env.AWS_ACCESS_KEY_ID = "process-access";
		process.env.AWS_SECRET_ACCESS_KEY = "process-secret";
		process.env.AWS_REGION = "eu-central-1";

		assert.deepEqual(s3ConfigFromEnv(envFile), {
			bucket: "file-bucket",
			endpoint: "http://localhost:9000",
			region: "eu-central-1",
			accessKeyId: "process-access",
			secretAccessKey: "process-secret",
			forcePathStyle: false,
		});
	} finally {
		restoreEnv("AWS_ACCESS_KEY_ID", originalAccessKey);
		restoreEnv("AWS_SECRET_ACCESS_KEY", originalSecretKey);
		restoreEnv("AWS_REGION", originalRegion);
	}
});

function restoreEnv(name: string, value: string | undefined): void {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

test("AWS Lambda ingest handler responds to health checks", async () => {
	const handler = createLambdaIngestHandler({
		config,
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
		config,
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
		config,
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
		config,
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
