import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	type AgentPondConfig,
	eventTypes,
	MemoryObjectStore,
} from "@agentpond/core";
import {
	createHttpIngestFunction,
	GcsObjectStore,
	gcsConfigFromEnv,
} from "@agentpond/google";

const config: AgentPondConfig = {
	projectId: "project-a",
	dbPath: "/tmp/agentpond-google-test.duckdb",
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

test("GCS config reads provider settings from env files below process env", () => {
	const originalBucket = process.env.AGENTPOND_GCS_BUCKET;
	const envFile = join(
		mkdtempSync(join(tmpdir(), "agentpond-google-")),
		"google.env",
	);
	writeFileSync(envFile, "AGENTPOND_GCS_BUCKET=file-bucket\n", "utf8");

	try {
		delete process.env.AGENTPOND_GCS_BUCKET;

		assert.deepEqual(gcsConfigFromEnv(envFile), {
			bucket: "file-bucket",
		});

		process.env.AGENTPOND_GCS_BUCKET = "process-bucket";

		assert.deepEqual(gcsConfigFromEnv(envFile), {
			bucket: "process-bucket",
		});
	} finally {
		if (originalBucket === undefined) {
			delete process.env.AGENTPOND_GCS_BUCKET;
		} else {
			process.env.AGENTPOND_GCS_BUCKET = originalBucket;
		}
	}
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

test("Google HTTP ingest function responds to health checks", async () => {
	const fn = createHttpIngestFunction({
		config,
		store: new MemoryObjectStore(),
	});
	const res = createResponse();

	await fn({ method: "GET", url: "/health" }, res);

	assert.equal(res.statusCode, 200);
	assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test("Google HTTP ingest function accepts JSON ingestion from rawBody", async () => {
	const store = new MemoryObjectStore();
	const fn = createHttpIngestFunction({ config, store });
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

test("Google HTTP ingest function strips configured path prefixes", async () => {
	const store = new MemoryObjectStore();
	const fn = createHttpIngestFunction({
		config,
		store,
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

test("Google HTTP ingest function leaves unprefixed paths routable when path prefixes are configured", async () => {
	const fn = createHttpIngestFunction({
		config,
		store: new MemoryObjectStore(),
		pathPrefix: "/agentPondIngest",
	});
	const res = createResponse();

	await fn({ method: "GET", url: "/health?ready=1" }, res);

	assert.equal(res.statusCode, 200);
	assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test("Google HTTP ingest function forwards OTEL headers", async () => {
	const fn = createHttpIngestFunction({
		config,
		store: new MemoryObjectStore(),
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
		config,
		store: new MemoryObjectStore(),
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
