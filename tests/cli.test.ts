import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	type AgentPondConfig,
	eventTypes,
	type IngestionEvent,
	MemoryObjectStore,
} from "@agentpond/core";
import { AgentPondDuckDb } from "@agentpond/duckdb";
import { createOtelTraceId, main } from "../apps/cli/src/index.js";
import { manualTraceResourceSpans } from "../apps/cli/src/otel-trace.js";
import { writeEventsAndSyncCache } from "../apps/cli/src/sync-write.js";

async function captureStdout(fn: () => Promise<void>): Promise<string> {
	const consoleLog = console.log;
	const consoleTable = console.table;
	const chunks: string[] = [];
	console.log = (...args: unknown[]) => {
		chunks.push(`${args.map(String).join(" ")}\n`);
	};
	console.table = (tabularData?: unknown) => {
		chunks.push(`${JSON.stringify(tabularData)}\n`);
	};
	try {
		await fn();
	} finally {
		console.log = consoleLog;
		console.table = consoleTable;
	}
	return chunks.join("");
}

async function captureStderr(fn: () => Promise<void>): Promise<string> {
	const consoleError = console.error;
	const chunks: string[] = [];
	console.error = (...args: unknown[]) => {
		chunks.push(`${args.map(String).join(" ")}\n`);
	};
	try {
		await fn();
	} finally {
		console.error = consoleError;
	}
	return chunks.join("");
}

function testConfig(dbPath: string): AgentPondConfig {
	return {
		projectId: "default-project",
		dbPath,
		s3: {
			bucket: "agentpond",
			prefix: "",
			region: "us-east-1",
			forcePathStyle: true,
		},
	};
}

test("CLI trace creation builds a Langfuse-compatible OTEL root span", () => {
	const resourceSpans = manualTraceResourceSpans(
		{
			flags: {
				name: "Manual Trace",
				userId: "user-1",
				sessionId: "session-1",
				input: '{"prompt":"hello"}',
				output: "done",
				metadata: '{"plan":"pro","attempt":2}',
			},
			positionals: [],
		},
		"0123456789abcdef0123456789abcdef",
		"2026-06-14T11:03:19.419Z",
	) as Array<{
		scopeSpans: Array<{
			spans: Array<{
				traceId: string;
				spanId: string;
				name: string;
				startTimeUnixNano: string;
				endTimeUnixNano: string;
				attributes: Array<{
					key: string;
					value: {
						stringValue?: string;
						doubleValue?: number;
						boolValue?: boolean;
					};
				}>;
			}>;
		}>;
	}>;

	const span = resourceSpans[0].scopeSpans[0].spans[0];
	const attributes = new Map(
		span.attributes.map((attribute) => [attribute.key, attribute.value]),
	);

	assert.equal(span.traceId, "0123456789abcdef0123456789abcdef");
	assert.match(span.spanId, /^[0-9a-f]{16}$/);
	assert.equal(span.name, "Manual Trace");
	assert.equal(span.startTimeUnixNano, "1781434999419000000");
	assert.equal(span.endTimeUnixNano, "1781434999419000000");
	assert.deepEqual(attributes.get("langfuse.observation.type"), {
		stringValue: "span",
	});
	assert.deepEqual(attributes.get("langfuse.trace.name"), {
		stringValue: "Manual Trace",
	});
	assert.deepEqual(attributes.get("langfuse.environment"), {
		stringValue: "default",
	});
	assert.deepEqual(attributes.get("user.id"), { stringValue: "user-1" });
	assert.deepEqual(attributes.get("session.id"), {
		stringValue: "session-1",
	});
	assert.deepEqual(attributes.get("langfuse.trace.input"), {
		stringValue: '{"prompt":"hello"}',
	});
	assert.deepEqual(attributes.get("langfuse.observation.input"), {
		stringValue: '{"prompt":"hello"}',
	});
	assert.deepEqual(attributes.get("langfuse.trace.output"), {
		stringValue: "done",
	});
	assert.deepEqual(attributes.get("langfuse.observation.output"), {
		stringValue: "done",
	});
	assert.deepEqual(attributes.get("langfuse.trace.metadata.plan"), {
		stringValue: "pro",
	});
	assert.deepEqual(attributes.get("langfuse.trace.metadata.attempt"), {
		doubleValue: 2,
	});
});

