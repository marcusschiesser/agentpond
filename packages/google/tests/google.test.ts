import assert from "node:assert/strict";
import test from "node:test";
import {
	type AuthConfig,
	eventTypes,
	MemoryObjectStore,
	sinkFromStore,
} from "@agentpond/core";
import {
	createHttpIngestFunction,
	GcsObjectStore,
	gcsConfigFromRuntimeEnv,
	googleAuthFromRuntimeEnv,
} from "@agentpond/google";

const auth: AuthConfig = {
	projectId: "project-a",
	publicKey: "pk",
	secretKey: "sk",
};

function authHeader(): string {
	return `Basic ${Buffer.from("pk:sk").toString("base64")}`;
}

test("GCS config reads provider settings from runtime env", () => {
	const originalBucket = process.env.AGENTPOND_GCS_BUCKET;

	try {
		delete process.env.AGENTPOND_GCS_BUCKET;

		assert.deepEqual(gcsConfigFromRuntimeEnv(), {
			bucket: "agentpond",
		});

		process.env.AGENTPOND_GCS_BUCKET = "runtime-bucket";

		assert.deepEqual(gcsConfigFromRuntimeEnv(), {
			bucket: "runtime-bucket",
		});
	} finally {
		if (originalBucket === undefined) {
			delete process.env.AGENTPOND_GCS_BUCKET;
		} else {
			process.env.AGENTPOND_GCS_BUCKET = originalBucket;
		}
	}
});

test("GCS object store can be created from explicit config", () => {
	const store = GcsObjectStore.fromConfig({ bucket: "configured-bucket" });

	assert.equal(store.config.bucket, "configured-bucket");
});

test("GCS object store writes, reads, and lists JSON objects", async () => {
	const objects = new Map<string, string>();
	const store = new GcsObjectStore(
		{ bucket: "agentpond" },
		{
			bucket: () => ({
				file: (name: string) => ({
					save: async (data: string, options: { contentType: string }) => {
						assert.equal(options.contentType, "application/json");
						objects.set(name, data);
					},
					download: async () => [Buffer.from(objects.get(name) ?? "", "utf8")],
				}),
				getFiles: async ({ prefix }: { prefix: string }) => [
					[...objects.keys()]
						.filter((key) => key.startsWith(prefix))
						.map((name) => ({ name })),
				],
			}),
		},
	);

	await store.putJson("project-a/trace/trace-1/event.json", { ok: true });
	await store.putJson("project-a/trace/trace-2/event.json", { ok: 2 });

	assert.deepEqual(await store.getJson("project-a/trace/trace-1/event.json"), {
		ok: true,
	});
	assert.deepEqual(await store.listKeys("project-a/trace/"), [
		"project-a/trace/trace-1/event.json",
		"project-a/trace/trace-2/event.json",
	]);
});

test("GCS object store can wrap an already-created bucket", async () => {
	const objects = new Map<string, string>();
	const store = GcsObjectStore.fromBucket(createBucket(objects));

	await store.putJson("project-a/trace/trace-1/event.json", { ok: true });

	assert.deepEqual(await store.getJson("project-a/trace/trace-1/event.json"), {
		ok: true,
	});
	assert.deepEqual(await store.listKeys("project-a/trace/"), [
		"project-a/trace/trace-1/event.json",
	]);
	assert.throws(
		() => store.config,
		/GCS config is not available for a pre-created bucket/,
	);
});

test("GCS object store creates sink with runtime prefix", async () => {
	const objects = new Map<string, string>();
	const store = new GcsObjectStore(
		{ bucket: "agentpond" },
		{
			bucket: () => ({
				file: (name: string) => ({
					save: async (data: string) => {
						objects.set(name, data);
					},
					download: async () => [Buffer.from(objects.get(name) ?? "", "utf8")],
				}),
				getFiles: async ({ prefix }: { prefix: string }) => [
					[...objects.keys()]
						.filter((key) => key.startsWith(prefix))
						.map((name) => ({ name })),
				],
			}),
		},
	);

	await store.toSink({ prefix: "prod" }).writeEvents({
		projectId: "project-a",
		events: [
			{
				id: "event-google-sink-1",
				timestamp: "2026-06-14T00:00:00.000Z",
				type: eventTypes.TRACE_CREATE,
				body: { id: "trace-google-sink-1" },
			},
		],
	});

	assert.equal((await store.listKeys("prod/project-a/")).length > 0, true);
});

