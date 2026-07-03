import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
	type AgentPondConfig,
	eventTypes,
	type IngestionEvent,
	MemoryObjectStore,
	otelBodyToEvents,
	sinkFromStore,
} from "@agentpond/core";
import { AgentPondCache, DuckDbIngestionSink } from "@agentpond/duckdb";
import { buildServer } from "@agentpond/fastify-ingest";
import type { FastifyLoggerOptions } from "fastify";
import protobuf from "protobufjs";

const config: AgentPondConfig = {
	projectId: "project-a",
	dbPath: "/tmp/agentpond-test.duckdb",
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

async function postOtelJson(
	store: MemoryObjectStore,
	payload: unknown,
	headers: Record<string, string> = {},
) {
	const server = buildServer({
		auth: config.auth,
		sink: sinkFromStore(store),
	});
	try {
		return await server.inject({
			method: "POST",
			url: "/api/public/otel/v1/traces",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
				"x-langfuse-ingestion-version": "4",
				...headers,
			},
			payload: JSON.stringify(payload),
		});
	} finally {
		await server.close();
	}
}

async function convertOtelJson(payload: unknown) {
	return otelBodyToEvents({
		body: JSON.stringify(payload),
		contentType: "application/json",
		projectId: "project-a",
	});
}

function otelPayload(
	spans: Array<Record<string, unknown>>,
): Record<string, unknown> {
	return { resourceSpans: [{ scopeSpans: [{ spans }] }] };
}

function attr(key: string, value: unknown): Record<string, unknown> {
	if (typeof value === "string") return { key, value: { stringValue: value } };
	if (typeof value === "boolean") return { key, value: { boolValue: value } };
	if (typeof value === "number") return { key, value: { doubleValue: value } };
	if (Array.isArray(value))
		return {
			key,
			value: {
				arrayValue: {
					values: value.map((item) => ({ stringValue: String(item) })),
				},
			},
		};
	return { key, value: { stringValue: JSON.stringify(value) } };
}

function observationEvent(events: IngestionEvent[]): IngestionEvent {
	const event = events.find(
		(event) =>
			event.type.endsWith("-create") && event.type !== eventTypes.TRACE_CREATE,
	);
	assert.ok(event);
	return event;
}

type CapturedLog = Record<string, unknown>;

function captureLogger(logs: CapturedLog[]): FastifyLoggerOptions {
	return {
		level: "info",
		stream: {
			write(line: string) {
				logs.push(JSON.parse(line) as CapturedLog);
			},
		},
	};
}

function ingestedEventLogs(
	logs: CapturedLog[],
): Array<Record<string, unknown>> {
	return logs
		.filter((log) => log.msg === "ingested event")
		.map(({ source, projectId, eventId, eventType, entityId }) => ({
			source,
			projectId,
			eventId,
			eventType,
			...(entityId ? { entityId } : {}),
		}));
}

function ingestedOtelPayloadLogs(
	logs: CapturedLog[],
): Array<Record<string, unknown>> {
	return logs
		.filter((log) => log.msg === "ingested otel payload")
		.map(({ source, projectId, resourceSpanCount }) => ({
			source,
			projectId,
			resourceSpanCount,
		}));
}

test("server responds to health checks", async () => {
	const server = buildServer({
		auth: config.auth,
		sink: sinkFromStore(new MemoryObjectStore()),
	});
	const response = await server.inject({
		method: "GET",
		url: "/health?ready=1",
	});

	assert.equal(response.statusCode, 200);
	assert.deepEqual(response.json(), { ok: true });
	await server.close();
});

test("ingestion endpoint validates auth and returns 207 batch result", async () => {
	const store = new MemoryObjectStore();
	const server = buildServer({
		auth: config.auth,
		sink: sinkFromStore(store),
	});
	const response = await server.inject({
		method: "POST",
		url: "/api/public/ingestion",
		headers: {
			authorization: authHeader(),
			"content-type": "application/json",
		},
		payload: JSON.stringify({
			batch: [
				{
					id: "event-1",
					timestamp: "2026-06-14T00:00:00.000Z",
					type: "trace-create",
					body: { id: "trace-1", name: "Trace 1" },
				},
			],
		}),
	});

	assert.equal(response.statusCode, 207);
	assert.deepEqual(response.json().successes, [{ id: "event-1", status: 201 }]);
	assert.equal((await store.listKeys("project-a/manifests/")).length, 1);
	await server.close();
});

