import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	AcceptedEventWriter,
	eventTypes,
	type IngestionEvent,
	MemoryObjectStore,
} from "@agentpond/core";
import { AgentPondCache, DuckDbIngestionSink } from "@agentpond/duckdb";
import { retryDuckDbLockConflicts } from "../src/cache/write-lock.js";

function createTempDbPath(): string {
	return join(mkdtempSync(join(tmpdir(), "agentpond-")), "cache.duckdb");
}

function createTempDb(): AgentPondCache {
	return new AgentPondCache(createTempDbPath());
}

async function writeAndSync(
	events: IngestionEvent[],
): Promise<{ store: MemoryObjectStore; db: AgentPondCache }> {
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

test("DuckDB sync rejects duplicate manifest event ids atomically", async () => {
	const store = new MemoryObjectStore();
	const writer = new AcceptedEventWriter({ store, projectId: "project-a" });
	const db = createTempDb();

	await writer.writeAcceptedEvents(
		[
			{
				id: "duplicate-event",
				timestamp: "2026-06-14T00:00:00.000Z",
				type: eventTypes.TRACE_CREATE,
				body: { id: "trace-1", name: "original trace" },
			},
		],
		"batch-1",
	);
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });

	await writer.writeAcceptedEvents(
		[
			{
				id: "duplicate-event",
				timestamp: "2026-06-14T00:00:01.000Z",
				type: eventTypes.TRACE_CREATE,
				body: { id: "trace-2", name: "duplicate trace" },
			},
		],
		"batch-2",
	);

	await assert.rejects(
		db.syncFromStore({ store, projectId: "project-a", prefix: "" }),
		/append|aborted|constraint|primary/i,
	);

	const rawRows = await db.query<{ count: bigint }>(
		"select count(*) as count from events_raw",
	);
	const traces = await db.query<{ id: string; name: string }>(
		"select id, name from traces order by id",
	);
	const processedManifests = await db.query<{ count: bigint }>(
		"select count(*) as count from processed_manifests",
	);
	await db.close();

	assert.equal(Number(rawRows[0].count), 1);
	assert.deepEqual(traces, [{ id: "trace-1", name: "original trace" }]);
	assert.equal(Number(processedManifests[0].count), 1);
});

test("direct DuckDB writes skip duplicate event ids", async () => {
	const db = createTempDb();
	await db.ensureSchema();
	await db.directIngestion().writeEvents({
		projectId: "project-a",
		events: [
			{
				id: "trace-event-direct",
				timestamp: "2026-06-14T00:00:00.000Z",
				type: eventTypes.TRACE_CREATE,
				body: { id: "trace-direct", name: "Direct Trace" },
			},
		],
		source: "test-direct",
	});
	const second = await db.directIngestion().writeEvents({
		projectId: "project-a",
		events: [
			{
				id: "trace-event-direct",
				timestamp: "2026-06-14T00:00:00.000Z",
				type: eventTypes.TRACE_CREATE,
				body: { id: "trace-direct", name: "Direct Trace" },
			},
		],
		source: "test-direct",
	});
	const rows = await db.query<{ id: string; name: string }>(
		"SELECT id, name FROM traces WHERE id = 'trace-direct'",
	);
	await db.close();

	assert.deepEqual(second, { eventsProcessed: 0, eventsSkipped: 1 });
	assert.deepEqual(rows, [{ id: "trace-direct", name: "Direct Trace" }]);
});

test("DuckDB ingestion sink serializes concurrent writes to the same cache", async () => {
	const dbPath = createTempDbPath();
	const sink = new DuckDbIngestionSink(dbPath);
	await Promise.all(
		Array.from({ length: 12 }, async (_, index) =>
			sink.writeEvents({
				projectId: "project-a",
				events: [
					{
						id: `concurrent-event-${index}`,
						timestamp: "2026-06-14T00:00:00.000Z",
						type: eventTypes.TRACE_CREATE,
						body: {
							id: `concurrent-trace-${index}`,
							name: `Concurrent Trace ${index}`,
						},
					},
				],
				source: "test-concurrent",
			}),
		),
	);
	const duplicateResults = await Promise.all([
		sink.writeEvents({
			projectId: "project-a",
			events: [
				{
					id: "concurrent-duplicate-event",
					timestamp: "2026-06-14T00:00:01.000Z",
					type: eventTypes.TRACE_CREATE,
					body: {
						id: "concurrent-duplicate-trace",
						name: "Concurrent Duplicate Trace",
					},
				},
			],
			source: "test-concurrent",
		}),
		sink.writeEvents({
			projectId: "project-a",
			events: [
				{
					id: "concurrent-duplicate-event",
					timestamp: "2026-06-14T00:00:01.000Z",
					type: eventTypes.TRACE_CREATE,
					body: {
						id: "concurrent-duplicate-trace",
						name: "Concurrent Duplicate Trace",
					},
				},
			],
			source: "test-concurrent",
		}),
	]);

	const db = new AgentPondCache(dbPath);
	const rows = await db.query<{ count: bigint }>(
		"select count(*) as count from traces where id like 'concurrent-%'",
	);
	await db.close();

	assert.equal(Number(rows[0].count), 13);
	assert.equal(
		duplicateResults.reduce(
			(total, result) => total + result.eventsProcessed,
			0,
		),
		1,
	);
	assert.equal(
		duplicateResults.reduce((total, result) => total + result.eventsSkipped, 0),
		1,
	);
});

