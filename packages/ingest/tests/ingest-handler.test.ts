import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
	type AgentPondConfig,
	eventTypes,
	MemoryObjectStore,
	sinkFromStore,
} from "@agentpond/core";
import { handleIngestRequest } from "@agentpond/ingest";

const config: AgentPondConfig = {
	projectId: "project-a",
	dbPath: "/tmp/agentpond-handler-test.duckdb",
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

test("pure ingest handler responds to health checks", async () => {
	const response = await handleIngestRequest({
		method: "GET",
		path: "/health",
	});

	assert.equal(response.status, 200);
	assert.deepEqual(JSON.parse(response.body), { ok: true });
});

test("pure ingest handler accepts JSON ingestion batches", async () => {
	const store = new MemoryObjectStore();
	const response = await handleIngestRequest(
		{
			method: "POST",
			path: "/api/public/ingestion",
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
		},
		{ config, sink: sinkFromStore(store) },
	);

	assert.equal(response.status, 207);
	assert.deepEqual(JSON.parse(response.body).successes, [
		{ id: "event-handler-1", status: 201 },
	]);
	assert.equal((await store.listKeys("project-a/")).length > 0, true);
});

test("pure ingest handler accepts gzip OTEL JSON and underscore version headers", async () => {
	const store = new MemoryObjectStore();
	const response = await handleIngestRequest(
		{
			method: "POST",
			path: "/api/public/otel/v1/traces",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
				"content-encoding": "gzip",
				x_langfuse_ingestion_version: "4",
			},
			body: gzipSync(JSON.stringify({ resourceSpans: [] })),
		},
		{ config, sink: sinkFromStore(store) },
	);

	assert.equal(response.status, 200);
	assert.deepEqual(JSON.parse(response.body), {});
});

test("pure ingest handler rejects invalid auth", async () => {
	const response = await handleIngestRequest(
		{
			method: "POST",
			path: "/api/public/ingestion",
			headers: {
				authorization: `Basic ${Buffer.from("pk:wrong").toString("base64")}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ batch: [] }),
		},
		{ config, sink: sinkFromStore(new MemoryObjectStore()) },
	);

	assert.equal(response.status, 401);
	assert.equal(JSON.parse(response.body).error, "UnauthorizedError");
});