test("ingestion endpoint logs each accepted event", async () => {
	const logs: CapturedLog[] = [];
	const store = new MemoryObjectStore();
	const server = buildServer({
		auth: config.auth,
		sink: sinkFromStore(store),
		logger: captureLogger(logs),
	});
	const response = await server.inject({
		method: "POST",
		url: "/api/public/ingestion",
		headers: {
			authorization: authHeader(),
			"content-type": "application/json",
		},
		payload: JSON.stringify({
			batch: [
				{
					id: "event-log-trace",
					timestamp: "2026-06-14T00:00:00.000Z",
					type: eventTypes.TRACE_CREATE,
					body: { id: "trace-log", name: "Trace Log" },
				},
				{
					id: "event-log-score",
					timestamp: "2026-06-14T00:00:01.000Z",
					type: eventTypes.SCORE_CREATE,
					body: {
						id: "score-log",
						traceId: "trace-log",
						name: "quality",
						value: 1,
						source: "API",
					},
				},
				{
					id: "event-log-invalid",
					timestamp: "2026-06-14T00:00:02.000Z",
					type: "not-supported",
					body: { id: "invalid-log" },
				},
			],
		}),
	});

	assert.equal(response.statusCode, 207);
	assert.deepEqual(ingestedEventLogs(logs), [
		{
			source: "ingestion",
			projectId: "project-a",
			eventId: "event-log-trace",
			eventType: eventTypes.TRACE_CREATE,
			entityId: "trace-log",
		},
		{
			source: "ingestion",
			projectId: "project-a",
			eventId: "event-log-score",
			eventType: eventTypes.SCORE_CREATE,
			entityId: "score-log",
		},
	]);
	await server.close();
});

test("ingestion endpoint accepts empty batches without writing a manifest", async () => {
	const store = new MemoryObjectStore();
	const server = buildServer({
		auth: config.auth,
		sink: sinkFromStore(store),
	});
	const response = await server.inject({
		method: "POST",
		url: "/api/public/ingestion",
		headers: {
			authorization: authHeader(),
			"content-type": "application/json",
		},
		payload: JSON.stringify({ batch: [] }),
	});

	assert.equal(response.statusCode, 207);
	assert.deepEqual(response.json(), { successes: [], errors: [] });
	assert.deepEqual(await store.listKeys("project-a/"), []);
	await server.close();
});

test("ingestion endpoint rejects missing or non-array batches", async () => {
	for (const payload of [{}, { batch: {} }]) {
		const store = new MemoryObjectStore();
		const server = buildServer({
			auth: config.auth,
			sink: sinkFromStore(store),
		});
		const response = await server.inject({
			method: "POST",
			url: "/api/public/ingestion",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
			},
			payload: JSON.stringify(payload),
		});

		assert.equal(response.statusCode, 400);
		assert.deepEqual(await store.listKeys("project-a/"), []);
		await server.close();
	}
});

test("ingestion endpoint does not log rejected payloads", async () => {
	const logs: CapturedLog[] = [];
	const store = new MemoryObjectStore();
	const server = buildServer({
		auth: config.auth,
		sink: sinkFromStore(store),
		logger: captureLogger(logs),
	});
	const response = await server.inject({
		method: "POST",
		url: "/api/public/ingestion",
		headers: {
			authorization: authHeader(),
			"content-type": "application/json",
		},
		payload: JSON.stringify({ batch: {} }),
	});

	assert.equal(response.statusCode, 400);
	assert.deepEqual(ingestedEventLogs(logs), []);
	await server.close();
});

test("ingestion endpoint rejects invalid auth without writing objects", async () => {
	const cases = [
		{},
		{ authorization: `Basic ${Buffer.from("pk:wrong").toString("base64")}` },
		{ authorization: `Basic ${Buffer.from("wrong:sk").toString("base64")}` },
		{ authorization: "Bearer token" },
	];

	for (const headers of cases) {
		const store = new MemoryObjectStore();
		const server = buildServer({
			auth: config.auth,
			sink: sinkFromStore(store),
		});
		const response = await server.inject({
			method: "POST",
			url: "/api/public/ingestion",
			headers: {
				...headers,
				"content-type": "application/json",
			},
			payload: JSON.stringify({
				batch: [
					{
						id: "event-1",
						timestamp: "2026-06-14T00:00:00.000Z",
						type: eventTypes.TRACE_CREATE,
						body: { id: "trace-1", name: "Trace 1" },
					},
				],
			}),
		});

		assert.equal(response.statusCode, 401);
		assert.deepEqual(await store.listKeys("project-a/"), []);
		await server.close();
	}
});

test("dev ingestion accepts SDK requests without auth and writes directly to DuckDB", async () => {
	const db = new AgentPondCache(
		join(mkdtempSync(join(tmpdir(), "agentpond-dev-cache-")), "cache.duckdb"),
	);
	await db.ensureSchema();
	await db.close();
	const server = buildServer({
		auth: false,
		sink: new DuckDbIngestionSink(db.dbPath),
	});
	try {
		const response = await server.inject({
			method: "POST",
			url: "/api/public/ingestion",
			headers: {
				authorization: `Basic ${Buffer.from("any:thing").toString("base64")}`,
				"content-type": "application/json",
			},
			payload: JSON.stringify({
				batch: [
					{
						id: "event-dev-1",
						timestamp: "2026-06-14T00:00:00.000Z",
						type: eventTypes.TRACE_CREATE,
						body: { id: "trace-dev-1", name: "Dev Trace" },
					},
				],
			}),
		});

		assert.equal(response.statusCode, 207);
		const readDb = new AgentPondCache(db.dbPath);
		const rows = await readDb.query<{ id: string; name: string }>(
			"select id, name from traces where id = 'trace-dev-1'",
		);
		await readDb.close();

		assert.deepEqual(rows, [{ id: "trace-dev-1", name: "Dev Trace" }]);
	} finally {
		await server.close();
	}
});