test("Google auth reads Google Cloud project fallbacks from runtime env", () => {
	const runtimeEnv = {
		LANGFUSE_PUBLIC_KEY: "pk-runtime",
		LANGFUSE_SECRET_KEY: "sk-runtime",
		GCP_PROJECT: "gcp-project",
		GCLOUD_PROJECT: "gcloud-project",
	};

	assert.deepEqual(googleAuthFromRuntimeEnv(runtimeEnv), {
		projectId: "gcloud-project",
		publicKey: "pk-runtime",
		secretKey: "sk-runtime",
	});
	assert.deepEqual(
		googleAuthFromRuntimeEnv({
			...runtimeEnv,
			AGENTPOND_PROJECT_ID: "agentpond-project",
		}),
		{
			projectId: "agentpond-project",
			publicKey: "pk-runtime",
			secretKey: "sk-runtime",
		},
	);
});

test("Google HTTP ingest function leaves health checks unrouted", async () => {
	const fn = createHttpIngestFunction({
		auth,
		sink: sinkFromStore(new MemoryObjectStore()),
	});
	const res = createResponse();

	await fn({ method: "GET", url: "/health" }, res);

	assert.equal(res.statusCode, 404);
	assert.deepEqual(JSON.parse(res.body), { error: "Not Found" });
});

test("Google HTTP ingest function accepts JSON ingestion from rawBody", async () => {
	const store = new MemoryObjectStore();
	const fn = createHttpIngestFunction({ auth, sink: sinkFromStore(store) });
	const res = createResponse();

	await fn(
		{
			method: "POST",
			url: "/api/public/ingestion",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
			},
			rawBody: Buffer.from(
				JSON.stringify({
					batch: [
						{
							id: "event-google-1",
							timestamp: "2026-06-14T00:00:00.000Z",
							type: eventTypes.TRACE_CREATE,
							body: { id: "trace-google-1", name: "Google Trace" },
						},
					],
				}),
			),
		},
		res,
	);

	assert.equal(res.statusCode, 207);
	assert.deepEqual(JSON.parse(res.body).successes, [
		{ id: "event-google-1", status: 201 },
	]);
	assert.equal((await store.listKeys("project-a/")).length > 0, true);
});

test("Google HTTP ingest function accepts object stores", async () => {
	const store = new MemoryObjectStore();
	const fn = createHttpIngestFunction({ auth, store });
	const res = createResponse();

	await fn(
		{
			method: "POST",
			url: "/api/public/ingestion",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
			},
			rawBody: JSON.stringify({
				batch: [
					{
						id: "event-google-store-1",
						timestamp: "2026-06-14T00:00:00.000Z",
						type: eventTypes.TRACE_CREATE,
						body: { id: "trace-google-store-1" },
					},
				],
			}),
		},
		res,
	);

	assert.equal(res.statusCode, 207);
	assert.equal((await store.listKeys("project-a/")).length > 0, true);
});

test("Google HTTP ingest function rejects both store and sink", () => {
	assert.throws(
		() =>
			createHttpIngestFunction({
				store: new MemoryObjectStore(),
				sink: sinkFromStore(new MemoryObjectStore()),
			}),
		/AgentPond ingest options cannot include both store and sink/,
	);
});

