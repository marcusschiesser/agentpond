import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	AcceptedEventWriter,
	eventTypes,
	type IngestionEvent,
	MemoryObjectStore,
} from "@agentpond/core";
import { AgentPondDuckDb } from "@agentpond/duckdb";

function createTempDb(): AgentPondDuckDb {
	return new AgentPondDuckDb(
		join(mkdtempSync(join(tmpdir(), "agentpond-")), "cache.duckdb"),
	);
}

async function writeAndSync(
	events: IngestionEvent[],
): Promise<{ store: MemoryObjectStore; db: AgentPondDuckDb }> {
	const store = new MemoryObjectStore();
	const writer = new AcceptedEventWriter({ store, projectId: "project-a" });
	await writer.writeAcceptedEvents(events, "batch-1");
	const db = createTempDb();
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });
	return { store, db };
}

test("DuckDB sync is idempotent and projects traces, sessions, scores, and raw events", async () => {
	const store = new MemoryObjectStore();
	const writer = new AcceptedEventWriter({ store, projectId: "project-a" });
	const events: IngestionEvent[] = [
		{
			id: "trace-event",
			timestamp: "2026-06-14T00:00:00.000Z",
			type: eventTypes.TRACE_CREATE,
			body: { id: "trace-1", name: "Trace 1", sessionId: "session-1" },
		},
		{
			id: "observation-event",
			timestamp: "2026-06-14T00:00:00.500Z",
			type: eventTypes.GENERATION_CREATE,
			body: {
				id: "observation-1",
				traceId: "trace-1",
				name: "Generation 1",
				usageDetails: { input: 10, output: 5, total: 15 },
				costDetails: { input: 0.01, output: 0.02, total: 0.03 },
			},
		},
		{
			id: "usage-only-observation-event",
			timestamp: "2026-06-14T00:00:00.750Z",
			type: eventTypes.GENERATION_CREATE,
			body: {
				id: "observation-usage-only",
				traceId: "trace-1",
				name: "Usage Only Generation",
				model: "gpt-test",
				usageDetails: { input: 20, output: 10, total: 30 },
			},
		},
		{
			id: "score-event",
			timestamp: "2026-06-14T00:00:01.000Z",
			type: eventTypes.SCORE_CREATE,
			body: {
				id: "score-1",
				traceId: "trace-1",
				name: "quality",
				value: 0.9,
				source: "EVAL",
			},
		},
		{
			id: "annotation-score-event",
			timestamp: "2026-06-14T00:00:02.000Z",
			type: eventTypes.SCORE_CREATE,
			body: {
				id: "score-2",
				traceId: "trace-1",
				name: "human-quality",
				value: 1,
				metadata: { source: "ANNOTATION", annotator: "human-reviewer" },
			},
		},
	];
	await writer.writeAcceptedEvents(events, "batch-1");

	const db = createTempDb();
	const first = await db.syncFromStore({
		store,
		projectId: "project-a",
		prefix: "",
	});
	const second = await db.syncFromStore({
		store,
		projectId: "project-a",
		prefix: "",
	});

	assert.equal(first.manifestsProcessed, 1);
	assert.equal(first.eventsProcessed, 5);
	assert.equal(second.manifestsProcessed, 0);
	const traces = await db.query<{ id: string; total_cost: number | null }>(
		"select id, total_cost from traces",
	);
	assert.deepEqual(traces, [{ id: "trace-1", total_cost: 0.03 }]);
	assert.equal((await db.query("select * from sessions")).length, 1);
	assert.equal((await db.query("select * from observations")).length, 2);
	assert.equal((await db.query("select * from scores")).length, 2);
	assert.equal(
		(await db.query("select * from scores where source = 'ANNOTATION'")).length,
		1,
	);
	assert.equal((await db.query("select * from events_raw")).length, 5);

	const observations = await db.query<{
		id: string;
		usage_details_json: string | null;
		cost_details_json: string | null;
		total_cost: number | null;
	}>(
		"select id, usage_details_json, cost_details_json, total_cost from observations order by start_time asc",
	);
	assert.deepEqual(observations, [
		{
			id: "observation-1",
			usage_details_json: JSON.stringify({ input: 10, output: 5, total: 15 }),
			cost_details_json: JSON.stringify({
				input: 0.01,
				output: 0.02,
				total: 0.03,
			}),
			total_cost: 0.03,
		},
		{
			id: "observation-usage-only",
			usage_details_json: JSON.stringify({ input: 20, output: 10, total: 30 }),
			cost_details_json: null,
			total_cost: null,
		},
	]);

	const rawRows = await db.query<{ body_json: string; event_json: string }>(
		"select body_json, event_json from events_raw where event_id = 'observation-event'",
	);
	assert.deepEqual(JSON.parse(rawRows[0].body_json).costDetails, {
		input: 0.01,
		output: 0.02,
		total: 0.03,
	});
	assert.equal(JSON.parse(rawRows[0].event_json).id, "observation-event");
	await db.close();
});