test("otel generation costs project end-to-end into DuckDB", async () => {
	const store = new MemoryObjectStore();
	const response = await postOtelJson(
		store,
		otelPayload([
			{
				traceId: "trace-cost",
				spanId: "span-cost",
				name: "costed generation",
				startTimeUnixNano: "1781395200000000000",
				endTimeUnixNano: "1781395201000000000",
				attributes: [
					attr("langfuse.observation.type", "generation"),
					attr("langfuse.observation.usage_details", {
						input: 38,
						output: 22,
						total: 60,
					}),
					attr("langfuse.observation.cost_details", {
						input: 0.038,
						output: 0.044,
						total: 0.082,
					}),
				],
			},
		]),
	);

	assert.equal(response.statusCode, 200);
	const db = new AgentPondCache(
		join(mkdtempSync(join(tmpdir(), "agentpond-ingest-")), "cache.duckdb"),
	);
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });
	const observations = await db.query<{
		type: string;
		usage_details_json: string | null;
		cost_details_json: string | null;
		total_cost: number | null;
	}>(
		"select type, usage_details_json, cost_details_json, total_cost from observations where id = 'span-cost'",
	);
	const traces = await db.query<{ total_cost: number | null }>(
		"select total_cost from traces where id = 'trace-cost'",
	);
	await db.close();

	assert.deepEqual(observations, [
		{
			type: "generation-create",
			usage_details_json: JSON.stringify({ input: 38, output: 22, total: 60 }),
			cost_details_json: JSON.stringify({
				input: 0.038,
				output: 0.044,
				total: 0.082,
			}),
			total_cost: 0.082,
		},
	]);
	assert.deepEqual(traces, [{ total_cost: 0.082 }]);
});

test("otel endpoint logs the ingested OTEL payload", async () => {
	const logs: CapturedLog[] = [];
	const store = new MemoryObjectStore();
	const server = buildServer({
		auth: config.auth,
		sink: sinkFromStore(store),
		logger: captureLogger(logs),
	});
	const response = await server.inject({
		method: "POST",
		url: "/api/public/otel/v1/traces",
		headers: {
			authorization: authHeader(),
			"content-type": "application/json",
			"x-langfuse-ingestion-version": "4",
		},
		payload: JSON.stringify(
			otelPayload([
				{
					traceId: "trace-otel-log",
					spanId: "span-otel-log",
					name: "logged generation",
					startTimeUnixNano: "1781395200000000000",
					endTimeUnixNano: "1781395201000000000",
					attributes: [attr("langfuse.observation.type", "generation")],
				},
			]),
		),
	});

	assert.equal(response.statusCode, 200);
	assert.deepEqual(ingestedEventLogs(logs), []);
	assert.deepEqual(ingestedOtelPayloadLogs(logs), [
		{
			source: "otel",
			projectId: "project-a",
			resourceSpanCount: 1,
		},
	]);
	await server.close();
});

test("otel maps Langfuse SDK observation attributes to raw events", async () => {
	const events = await convertOtelJson(
		otelPayload([
			{
				traceId: "trace-sdk",
				spanId: "span-sdk",
				name: "sdk generation",
				startTimeUnixNano: "1781395200000000000",
				attributes: [
					attr("langfuse.observation.type", "generation"),
					attr("langfuse.observation.model.name", "gpt-5.5-mini"),
					attr("langfuse.observation.model.parameters", {
						temperature: 0.2,
						max_tokens: 128,
					}),
					attr("langfuse.observation.usage_details", {
						input: 38,
						output: 22,
						total: 60,
					}),
					attr("langfuse.observation.cost_details", {
						input: 0.038,
						output: 0.044,
						total: 0.082,
					}),
					attr("langfuse.observation.level", "WARNING"),
					attr("langfuse.observation.status_message", "review needed"),
					attr("langfuse.version", "2026-06-15"),
					attr("langfuse.environment", "production"),
					attr("langfuse.release", "0.0.1"),
				],
			},
		]),
	);

	const observationEvent = events.find(
		(event) => event.type === "generation-create",
	);
	assert.ok(observationEvent);
	assert.equal(observationEvent.body.model, "gpt-5.5-mini");
	assert.deepEqual(observationEvent.body.modelParameters, {
		temperature: 0.2,
		max_tokens: 128,
	});
	assert.deepEqual(observationEvent.body.usageDetails, {
		input: 38,
		output: 22,
		total: 60,
	});
	assert.deepEqual(observationEvent.body.costDetails, {
		input: 0.038,
		output: 0.044,
		total: 0.082,
	});
	assert.equal(observationEvent.body.level, "WARNING");
	assert.equal(observationEvent.body.statusMessage, "review needed");
	assert.equal(observationEvent.body.version, "2026-06-15");
	assert.equal(observationEvent.body.environment, "production");
});