test("DuckDB ingestion sink resolves AgentPond environments from a pnpm workspace root", async () => {
	const root = mkdtempSync(join(tmpdir(), "agentpond-duckdb-workspace-"));
	const nested = join(root, "packages", "functions");
	mkdirSync(nested, { recursive: true });
	writeFileSync(
		join(root, "pnpm-workspace.yaml"),
		"packages:\n  - packages/*\n",
	);
	const sink = DuckDbIngestionSink.fromAgentPondEnv({
		name: "dev",
		cwd: nested,
		resolveWorkspace: true,
	});
	await sink.writeEvents({
		projectId: "project-a",
		events: [
			{
				id: "workspace-env-event",
				timestamp: "2026-06-14T00:00:00.000Z",
				type: eventTypes.TRACE_CREATE,
				body: { id: "workspace-env-trace", name: "Workspace Env Trace" },
			},
		],
		source: "test-workspace-env",
	});

	const db = new AgentPondCache(
		join(root, ".agentpond", "envs", "dev", "cache.duckdb"),
	);
	const rows = await db.query<{ id: string }>(
		"select id from traces where id = 'workspace-env-trace'",
	);
	await db.close();

	assert.deepEqual(rows, [{ id: "workspace-env-trace" }]);
});

test("DuckDB lock retry retries lock conflicts only", async () => {
	let lockAttempts = 0;
	const result = await retryDuckDbLockConflicts(async () => {
		lockAttempts += 1;
		if (lockAttempts === 1) throw new Error("Could not set lock on file");
		return "ok";
	});
	assert.equal(result, "ok");
	assert.equal(lockAttempts, 2);

	let nonLockAttempts = 0;
	await assert.rejects(
		retryDuckDbLockConflicts(async () => {
			nonLockAttempts += 1;
			throw new Error("projection failed");
		}),
		/projection failed/,
	);
	assert.equal(nonLockAttempts, 1);
});

test("DuckDB projection keeps newer event when an older event syncs later", async () => {
	const store = new MemoryObjectStore();
	const writer = new AcceptedEventWriter({ store, projectId: "project-a" });
	const db = createTempDb();

	await writer.writeAcceptedEvents(
		[
			{
				id: "trace-event",
				timestamp: "2026-06-14T00:00:00.000Z",
				type: eventTypes.TRACE_CREATE,
				body: { id: "trace-1", name: "Trace 1" },
			},
			{
				id: "newer-observation-event",
				timestamp: "2026-06-14T00:00:02.000Z",
				type: eventTypes.GENERATION_CREATE,
				body: {
					id: "observation-1",
					traceId: "trace-1",
					name: "newer observation",
					costDetails: { total: 0.2 },
				},
			},
		],
		"batch-1",
	);
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });

	await writer.writeAcceptedEvents(
		[
			{
				id: "older-observation-event",
				timestamp: "2026-06-14T00:00:01.000Z",
				type: eventTypes.GENERATION_CREATE,
				body: {
					id: "observation-1",
					traceId: "trace-1",
					name: "older observation",
					costDetails: { total: 0.1 },
				},
			},
		],
		"batch-2",
	);
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });

	const observations = await db.query<{ name: string; total_cost: number }>(
		"select name, total_cost from observations where id = 'observation-1'",
	);
	const traces = await db.query<{ total_cost: number | null }>(
		"select total_cost from traces where id = 'trace-1'",
	);
	await db.close();

	assert.deepEqual(observations, [
		{ name: "newer observation", total_cost: 0.2 },
	]);
	assert.deepEqual(traces, [{ total_cost: 0.2 }]);
});

test("DuckDB projection applies newer event synced after an older event", async () => {
	const store = new MemoryObjectStore();
	const writer = new AcceptedEventWriter({ store, projectId: "project-a" });
	const db = createTempDb();

	await writer.writeAcceptedEvents(
		[
			{
				id: "trace-event",
				timestamp: "2026-06-14T00:00:00.000Z",
				type: eventTypes.TRACE_CREATE,
				body: { id: "trace-1", name: "Trace 1" },
			},
			{
				id: "older-observation-event",
				timestamp: "2026-06-14T00:00:01.000Z",
				type: eventTypes.GENERATION_CREATE,
				body: {
					id: "observation-1",
					traceId: "trace-1",
					name: "older observation",
					costDetails: { total: 0.1 },
				},
			},
		],
		"batch-1",
	);
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });

	await writer.writeAcceptedEvents(
		[
			{
				id: "newer-observation-event",
				timestamp: "2026-06-14T00:00:02.000Z",
				type: eventTypes.GENERATION_CREATE,
				body: {
					id: "observation-1",
					traceId: "trace-1",
					name: "newer observation",
					costDetails: { total: 0.2 },
				},
			},
		],
		"batch-2",
	);
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });

	const observations = await db.query<{ name: string; total_cost: number }>(
		"select name, total_cost from observations where id = 'observation-1'",
	);
	const traces = await db.query<{ total_cost: number | null }>(
		"select total_cost from traces where id = 'trace-1'",
	);
	await db.close();

	assert.deepEqual(observations, [
		{ name: "newer observation", total_cost: 0.2 },
	]);
	assert.deepEqual(traces, [{ total_cost: 0.2 }]);
});