test("DuckDB sessions view exposes session rows in stable last seen order", async () => {
	const store = new MemoryObjectStore();
	const writer = new AcceptedEventWriter({ store, projectId: "project-a" });
	await writer.writeAcceptedEvents(
		[
			{
				id: "trace-event-1",
				timestamp: "2026-06-14T00:00:00.000Z",
				type: eventTypes.TRACE_CREATE,
				body: {
					id: "trace-1",
					sessionId: "session-a",
					startTime: "2026-06-14T00:00:00.000Z",
				},
			},
			{
				id: "trace-event-2",
				timestamp: "2026-06-14T00:01:00.000Z",
				type: eventTypes.TRACE_CREATE,
				body: {
					id: "trace-2",
					sessionId: "session-b",
					startTime: "2026-06-14T00:01:00.000Z",
				},
			},
		],
		"batch-1",
	);

	const db = createTempDb();
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });
	const sessions = await db.query<{ id: string; trace_count: bigint }>(
		"select id, trace_count from sessions order by last_seen_at desc",
	);
	await db.close();

	assert.deepEqual(sessions, [
		{ id: "session-b", trace_count: 1n },
		{ id: "session-a", trace_count: 1n },
	]);
});

test("DuckDB first sync reads all current-layout OTEL buckets", async () => {
	const store = new MemoryObjectStore();
	await store.putJson("otel/project-a/2020/01/02/03/04/old-batch.json", [
		{
			scopeSpans: [
				{
					spans: [
						{
							traceId: "11111111111111111111111111111111",
							spanId: "2222222222222222",
							name: "old trace",
							startTimeUnixNano: "1577934240000000000",
							endTimeUnixNano: "1577934240000000000",
							attributes: [
								{
									key: "langfuse.observation.type",
									value: { stringValue: "span" },
								},
								{
									key: "langfuse.trace.name",
									value: { stringValue: "old trace" },
								},
							],
						},
					],
				},
			],
		},
	]);

	const db = createTempDb();
	const result = await db.syncFromStore({
		store,
		projectId: "project-a",
		prefix: "",
	});
	const traces = await db.query<{ id: string; name: string }>(
		"select id, name from traces",
	);
	await db.close();

	assert.equal(result.objectsProcessed, 1);
	assert.deepEqual(traces, [
		{ id: "11111111111111111111111111111111", name: "old trace" },
	]);
});

test("DuckDB scores support trace and observation filters across value types", async () => {
	const { db } = await writeAndSync([
		{
			id: "numeric-score-event",
			timestamp: "2026-06-14T00:00:00.000Z",
			type: eventTypes.SCORE_CREATE,
			body: {
				id: "score-numeric",
				traceId: "trace-1",
				name: "quality",
				value: 0.9,
				source: "EVAL",
			},
		},
		{
			id: "string-score-event",
			timestamp: "2026-06-14T00:00:01.000Z",
			type: eventTypes.SCORE_CREATE,
			body: {
				id: "score-string",
				observationId: "observation-1",
				name: "label",
				value: "good",
				dataType: "CATEGORICAL",
				source: "ANNOTATION",
			},
		},
		{
			id: "boolean-score-event",
			timestamp: "2026-06-14T00:00:02.000Z",
			type: eventTypes.SCORE_CREATE,
			body: {
				id: "score-boolean",
				observationId: "observation-1",
				name: "accepted",
				value: true,
				source: "API",
			},
		},
		{
			id: "text-score-event",
			timestamp: "2026-06-14T00:00:03.000Z",
			type: eventTypes.SCORE_CREATE,
			body: {
				id: "score-text",
				observationId: "observation-1",
				name: "note",
				value: "needs follow-up",
				dataType: "TEXT",
				source: "EVAL",
			},
		},
		{
			id: "correction-score-event",
			timestamp: "2026-06-14T00:00:04.000Z",
			type: eventTypes.SCORE_CREATE,
			body: {
				id: "score-correction",
				observationId: "observation-1",
				name: "correction",
				value: "Use checkout instead of payment.",
				dataType: "CORRECTION",
				source: "ANNOTATION",
			},
		},
	]);

	const traceScores = await db.query<{
		id: string;
		value: number;
		data_type: string;
		source: string;
	}>(
		"select id, value, data_type, source from scores where trace_id = 'trace-1'",
	);
	const observationScores = await db.query<{
		id: string;
		value: number | null;
		string_value: string | null;
		data_type: string;
		source: string;
	}>(
		"select id, value, string_value, data_type, source from scores where observation_id = 'observation-1' order by timestamp asc",
	);
	const evalScores = await db.query<{ id: string }>(
		"select id from scores where source = 'EVAL' order by timestamp asc",
	);
	const annotationScores = await db.query<{ id: string }>(
		"select id from scores where source = 'ANNOTATION' order by timestamp asc",
	);
	await db.close();

	assert.deepEqual(traceScores, [
		{ id: "score-numeric", value: 0.9, data_type: "NUMERIC", source: "EVAL" },
	]);
	assert.deepEqual(observationScores, [
		{
			id: "score-string",
			value: null,
			string_value: "good",
			data_type: "CATEGORICAL",
			source: "ANNOTATION",
		},
		{
			id: "score-boolean",
			value: 1,
			string_value: "true",
			data_type: "BOOLEAN",
			source: "API",
		},
		{
			id: "score-text",
			value: null,
			string_value: "needs follow-up",
			data_type: "TEXT",
			source: "EVAL",
		},
		{
			id: "score-correction",
			value: null,
			string_value: "Use checkout instead of payment.",
			data_type: "CORRECTION",
			source: "ANNOTATION",
		},
	]);
	assert.deepEqual(evalScores, [{ id: "score-numeric" }, { id: "score-text" }]);
	assert.deepEqual(annotationScores, [
		{ id: "score-string" },
		{ id: "score-correction" },
	]);
});