test("otel maps OpenInference span kinds to supported observation event types", async () => {
	const cases: Array<[string, IngestionEvent["type"]]> = [
		["CHAIN", "chain-create"],
		["RETRIEVER", "retriever-create"],
		["LLM", "generation-create"],
		["EMBEDDING", "embedding-create"],
		["AGENT", "agent-create"],
		["TOOL", "tool-create"],
		["GUARDRAIL", "guardrail-create"],
		["EVALUATOR", "span-create"],
		["", "span-create"],
		["UnknownKind", "span-create"],
	];

	for (const [spanKind, expectedType] of cases) {
		const events = await convertOtelJson(
			otelPayload([
				{
					traceId: `trace-openinference-${spanKind || "empty"}`,
					spanId: `span-openinference-${spanKind || "empty"}`,
					name: `openinference ${spanKind || "empty"}`,
					startTimeUnixNano: "1781395200000000000",
					attributes: [attr("openinference.span.kind", spanKind)],
				},
			]),
		);

		assert.equal(observationEvent(events).type, expectedType);
	}
});

test("otel trusts Langfuse observation type over OpenInference and Vercel AI mappers", async () => {
	const events = await convertOtelJson(
		otelPayload([
			{
				traceId: "trace-mapper-priority",
				spanId: "span-mapper-priority",
				name: "mapper priority",
				startTimeUnixNano: "1781395200000000000",
				attributes: [
					attr("langfuse.observation.type", "tool"),
					attr("openinference.span.kind", "LLM"),
					attr("operation.name", "ai.generateText.doGenerate"),
					attr("gen_ai.response.model", "gpt-4"),
				],
			},
		]),
	);

	assert.equal(observationEvent(events).type, "tool-create");
});

test("otel maps Vercel AI SDK tool calls to tool observations", async () => {
	const withOperationName = await convertOtelJson(
		otelPayload([
			{
				traceId: "trace-vercel-tool-operation-name",
				spanId: "span-vercel-tool-operation-name",
				name: "ai.toolCall",
				startTimeUnixNano: "1781395200000000000",
				attributes: [
					attr("operation.name", "ai.toolCall MyAgent.MyLLM.myFunction"),
					attr("resource.name", "MyAgent.MyLLM.myFunction"),
					attr("ai.operationId", "ai.toolCall"),
					attr("ai.toolCall.name", "myTool"),
					attr("ai.toolCall.id", "call_abc123"),
				],
			},
		]),
	);
	const withOperationId = await convertOtelJson(
		otelPayload([
			{
				traceId: "trace-vercel-tool-operation-id",
				spanId: "span-vercel-tool-operation-id",
				name: "tool-execution",
				startTimeUnixNano: "1781395200000000000",
				attributes: [attr("ai.operationId", "ai.toolCall")],
			},
		]),
	);

	assert.equal(observationEvent(withOperationName).type, "tool-create");
	assert.equal(observationEvent(withOperationId).type, "tool-create");
});

test("otel maps Vercel AI SDK generation operations only when model info is present", async () => {
	const withModel = await convertOtelJson(
		otelPayload([
			{
				traceId: "trace-vercel-generation-model",
				spanId: "span-vercel-generation-model",
				name: "text-generation",
				startTimeUnixNano: "1781395200000000000",
				attributes: [
					attr("operation.name", "ai.generateText.doGenerate"),
					attr("gen_ai.response.model", "gpt-4"),
				],
			},
		]),
	);
	const withoutModel = await convertOtelJson(
		otelPayload([
			{
				traceId: "trace-vercel-generation-no-model",
				spanId: "span-vercel-generation-no-model",
				name: "text-generation",
				startTimeUnixNano: "1781395200000000000",
				attributes: [attr("operation.name", "ai.generateText.doGenerate")],
			},
		]),
	);

	assert.equal(observationEvent(withModel).type, "generation-create");
	assert.equal(observationEvent(withoutModel).type, "span-create");
});

test("otel maps base Vercel AI SDK generation operation names when model info is present", async () => {
	for (const operationName of ["ai.generateText", "ai.generateObject"]) {
		const events = await convertOtelJson(
			otelPayload([
				{
					traceId: `trace-vercel-${operationName}`,
					spanId: `span-vercel-${operationName}`,
					name: operationName,
					startTimeUnixNano: "1781395200000000000",
					attributes: [
						attr("operation.name", operationName),
						attr("gen_ai.response.model", "gpt-4"),
					],
				},
			]),
		);

		assert.equal(observationEvent(events).type, "generation-create");
	}
});

test("otel maps Vercel AI SDK embedding operations when model info is present", async () => {
	const events = await convertOtelJson(
		otelPayload([
			{
				traceId: "trace-vercel-embedding",
				spanId: "span-vercel-embedding",
				name: "embedding",
				startTimeUnixNano: "1781395200000000000",
				attributes: [
					attr("ai.operationId", "ai.embed.doEmbed"),
					attr("ai.model.id", "text-embedding-3-small"),
				],
			},
		]),
	);

	assert.equal(observationEvent(events).type, "embedding-create");
});

