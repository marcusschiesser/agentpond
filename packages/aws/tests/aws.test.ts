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
	const originalEnv = saveEnv(AWS_ENV_KEYS);

	try {
		clearEnv(AWS_ENV_KEYS);
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
			requestChecksumCalculation: undefined,
			responseChecksumValidation: undefined,
		});

		process.env.AWS_REGION = "eu-central-1";
		process.env.AGENTPOND_S3_REQUEST_CHECKSUM_CALCULATION = "WHEN_REQUIRED";
		process.env.AGENTPOND_S3_RESPONSE_CHECKSUM_VALIDATION = "WHEN_REQUIRED";

		assert.deepEqual(s3ConfigFromRuntimeEnv(), {
			bucket: "runtime-bucket",
			endpoint: "http://localhost:9000",
			region: "eu-central-1",
			accessKeyId: "runtime-access",
			secretAccessKey: "runtime-secret",
			forcePathStyle: false,
			requestChecksumCalculation: "WHEN_REQUIRED",
			responseChecksumValidation: "WHEN_REQUIRED",
		});
	} finally {
		restoreEnv(originalEnv);
	}
});

test("S3 config rejects invalid checksum env settings", () => {
	const originalEnv = saveEnv(AWS_ENV_KEYS);

	try {
		clearEnv(AWS_ENV_KEYS);
		process.env.AGENTPOND_S3_REQUEST_CHECKSUM_CALCULATION = "always";
		assert.throws(
			() => s3ConfigFromRuntimeEnv(),
			/AGENTPOND_S3_REQUEST_CHECKSUM_CALCULATION must be "WHEN_SUPPORTED" or "WHEN_REQUIRED"/,
		);

		delete process.env.AGENTPOND_S3_REQUEST_CHECKSUM_CALCULATION;
		process.env.AGENTPOND_S3_RESPONSE_CHECKSUM_VALIDATION = "never";
		assert.throws(
			() => s3ConfigFromRuntimeEnv(),
			/AGENTPOND_S3_RESPONSE_CHECKSUM_VALIDATION must be "WHEN_SUPPORTED" or "WHEN_REQUIRED"/,
		);
	} finally {
		restoreEnv(originalEnv);
	}
});

test("S3 object store passes checksum settings to AWS SDK client", async () => {
	const store = new S3ObjectStore({
		bucket: "agentpond",
		region: "us-east-1",
		requestChecksumCalculation: "WHEN_REQUIRED",
		responseChecksumValidation: "WHEN_REQUIRED",
	});
	const client = (
		store as unknown as {
			client: {
				config: {
					requestChecksumCalculation: () => Promise<string>;
					responseChecksumValidation: () => Promise<string>;
				};
			};
		}
	).client;

	assert.equal(
		await client.config.requestChecksumCalculation(),
		"WHEN_REQUIRED",
	);
	assert.equal(
		await client.config.responseChecksumValidation(),
		"WHEN_REQUIRED",
	);
});

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

test("S3 object store can be created from explicit AWS config", async () => {
	const originalEnv = saveEnv(AWS_ENV_KEYS);
	const keys: string[] = [];
	try {
		clearEnv(AWS_ENV_KEYS);
		const store = S3ObjectStore.fromConfig({
			bucket: "configured-bucket",
			region: "us-east-1",
		});
		(
			store as unknown as {
				client: {
					send: (command: {
						input: { Bucket?: string; Key?: string };
					}) => Promise<unknown>;
				};
			}
		).client = {
			send: async (command) => {
				assert.equal(command.input.Bucket, "configured-bucket");
				if (command.input.Key) keys.push(command.input.Key);
				return {};
			},
		};

		await store.toSink().writeEvents({
			projectId: "project-a",
			events: [
				{
					id: "event-aws-config-1",
					timestamp: "2026-06-14T00:00:00.000Z",
					type: eventTypes.TRACE_CREATE,
					body: { id: "trace-aws-config-1" },
				},
			],
		});

		assert.equal(
			keys.every((key) => key.startsWith("project-a/")),
			true,
		);
	} finally {
		restoreEnv(originalEnv);
	}
});

test("S3 object store follows GetObject redirects", async () => {
	const originalFetch = globalThis.fetch;
	const store = S3ObjectStore.fromConfig({
		bucket: "configured-bucket",
		region: "us-east-1",
	});
	(
		store as unknown as {
			client: {
				send: () => Promise<unknown>;
			};
		}
	).client = {
		send: async () => {
			throw {
				$response: {
					statusCode: 302,
					headers: {
						location: "https://cdn.example.test/object.json",
					},
				},
			};
		},
	};
	globalThis.fetch = async (input) => {
		assert.equal(input, "https://cdn.example.test/object.json");
		return new Response(JSON.stringify({ ok: true }));
	};

	try {
		assert.deepEqual(await store.getJson("object.json"), { ok: true });
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("AWS Lambda ingest handler leaves health checks unrouted", async () => {
	const handler = createLambdaIngestHandler({
		auth,
		sink: sinkFromStore(new MemoryObjectStore()),
	});
	const response = await handler({
		rawPath: "/health",
		requestContext: { http: { method: "GET" } },
	});

	assert.equal(response.statusCode, 404);
	assert.deepEqual(JSON.parse(response.body), { error: "Not Found" });
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

test("AWS Lambda ingest handler accepts object stores", async () => {
	const store = new MemoryObjectStore();
	const handler = createLambdaIngestHandler({ auth, store });
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
					id: "event-aws-store-1",
					timestamp: "2026-06-14T00:00:00.000Z",
					type: eventTypes.TRACE_CREATE,
					body: { id: "trace-aws-store-1" },
				},
			],
		}),
	});

	assert.equal(response.statusCode, 207);
	assert.equal((await store.listKeys("project-a/")).length > 0, true);
});

test("AWS Lambda ingest handler rejects both store and sink", () => {
	assert.throws(
		() =>
			createLambdaIngestHandler({
				store: new MemoryObjectStore(),
				sink: sinkFromStore(new MemoryObjectStore()),
			}),
		/AgentPond ingest options cannot include both store and sink/,
	);
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

const AWS_ENV_KEYS = [
	"AGENTPOND_PREFIX",
	"AGENTPOND_S3_BUCKET",
	"AGENTPOND_S3_ENDPOINT",
	"AGENTPOND_S3_REGION",
	"AGENTPOND_S3_ACCESS_KEY_ID",
	"AGENTPOND_S3_SECRET_ACCESS_KEY",
	"AGENTPOND_S3_FORCE_PATH_STYLE",
	"AGENTPOND_S3_REQUEST_CHECKSUM_CALCULATION",
	"AGENTPOND_S3_RESPONSE_CHECKSUM_VALIDATION",
	"AGENTPOND_S3_PREFIX",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_REGION",
] as const;

type AwsEnvKey = (typeof AWS_ENV_KEYS)[number];
type EnvSnapshot = Map<AwsEnvKey, string | undefined>;

function saveEnv(keys: readonly AwsEnvKey[]): EnvSnapshot {
	return new Map(keys.map((key) => [key, process.env[key]]));
}

function clearEnv(keys: readonly AwsEnvKey[]): void {
	for (const key of keys) {
		delete process.env[key];
	}
}

function restoreEnv(snapshot: EnvSnapshot): void {
	for (const [key, value] of snapshot) {
		if (value === undefined) {
			delete process.env[key];
			continue;
		}
		process.env[key] = value;
	}
}