test("Google HTTP ingest function strips configured path prefixes", async () => {
	const store = new MemoryObjectStore();
	const fn = createHttpIngestFunction({
		auth,
		sink: sinkFromStore(store),
		pathPrefix: "/agentPondIngest",
	});
	const res = createResponse();

	await fn(
		{
			method: "POST",
			originalUrl: "/agentPondIngest/api/public/ingestion?batch=1",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
			},
			rawBody: JSON.stringify({ batch: [] }),
		},
		res,
	);

	assert.equal(res.statusCode, 207);
	assert.deepEqual(JSON.parse(res.body), { successes: [], errors: [] });
});

test("Google HTTP ingest function accepts path prefix resolvers", async () => {
	const store = new MemoryObjectStore();
	const fn = createHttpIngestFunction({
		auth,
		sink: sinkFromStore(store),
		pathPrefix: (req) => {
			const rawPath = req.originalUrl ?? req.url ?? req.path ?? "/";
			const path = rawPath.split("?", 1)[0] || "/";
			const apiIndex = path.indexOf("/api/public/");
			return apiIndex > 0 ? path.slice(0, apiIndex) : undefined;
		},
	});
	const res = createResponse();

	await fn(
		{
			method: "POST",
			originalUrl: "/telemetryIngest/api/public/ingestion?batch=1",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
			},
			rawBody: JSON.stringify({ batch: [] }),
		},
		res,
	);

	assert.equal(res.statusCode, 207);
	assert.deepEqual(JSON.parse(res.body), { successes: [], errors: [] });
});

test("Google HTTP ingest function leaves unprefixed health unrouted when path prefixes are configured", async () => {
	const fn = createHttpIngestFunction({
		auth,
		sink: sinkFromStore(new MemoryObjectStore()),
		pathPrefix: "/agentPondIngest",
	});
	const res = createResponse();

	await fn({ method: "GET", url: "/health?ready=1" }, res);

	assert.equal(res.statusCode, 404);
	assert.deepEqual(JSON.parse(res.body), { error: "Not Found" });
});

test("Google HTTP ingest function forwards OTEL headers", async () => {
	const fn = createHttpIngestFunction({
		auth,
		sink: sinkFromStore(new MemoryObjectStore()),
	});
	const res = createResponse();

	await fn(
		{
			method: "POST",
			url: "/api/public/otel/v1/traces",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
				"x-langfuse-ingestion-version": "4",
			},
			rawBody: JSON.stringify({ resourceSpans: [] }),
		},
		res,
	);

	assert.equal(res.statusCode, 200);
	assert.deepEqual(JSON.parse(res.body), {});
});

test("Google HTTP ingest function maps auth errors", async () => {
	const fn = createHttpIngestFunction({
		auth,
		sink: sinkFromStore(new MemoryObjectStore()),
	});
	const res = createResponse();

	await fn(
		{
			method: "POST",
			url: "/api/public/ingestion",
			headers: {
				authorization: `Basic ${Buffer.from("pk:wrong").toString("base64")}`,
				"content-type": "application/json",
			},
			rawBody: JSON.stringify({ batch: [] }),
		},
		res,
	);

	assert.equal(res.statusCode, 401);
	assert.equal(JSON.parse(res.body).error, "UnauthorizedError");
});

function createResponse() {
	return {
		statusCode: 200,
		headers: {} as Record<string, string>,
		body: "",
		status(code: number) {
			this.statusCode = code;
			return this;
		},
		set(headers: Record<string, string>) {
			this.headers = { ...this.headers, ...headers };
			return this;
		},
		send(body: string) {
			this.body = body;
			return this;
		},
	};
}

function createBucket(objects: Map<string, string>) {
	return {
		file: (name: string) => ({
			save: async (data: string, options: { contentType: string }) => {
				assert.equal(options.contentType, "application/json");
				objects.set(name, data);
			},
			download: async () => [Buffer.from(objects.get(name) ?? "", "utf8")],
		}),
		getFiles: async ({ prefix }: { prefix: string }) => [
			[...objects.keys()]
				.filter((key) => key.startsWith(prefix))
				.map((name) => ({ name })),
		],
	};
}