test("otel trace fields come from trace attributes", async () => {
	const events = await convertOtelJson(
		otelPayload([
			{
				traceId: "trace-fields",
				spanId: "span-fields",
				name: "trace fields",
				startTimeUnixNano: "1781395200000000000",
				attributes: [
					attr("langfuse.observation.input", { observation: "input" }),
					attr("langfuse.observation.output", { observation: "output" }),
					attr("langfuse.trace.input", { trace: "input" }),
					attr("langfuse.trace.output", { trace: "output" }),
					attr("langfuse.trace.tags", ["checkout", "support"]),
					attr("langfuse.trace.public", true),
					attr("langfuse.trace.metadata.team", "success"),
				],
			},
		]),
	);

	const traceEvent = events.find((event) => event.type === "trace-create");
	assert.ok(traceEvent);
	assert.deepEqual(traceEvent.body.input, { trace: "input" });
	assert.deepEqual(traceEvent.body.output, { trace: "output" });
	assert.deepEqual(traceEvent.body.tags, ["checkout", "support"]);
	assert.equal(traceEvent.body.public, true);
	assert.deepEqual(traceEvent.body.metadata, { team: "success" });
});

test("otel first parented span creates a shallow queryable trace", async () => {
	const store = new MemoryObjectStore();
	const response = await postOtelJson(
		store,
		otelPayload([
			{
				traceId: "trace-shallow",
				spanId: "span-shallow",
				parentSpanId: "external-parent",
				name: "first parented span",
				startTimeUnixNano: "1781395200000000000",
				endTimeUnixNano: "1781395201000000000",
			},
		]),
	);

	assert.equal(response.statusCode, 200);
	const db = new AgentPondCache(
		join(mkdtempSync(join(tmpdir(), "agentpond-ingest-")), "cache.duckdb"),
	);
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });
	const traces = await db.query<{
		id: string;
		name: string | null;
		metadata_json: string | null;
	}>("select id, name, metadata_json from traces where id = 'trace-shallow'");
	const observations = await db.query<{
		id: string;
		parent_observation_id: string | null;
	}>(
		"select id, parent_observation_id from observations where trace_id = 'trace-shallow'",
	);
	await db.close();

	assert.deepEqual(traces, [
		{
			id: "trace-shallow",
			name: null,
			metadata_json: null,
		},
	]);
	assert.deepEqual(observations, [
		{
			id: "span-shallow",
			parent_observation_id: "external-parent",
		},
	]);
});

test("otel repeated parented spans create one shallow trace event", async () => {
	const events = await convertOtelJson(
		otelPayload([
			{
				traceId: "trace-repeated-child",
				spanId: "span-child-1",
				parentSpanId: "external-parent",
				name: "child one",
				startTimeUnixNano: "1781395200000000000",
			},
			{
				traceId: "trace-repeated-child",
				spanId: "span-child-2",
				parentSpanId: "external-parent",
				name: "child two",
				startTimeUnixNano: "1781395201000000000",
			},
		]),
	);

	const traceEvents = events.filter(
		(event) => event.type === eventTypes.TRACE_CREATE,
	);
	assert.equal(traceEvents.length, 1);
	assert.equal(traceEvents[0]?.body.id, "trace-repeated-child");
	assert.equal(traceEvents[0]?.body.name, undefined);
	assert.equal(traceEvents[0]?.body.timestamp, "2026-06-14T00:00:00.000Z");
	assert.equal(traceEvents[0]?.body.startTime, undefined);
	assert.equal(
		events.filter((event) => event.type === eventTypes.SPAN_CREATE).length,
		2,
	);
});

test("otel parented span with compatibility trace attributes creates a trace update", async () => {
	const events = await convertOtelJson(
		otelPayload([
			{
				traceId: "trace-compat-fields",
				spanId: "span-compat-fields",
				parentSpanId: "external-parent",
				name: "compat child",
				startTimeUnixNano: "1781395200000000000",
				attributes: [
					attr("langfuse.user.id", "compat-user"),
					attr("langfuse.session.id", "compat-session"),
					attr("ai.telemetry.metadata.tags", "alpha,beta"),
				],
			},
		]),
	);

	const traceEvent = events.find(
		(event) => event.type === eventTypes.TRACE_CREATE,
	);
	assert.ok(traceEvent);
	assert.equal(traceEvent.body.id, "trace-compat-fields");
	assert.equal(traceEvent.body.name, undefined);
	assert.equal(traceEvent.body.userId, "compat-user");
	assert.equal(traceEvent.body.sessionId, "compat-session");
	assert.deepEqual(traceEvent.body.tags, ["alpha", "beta"]);
});

test("otel parented span with trace attributes creates a queryable trace", async () => {
	const store = new MemoryObjectStore();
	const response = await postOtelJson(
		store,
		otelPayload([
			{
				traceId: "trace-parented-fields",
				spanId: "span-parented-fields",
				parentSpanId: "external-parent",
				name: "parented child",
				startTimeUnixNano: "1781395200000000000",
				endTimeUnixNano: "1781395201000000000",
				attributes: [
					attr("langfuse.trace.name", "trace from child attrs"),
					attr("langfuse.trace.metadata.workflow", "compliance"),
					attr("user.id", "user-1"),
					attr("session.id", "session-1"),
				],
			},
		]),
	);

	assert.equal(response.statusCode, 200);
	const db = new AgentPondCache(
		join(mkdtempSync(join(tmpdir(), "agentpond-ingest-")), "cache.duckdb"),
	);
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });
	const traces = await db.query<{
		id: string;
		name: string;
		user_id: string;
		session_id: string;
		metadata_json: string | null;
	}>(
		"select id, name, user_id, session_id, metadata_json from traces where id = 'trace-parented-fields'",
	);
	await db.close();

	assert.deepEqual(traces, [
		{
			id: "trace-parented-fields",
			name: "trace from child attrs",
			user_id: "user-1",
			session_id: "session-1",
			metadata_json: JSON.stringify({ workflow: "compliance" }),
		},
	]);
});