test("CLI default trace ids are OTEL trace ids", () => {
	assert.match(createOtelTraceId(), /^[0-9a-f]{32}$/);
});

test("CLI-created scores are immediately visible to score list queries", async () => {
	const store = new MemoryObjectStore();
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "agentpond-cli-")),
		"cache.duckdb",
	);
	const config = testConfig(dbPath);
	const event: IngestionEvent = {
		id: "score-event-1",
		timestamp: "2026-06-14T11:03:19.419Z",
		type: eventTypes.SCORE_CREATE,
		body: {
			id: "score-1",
			traceId: "0",
			name: "quality",
			value: 0.9,
			source: "API",
			createdAt: "2026-06-14T11:03:19.419Z",
		},
	};

	await writeEventsAndSyncCache(config, store, [event]);

	const db = new AgentPondDuckDb(dbPath);
	const rows = await db.query<{
		id: string;
		trace_id: string;
		name: string;
		value: number;
	}>("SELECT id, trace_id, name, value FROM scores WHERE trace_id = '0'");
	await db.close();

	assert.deepEqual(rows, [
		{ id: "score-1", trace_id: "0", name: "quality", value: 0.9 },
	]);
});

test("CLI trace and observation reads expose provided usage and cost fields as JSON", async () => {
	const store = new MemoryObjectStore();
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "agentpond-cli-")),
		"cache.duckdb",
	);
	const config = testConfig(dbPath);
	const events: IngestionEvent[] = [
		{
			id: "trace-event-1",
			timestamp: "2026-06-14T11:03:19.000Z",
			type: eventTypes.TRACE_CREATE,
			body: {
				id: "trace-1",
				name: "Trace 1",
				sessionId: "session-1",
				startTime: "2026-06-14T11:03:19.000Z",
			},
		},
		{
			id: "observation-event-1",
			timestamp: "2026-06-14T11:03:20.000Z",
			type: eventTypes.GENERATION_CREATE,
			body: {
				id: "observation-1",
				traceId: "trace-1",
				name: "Generation 1",
				startTime: "2026-06-14T11:03:20.000Z",
				usageDetails: { input: 38, output: 22, total: 60 },
				costDetails: { input: 0.038, output: 0.044, total: 0.082 },
			},
		},
	];

	await writeEventsAndSyncCache(config, store, events);

	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		const observationsOutput = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"--db",
				dbPath,
				"observations",
				"list",
				"--traceId",
				"trace-1",
				"--json",
			]),
		);
		const observations = JSON.parse(observationsOutput) as Array<{
			id: string;
			usage_details_json: string;
			cost_details_json: string;
			total_cost: number;
		}>;
		assert.equal(observations[0].id, "observation-1");
		assert.deepEqual(JSON.parse(observations[0].usage_details_json), {
			input: 38,
			output: 22,
			total: 60,
		});
		assert.deepEqual(JSON.parse(observations[0].cost_details_json), {
			input: 0.038,
			output: 0.044,
			total: 0.082,
		});
		assert.equal(observations[0].total_cost, 0.082);

		const traceOutput = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"--db",
				dbPath,
				"traces",
				"get",
				"trace-1",
				"--json",
			]),
		);
		const traces = JSON.parse(traceOutput) as Array<{
			id: string;
			total_cost: number;
		}>;
		assert.equal(traces.length, 1);
		assert.equal(traces[0].id, "trace-1");
		assert.equal(traces[0].total_cost, 0.082);
		assert.equal(process.exitCode, undefined);
	} finally {
		process.exitCode = originalExitCode;
	}
});