test("DuckDB projection breaks equal timestamps by event id", async () => {
	const { db } = await writeAndSync([
		{
			id: "a-observation-event",
			timestamp: "2026-06-14T00:00:01.000Z",
			type: eventTypes.GENERATION_CREATE,
			body: {
				id: "observation-1",
				traceId: "trace-1",
				name: "event a",
			},
		},
		{
			id: "b-observation-event",
			timestamp: "2026-06-14T00:00:01.000Z",
			type: eventTypes.GENERATION_CREATE,
			body: {
				id: "observation-1",
				traceId: "trace-1",
				name: "event b",
			},
		},
	]);

	const observations = await db.query<{ name: string }>(
		"select name from observations where id = 'observation-1'",
	);
	await db.close();

	assert.deepEqual(observations, [{ name: "event b" }]);
});

test("DuckDB projection keeps whole-row replacement semantics for partial updates", async () => {
	const store = new MemoryObjectStore();
	const writer = new AcceptedEventWriter({ store, projectId: "project-a" });
	const db = createTempDb();

	await writer.writeAcceptedEvents(
		[
			{
				id: "trace-event",
				timestamp: "2026-06-14T00:00:00.000Z",
				type: eventTypes.TRACE_CREATE,
				body: { id: "trace-1", name: "Trace 1" },
			},
			{
				id: "create-observation-event",
				timestamp: "2026-06-14T00:00:01.000Z",
				type: eventTypes.GENERATION_CREATE,
				body: {
					id: "observation-1",
					traceId: "trace-1",
					name: "created observation",
					input: { prompt: "older input" },
					costDetails: { total: 0.4 },
				},
			},
		],
		"batch-1",
	);
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });

	await writer.writeAcceptedEvents(
		[
			{
				id: "update-observation-event",
				timestamp: "2026-06-14T00:00:02.000Z",
				type: eventTypes.GENERATION_UPDATE,
				body: {
					id: "observation-1",
					output: { answer: "newer output" },
				},
			},
		],
		"batch-2",
	);
	const second = await db.syncFromStore({
		store,
		projectId: "project-a",
		prefix: "",
	});

	const observations = await db.query<{
		trace_id: string | null;
		input_json: string | null;
		output_json: string | null;
		total_cost: number | null;
	}>(
		"select trace_id, input_json, output_json, total_cost from observations where id = 'observation-1'",
	);
	const traces = await db.query<{ total_cost: number | null }>(
		"select total_cost from traces where id = 'trace-1'",
	);
	const noop = await db.syncFromStore({
		store,
		projectId: "project-a",
		prefix: "",
	});
	await db.close();

	assert.equal(second.eventsProcessed, 1);
	assert.deepEqual(observations, [
		{
			trace_id: null,
			input_json: null,
			output_json: JSON.stringify({ answer: "newer output" }),
			total_cost: null,
		},
	]);
	assert.deepEqual(traces, [{ total_cost: null }]);
	assert.equal(noop.objectsProcessed, 0);
	assert.equal(noop.eventsProcessed, 0);
});

test("DuckDB score projection uses latest timestamp for the same score", async () => {
	const store = new MemoryObjectStore();
	const writer = new AcceptedEventWriter({ store, projectId: "project-a" });
	const db = createTempDb();

	await writer.writeAcceptedEvents(
		[
			{
				id: "newer-score-event",
				timestamp: "2026-06-14T00:00:02.000Z",
				type: eventTypes.SCORE_CREATE,
				body: {
					id: "score-1",
					traceId: "trace-1",
					name: "quality",
					value: 0.9,
				},
			},
		],
		"batch-1",
	);
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });

	await writer.writeAcceptedEvents(
		[
			{
				id: "older-score-event",
				timestamp: "2026-06-14T00:00:01.000Z",
				type: eventTypes.SCORE_CREATE,
				body: {
					id: "score-1",
					traceId: "trace-1",
					name: "quality",
					value: 0.1,
				},
			},
		],
		"batch-2",
	);
	await db.syncFromStore({ store, projectId: "project-a", prefix: "" });

	const scores = await db.query<{ value: number }>(
		"select value from scores where id = 'score-1'",
	);
	await db.close();

	assert.deepEqual(scores, [{ value: 0.9 }]);
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