test("otel filters shallow trace when a full trace exists in the same batch", async () => {
	const events = await convertOtelJson(
		otelPayload([
			{
				traceId: "trace-full-wins",
				spanId: "span-child-first",
				parentSpanId: "external-parent",
				name: "child first",
				startTimeUnixNano: "1781395200000000000",
			},
			{
				traceId: "trace-full-wins",
				spanId: "span-root-second",
				name: "root second",
				startTimeUnixNano: "1781395201000000000",
				attributes: [attr("langfuse.trace.name", "full trace")],
			},
		]),
	);

	const traceEvents = events.filter(
		(event) => event.type === eventTypes.TRACE_CREATE,
	);
	assert.equal(traceEvents.length, 1);
	assert.equal(traceEvents[0]?.body.id, "trace-full-wins");
	assert.equal(traceEvents[0]?.body.name, "full trace");
});

test("otel parented span with as_root creates a queryable trace", async () => {
	const store = new MemoryObjectStore();
	const response = await postOtelJson(
		store,
		otelPayload([
			{
				traceId: "trace-as-root",
				spanId: "span-as-root",
				parentSpanId: "external-parent",
				name: "parented app root",
				startTimeUnixNano: "1781395200000000000",
				endTimeUnixNano: "1781395201000000000",
				attributes: [
					attr("langfuse.internal.as_root", true),
					attr("langfuse.trace.name", "app root trace"),
					attr("langfuse.trace.metadata.workflow", "compliance"),
				],
			},
		]),
	);

	assert.equal(response.statusCode, 200);
	const db = new AgentPondCache(
		join(mkdtempSync(join(tmpdir(), "agentpond-ingest-")), "cache.duckdb"),
	);
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });
	const traces = await db.query<{
		id: string;
		name: string;
		metadata_json: string | null;
	}>("select id, name, metadata_json from traces where id = 'trace-as-root'");
	const observations = await db.query<{
		id: string;
		parent_observation_id: string | null;
	}>(
		"select id, parent_observation_id from observations where trace_id = 'trace-as-root'",
	);
	await db.close();

	assert.deepEqual(traces, [
		{
			id: "trace-as-root",
			name: "app root trace",
			metadata_json: JSON.stringify({ workflow: "compliance" }),
		},
	]);
	assert.deepEqual(observations, [
		{
			id: "span-as-root",
			parent_observation_id: "external-parent",
		},
	]);
});

test("otel parented span with is_app_root creates a queryable trace", async () => {
	const store = new MemoryObjectStore();
	const response = await postOtelJson(
		store,
		otelPayload([
			{
				traceId: "trace-is-app-root",
				spanId: "span-is-app-root",
				parentSpanId: "external-parent",
				name: "parented app root",
				startTimeUnixNano: "1781395200000000000",
				endTimeUnixNano: "1781395201000000000",
				attributes: [
					attr("langfuse.internal.is_app_root", true),
					attr("langfuse.trace.name", "app root trace"),
					attr("langfuse.trace.metadata.workflow", "compliance"),
				],
			},
		]),
	);

	assert.equal(response.statusCode, 200);
	const db = new AgentPondCache(
		join(mkdtempSync(join(tmpdir(), "agentpond-ingest-")), "cache.duckdb"),
	);
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });
	const traces = await db.query<{
		id: string;
		name: string;
		metadata_json: string | null;
	}>(
		"select id, name, metadata_json from traces where id = 'trace-is-app-root'",
	);
	const observations = await db.query<{
		id: string;
		parent_observation_id: string | null;
	}>(
		"select id, parent_observation_id from observations where trace_id = 'trace-is-app-root'",
	);
	await db.close();

	assert.deepEqual(traces, [
		{
			id: "trace-is-app-root",
			name: "app root trace",
			metadata_json: JSON.stringify({ workflow: "compliance" }),
		},
	]);
	assert.deepEqual(observations, [
		{
			id: "span-is-app-root",
			parent_observation_id: "external-parent",
		},
	]);
});

