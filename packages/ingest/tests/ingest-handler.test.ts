import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
	type AuthConfig,
	eventTypes,
	MemoryObjectStore,
	sinkFromStore,
} from "@agentpond/core";
import {
	createIngestRequest,
	handleIngestionRequest,
	handleIngestRequest,
	handleOtelTracesRequest,
} from "@agentpond/ingest";

const auth: AuthConfig = {
	projectId: "project-a",
	publicKey: "pk",
	secretKey: "sk",
};

function authHeader(): string {
	return `Basic ${Buffer.from("pk:sk").toString("base64")}`;
}

test("pure ingest dispatcher no longer responds to health checks", async () => {
	const response = await handleIngestRequest(request("/health"), {
		auth,
		sink: sinkFromStore(new MemoryObjectStore()),
	});

	assert.equal(response.status, 404);
	assert.deepEqual(await response.json(), { error: "Not Found" });
});

test("createIngestRequest builds fetch requests from adapter-shaped inputs", async () => {
	const builtRequest = createIngestRequest({
		method: "POST",
		path: "api/public/ingestion?batch=1",
		query: "source=adapter",
		headers: {
			authorization: authHeader(),
			accept: ["application/json", "text/plain"],
			ignored: undefined,
		},
		body: Buffer.from("request-body"),
	});
	const url = new URL(builtRequest.url);

	assert.equal(url.pathname, "/api/public/ingestion");
	assert.equal(url.search, "?batch=1&source=adapter");
	assert.equal(builtRequest.headers.get("accept"), "application/json");
	assert.equal(builtRequest.headers.has("ignored"), false);
	assert.equal(await builtRequest.text(), "request-body");
});

test("createIngestRequest omits bodies for bodyless methods", async () => {
	const builtRequest = createIngestRequest({
		method: "GET",
		path: "/health",
		body: "ignored",
	});

	assert.equal(builtRequest.method, "GET");
	assert.equal(await builtRequest.text(), "");
});

test("pure ingest dispatcher routes JSON ingestion batches", async () => {
	const store = new MemoryObjectStore();
	const response = await handleIngestRequest(
		request("/api/public/ingestion", {
			method: "POST",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
			},
			body: JSON.stringify({
				batch: [
					{
						id: "event-handler-1",
						timestamp: "2026-06-14T00:00:00.000Z",
						type: eventTypes.TRACE_CREATE,
						body: { id: "trace-handler-1", name: "Handler Trace" },
					},
				],
			}),
		}),
		{ auth, sink: sinkFromStore(store) },
	);

	assert.equal(response.status, 207);
	assert.deepEqual((await response.json()).successes, [
		{ id: "event-handler-1", status: 201 },
	]);
	assert.equal((await store.listKeys("project-a/")).length > 0, true);
});

test("pure ingest dispatcher routes OTEL traces", async () => {
	const store = new MemoryObjectStore();
	const response = await handleIngestRequest(
		request("/api/public/otel/v1/traces", {
			method: "POST",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
				"x-langfuse-ingestion-version": "4",
			},
			body: JSON.stringify({ resourceSpans: [] }),
		}),
		{ auth, sink: sinkFromStore(store) },
	);

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {});
});

test("endpoint handler accepts JSON ingestion batches", async () => {
	const store = new MemoryObjectStore();
	const response = await handleIngestionRequest(
		request("/ignored-by-endpoint-handler", {
			method: "POST",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
			},
			body: JSON.stringify({
				batch: [
					{
						id: "event-endpoint-1",
						timestamp: "2026-06-14T00:00:00.000Z",
						type: eventTypes.TRACE_CREATE,
						body: { id: "trace-endpoint-1", name: "Endpoint Trace" },
					},
				],
			}),
		}),
		{ auth, sink: sinkFromStore(store) },
	);

	assert.equal(response.status, 207);
	assert.deepEqual((await response.json()).successes, [
		{ id: "event-endpoint-1", status: 201 },
	]);
	assert.equal((await store.listKeys("project-a/")).length > 0, true);
});

test("endpoint handler accepts gzip OTEL JSON and underscore version headers", async () => {
	const store = new MemoryObjectStore();
	const response = await handleOtelTracesRequest(
		request("/ignored-by-endpoint-handler", {
			method: "POST",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
				"content-encoding": "gzip",
				x_langfuse_ingestion_version: "4",
			},
			body: gzipSync(JSON.stringify({ resourceSpans: [] })),
		}),
		{ auth, sink: sinkFromStore(store) },
	);

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {});
});

test("pure ingest handler rejects invalid auth", async () => {
	const response = await handleIngestRequest(
		request("/api/public/ingestion", {
			method: "POST",
			headers: {
				authorization: `Basic ${Buffer.from("pk:wrong").toString("base64")}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ batch: [] }),
		}),
		{ auth, sink: sinkFromStore(new MemoryObjectStore()) },
	);

	assert.equal(response.status, 401);
	assert.equal((await response.json()).error, "UnauthorizedError");
});

test("pure ingest handler can disable auth for dev ingestion", async () => {
	const store = new MemoryObjectStore();
	const response = await handleIngestRequest(
		request("/api/public/ingestion", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				batch: [
					{
						id: "event-dev-1",
						timestamp: "2026-06-14T00:00:00.000Z",
						type: eventTypes.TRACE_CREATE,
						body: { id: "trace-dev-1", name: "Dev Trace" },
					},
				],
			}),
		}),
		{ auth: false, sink: sinkFromStore(store) },
	);

	assert.equal(response.status, 207);
	assert.equal((await store.listKeys("default-project/")).length > 0, true);
});

test("pure ingest dispatcher rejects unknown paths", async () => {
	const response = await handleIngestRequest(request("/api/public/unknown"), {
		auth,
		sink: sinkFromStore(new MemoryObjectStore()),
	});

	assert.equal(response.status, 404);
	assert.deepEqual(await response.json(), { error: "Not Found" });
});

function request(path: string, init: RequestInit = {}): Request {
	return new Request(`http://agentpond.local${path}`, init);
}