test("CLI observation list has stable order for identical start times", async () => {
	const store = new MemoryObjectStore();
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "agentpond-cli-")),
		"cache.duckdb",
	);
	const config = testConfig(dbPath);
	await writeEventsAndSyncCache(config, store, [
		{
			id: "trace-event-1",
			timestamp: "2026-06-19T07:54:54.798Z",
			type: eventTypes.TRACE_CREATE,
			body: {
				id: "trace-ordered",
				name: "Trace Ordered",
				startTime: "2026-06-19T07:54:54.798Z",
			},
		},
		{
			id: "later-id-event",
			timestamp: "2026-06-19T07:54:54.798Z",
			type: eventTypes.SPAN_CREATE,
			body: {
				id: "b-span",
				traceId: "trace-ordered",
				name: "B Span",
				startTime: "2026-06-19T07:54:54.798Z",
			},
		},
		{
			id: "earlier-id-event",
			timestamp: "2026-06-19T07:54:54.798Z",
			type: eventTypes.SPAN_CREATE,
			body: {
				id: "a-span",
				traceId: "trace-ordered",
				name: "A Span",
				startTime: "2026-06-19T07:54:54.798Z",
			},
		},
	]);

	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		const output = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"--db",
				dbPath,
				"observations",
				"list",
				"--traceId",
				"trace-ordered",
				"--json",
			]),
		);
		const observations = JSON.parse(output) as Array<{ id: string }>;

		assert.equal(process.exitCode, undefined);
		assert.deepEqual(
			observations.map((observation) => observation.id),
			["a-span", "b-span"],
		);
	} finally {
		process.exitCode = originalExitCode;
	}
});

test("CLI read commands report missing required score filters", async () => {
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "agentpond-cli-")),
		"cache.duckdb",
	);
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "--db", dbPath, "scores", "list", "--json"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /scores list requires --traceId or --observationId/);
	} finally {
		process.exitCode = originalExitCode;
	}
});

test("CLI returns non-zero errors for invalid resources and actions", async () => {
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "agentpond-cli-")),
		"cache.duckdb",
	);
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "--db", dbPath, "frobs", "list"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /Unknown command: frobs list/);
	} finally {
		process.exitCode = originalExitCode;
	}
});

test("CLI --limit caps list result count", async () => {
	const store = new MemoryObjectStore();
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "agentpond-cli-")),
		"cache.duckdb",
	);
	const config = testConfig(dbPath);
	await writeEventsAndSyncCache(config, store, [
		{
			id: "trace-event-1",
			timestamp: "2026-06-14T00:00:00.000Z",
			type: eventTypes.TRACE_CREATE,
			body: { id: "trace-1", name: "Trace 1" },
		},
		{
			id: "trace-event-2",
			timestamp: "2026-06-14T00:00:01.000Z",
			type: eventTypes.TRACE_CREATE,
			body: { id: "trace-2", name: "Trace 2" },
		},
		{
			id: "trace-event-3",
			timestamp: "2026-06-14T00:00:02.000Z",
			type: eventTypes.TRACE_CREATE,
			body: { id: "trace-3", name: "Trace 3" },
		},
	]);

	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		const output = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"--db",
				dbPath,
				"traces",
				"list",
				"--limit",
				"2",
				"--json",
			]),
		);
		const traces = JSON.parse(output) as Array<{ id: string }>;

		assert.equal(process.exitCode, undefined);
		assert.equal(traces.length, 2);
	} finally {
		process.exitCode = originalExitCode;
	}
});

test("CLI --json returns parseable JSON for empty result sets", async () => {
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "agentpond-cli-")),
		"cache.duckdb",
	);
	const db = new AgentPondDuckDb(dbPath);
	await db.close();

	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		const output = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"--db",
				dbPath,
				"traces",
				"get",
				"missing",
				"--json",
			]),
		);

		assert.equal(process.exitCode, undefined);
		assert.deepEqual(JSON.parse(output), []);
	} finally {
		process.exitCode = originalExitCode;
	}
});