test("otel maps multiple spans in one trace with parent and aggregate cost", async () => {
	const store = new MemoryObjectStore();
	const response = await postOtelJson(
		store,
		otelPayload([
			{
				traceId: "trace-multi",
				spanId: "span-root",
				name: "root span",
				startTimeUnixNano: "1781395200000000000",
			},
			{
				traceId: "trace-multi",
				spanId: "span-child",
				parentSpanId: "span-root",
				name: "child generation",
				startTimeUnixNano: "1781395201000000000",
				attributes: [
					attr("langfuse.observation.type", "generation"),
					attr("langfuse.observation.cost_details", {
						input: 0.038,
						output: 0.044,
						total: 0.082,
					}),
				],
			},
		]),
	);

	assert.equal(response.statusCode, 200);
	const db = new AgentPondCache(
		join(mkdtempSync(join(tmpdir(), "agentpond-ingest-")), "cache.duckdb"),
	);
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });
	const observations = await db.query<{
		id: string;
		parent_observation_id: string | null;
	}>(
		"select id, parent_observation_id from observations where trace_id = 'trace-multi' order by id asc",
	);
	const traces = await db.query<{ total_cost: number | null }>(
		"select total_cost from traces where id = 'trace-multi'",
	);
	await db.close();
	assert.deepEqual(observations, [
		{ id: "span-child", parent_observation_id: "span-root" },
		{ id: "span-root", parent_observation_id: null },
	]);
	assert.deepEqual(traces, [{ total_cost: 0.082 }]);
});

test("otel observation types map to supported event types", async () => {
	const cases: Array<[string | undefined, string]> = [
		["span", "span-create"],
		["generation", "generation-create"],
		["event", "event-create"],
		["agent", "agent-create"],
		["tool", "tool-create"],
		["chain", "chain-create"],
		["retriever", "retriever-create"],
		["embedding", "embedding-create"],
		["guardrail", "guardrail-create"],
		["unknown", "span-create"],
		[undefined, "span-create"],
	];

	for (const [observationType, expectedEventType] of cases) {
		const attributes = observationType
			? [attr("langfuse.observation.type", observationType)]
			: [];
		const events = await convertOtelJson(
			otelPayload([
				{
					traceId: `trace-type-${observationType ?? "missing"}`,
					spanId: `span-type-${observationType ?? "missing"}`,
					name: "typed observation",
					startTimeUnixNano: "1781395200000000000",
					attributes,
				},
			]),
		);

		assert.equal(
			events.find((event) => event.type !== "trace-create")?.type,
			expectedEventType,
		);
	}
});

test("otel handles id and timestamp edge cases", async () => {
	const events = await convertOtelJson(
		otelPayload([
			{
				traceId: "trace-timestamps",
				spanId: "span-missing-start",
				name: "missing start",
			},
			{
				traceId: "trace-timestamps-2",
				spanId: "span-number-start",
				name: "number start",
				startTimeUnixNano: 1781395200000000000,
				endTimeUnixNano: "1781395201000000000",
			},
		]),
	);
	const observations = events.filter((event) => event.type === "span-create");
	const missingStartEvent = observations.find(
		(event) => event.body.id === "span-missing-start",
	);
	const numberStartEvent = observations.find(
		(event) => event.body.id === "span-number-start",
	);
	assert.equal(
		Number.isFinite(Date.parse(String(missingStartEvent?.body.startTime))),
		true,
	);
	assert.equal(missingStartEvent?.body.endTime, undefined);
	assert.equal(
		Number.isFinite(Date.parse(String(numberStartEvent?.body.startTime))),
		true,
	);

	const protobufStore = new MemoryObjectStore();
	const server = buildServer({
		auth: config.auth,
		sink: sinkFromStore(protobufStore),
	});
	const protobufResponse = await server.inject({
		method: "POST",
		url: "/api/public/otel/v1/traces",
		headers: {
			authorization: authHeader(),
			"content-type": "application/x-protobuf",
		},
		payload: makeOtlpTraceProtobuf({
			parentSpanId: Buffer.alloc(0),
			endTimeUnixNano: undefined,
		}),
	});
	await server.close();

	assert.equal(protobufResponse.statusCode, 200);
	const db = new AgentPondCache(
		join(mkdtempSync(join(tmpdir(), "agentpond-ingest-")), "cache.duckdb"),
	);
	await db.syncFromStore({
		store: protobufStore,
		projectId: "project-a",
		prefix: "",
	});
	const protobufEvents = await db.query<{
		parent_observation_id: string | null;
		end_time: Date | null;
	}>("select parent_observation_id, end_time from observations");
	await db.close();
	assert.deepEqual(protobufEvents, [
		{ parent_observation_id: null, end_time: null },
	]);
});

test("otel ignores malformed usage and cost attributes without rejecting the span", async () => {
	const events = await convertOtelJson(
		otelPayload([
			{
				traceId: "trace-malformed",
				spanId: "span-malformed",
				name: "malformed generation",
				startTimeUnixNano: "1781395200000000000",
				attributes: [
					attr("langfuse.observation.type", "generation"),
					attr("langfuse.observation.usage_details", "not-json"),
					attr("langfuse.observation.cost_details", "{bad"),
				],
			},
		]),
	);

	const observationEvent = events.find(
		(event) => event.type === "generation-create",
	);
	assert.ok(observationEvent);
	assert.equal(observationEvent.body.usageDetails, undefined);
	assert.equal(observationEvent.body.costDetails, undefined);
});

test("otel endpoint accepts ingestion version header in underscore format", async () => {
	const store = new MemoryObjectStore();
	const server = buildServer({
		auth: config.auth,
		sink: sinkFromStore(store),
	});
	const response = await server.inject({
		method: "POST",
		url: "/api/public/otel/v1/traces",
		headers: {
			authorization: authHeader(),
			"content-type": "application/json",
			x_langfuse_ingestion_version: "4",
		},
		payload: JSON.stringify({
			resourceSpans: [
				{
					scopeSpans: [
						{
							spans: [
								{
									traceId: "trace-underscore",
									spanId: "span-underscore",
									name: "underscore header span",
									startTimeUnixNano: "1781395200000000000",
								},
							],
						},
					],
				},
			],
		}),
	});

	assert.equal(response.statusCode, 200);
	assert.equal((await store.listKeys("project-a/manifests/")).length, 0);
	assert.equal((await store.listKeys("otel/project-a/")).length, 1);
	await server.close();
});

test("otel endpoint accepts gzip JSON bodies", async () => {
	const store = new MemoryObjectStore();
	const server = buildServer({
		auth: config.auth,
		sink: sinkFromStore(store),
	});
	const response = await server.inject({
		method: "POST",
		url: "/api/public/otel/v1/traces",
		headers: {
			authorization: authHeader(),
			"content-type": "application/json",
			"content-encoding": "gzip",
		},
		payload: gzipSync(
			Buffer.from(
				JSON.stringify({
					resourceSpans: [
						{
							scopeSpans: [
								{
									spans: [
										{
											traceId: "trace-gzip",
											spanId: "span-gzip",
											name: "gzip span",
											startTimeUnixNano: "1781395200000000000",
										},
									],
								},
							],
						},
					],
				}),
			),
		),
	});

	assert.equal(response.statusCode, 200);
	assert.equal((await store.listKeys("project-a/manifests/")).length, 0);
	assert.equal((await store.listKeys("otel/project-a/")).length, 1);
	await server.close();
});

test("otel endpoint accepts protobuf trace bodies", async () => {
	const store = new MemoryObjectStore();
	const server = buildServer({
		auth: config.auth,
		sink: sinkFromStore(store),
	});
	const payload = makeOtlpTraceProtobuf();
	const response = await server.inject({
		method: "POST",
		url: "/api/public/otel/v1/traces",
		headers: {
			authorization: authHeader(),
			"content-type": "application/x-protobuf",
		},
		payload,
	});

	assert.equal(response.statusCode, 200);
	assert.equal((await store.listKeys("project-a/manifests/")).length, 0);
	assert.equal((await store.listKeys("otel/project-a/")).length, 1);
	assert.equal((await store.listKeys("project-a/trace/")).length, 0);
	await server.close();
});

test("otel endpoint rejects invalid content types", async () => {
	const server = buildServer({
		auth: config.auth,
		sink: sinkFromStore(new MemoryObjectStore()),
	});
	const response = await server.inject({
		method: "POST",
		url: "/api/public/otel/v1/traces",
		headers: {
			authorization: authHeader(),
			"content-type": "text/plain",
		},
		payload: "nope",
	});

	assert.equal(response.statusCode, 400);
	await server.close();
});

test("otel endpoint rejects unsupported ingestion versions", async () => {
	const server = buildServer({
		auth: config.auth,
		sink: sinkFromStore(new MemoryObjectStore()),
	});
	const response = await server.inject({
		method: "POST",
		url: "/api/public/otel/v1/traces",
		headers: {
			authorization: authHeader(),
			"content-type": "application/json",
			"x-langfuse-ingestion-version": "5",
		},
		payload: JSON.stringify({ resourceSpans: [] }),
	});

	assert.equal(response.statusCode, 400);
	await server.close();
});

function makeOtlpTraceProtobuf(
	options: { parentSpanId?: Buffer; endTimeUnixNano?: string } = {},
): Buffer {
	const root = protobuf.parse(`
syntax = "proto3";
package agentpond.otlp;
message ExportTraceServiceRequest { repeated ResourceSpans resource_spans = 1; }
message ResourceSpans { repeated ScopeSpans scope_spans = 2; }
message ScopeSpans { repeated Span spans = 2; }
message Span {
  bytes trace_id = 1;
  bytes span_id = 2;
  bytes parent_span_id = 4;
  string name = 5;
  fixed64 start_time_unix_nano = 7;
  fixed64 end_time_unix_nano = 8;
  repeated KeyValue attributes = 9;
}
message KeyValue { string key = 1; AnyValue value = 2; }
message AnyValue { string string_value = 1; }
`).root;
	const type = root.lookupType("agentpond.otlp.ExportTraceServiceRequest");
	const message = type.create({
		resourceSpans: [
			{
				scopeSpans: [
					{
						spans: [
							{
								traceId: Buffer.from("00112233445566778899aabbccddeeff", "hex"),
								spanId: Buffer.from("0011223344556677", "hex"),
								parentSpanId: options.parentSpanId,
								name: "protobuf span",
								startTimeUnixNano: "1781395200000000000",
								endTimeUnixNano: options.endTimeUnixNano,
								attributes: [
									{ key: "service.name", value: { stringValue: "demo" } },
								],
							},
						],
					},
				],
			},
		],
	});
	return Buffer.from(type.encode(message).finish());
}
