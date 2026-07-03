import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	type AgentPondConfig,
	acquireDevServerLock,
	eventTypes,
	type IngestionEvent,
	initAgentPondEnvironment,
	MemoryObjectStore,
} from "@agentpond/core";
import { AgentPondCache } from "@agentpond/duckdb";
import { createDevLoggerOptions } from "../src/commands/dev.js";
import { createOtelTraceId, main } from "../src/index.js";
import { manualTraceResourceSpans } from "../src/otel-trace.js";
import { writeEventsAndSyncCache } from "../src/sync-write.js";

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

async function captureProcessStdout(fn: () => Promise<void>): Promise<string> {
	const write = process.stdout.write;
	const chunks: string[] = [];
	process.stdout.write = ((chunk: string | Uint8Array) => {
		chunks.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
	try {
		await fn();
	} finally {
		process.stdout.write = write;
	}
	return chunks.join("");
}

function testConfig(dbPath: string): AgentPondConfig {
	return {
		projectId: "default-project",
		dbPath,
		prefix: "",
	};
}

function devDbPath(root: string): string {
	return join(root, ".agentpond", "envs", "dev", "cache.duckdb");
}

test("CLI trace creation builds a Langfuse-compatible OTEL root span", () => {
	const resourceSpans = manualTraceResourceSpans(
		{
			name: "Manual Trace",
			userId: "user-1",
			sessionId: "session-1",
			input: '{"prompt":"hello"}',
			output: "done",
			metadata: '{"plan":"pro","attempt":2}',
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

test("CLI trace creation preserves nested metadata values", async () => {
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "agentpond-cli-")),
		"cache.duckdb",
	);
	const resourceSpans = manualTraceResourceSpans(
		{
			metadata: '{"details":{"tier":"pro"},"tags":["a","b"],"plain":"ok"}',
		},
		"0123456789abcdef0123456789abcdef",
		"2026-06-14T11:03:19.419Z",
	);
	const store = new MemoryObjectStore();
	await store.putJson(
		"otel/default-project/2026/06/14/11/03/batch-1.json",
		resourceSpans,
	);
	const db = new AgentPondCache(dbPath);
	await db.syncFromStore({
		store,
		projectId: "default-project",
		prefix: "",
	});
	const traces = await db.query<{ metadata_json: string }>(
		"SELECT metadata_json FROM traces WHERE id = '0123456789abcdef0123456789abcdef'",
	);
	await db.close();

	assert.deepEqual(JSON.parse(traces[0].metadata_json), {
		details: { tier: "pro" },
		tags: ["a", "b"],
		plain: "ok",
	});
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

	const db = new AgentPondCache(dbPath);
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
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-"));
	const dbPath = devDbPath(root);
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
		process.chdir(root);
		const observationsOutput = await captureStdout(() =>
			main([
				"node",
				"agentpond",
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
			main(["node", "agentpond", "traces", "get", "trace-1", "--json"]),
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
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI observation list has stable order for identical start times", async () => {
	const store = new MemoryObjectStore();
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-"));
	const dbPath = devDbPath(root);
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
		process.chdir(root);
		const output = await captureStdout(() =>
			main([
				"node",
				"agentpond",
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
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI read commands report missing required score filters", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "scores", "list", "--json"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /scores list requires --traceId or --observationId/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI reports the selected environment when --env is omitted for non-JSON commands", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-log-"));
	const dbPath = devDbPath(root);
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const db = new AgentPondCache(dbPath);
		await db.ensureSchema();
		await db.close();

		const stderr = await captureStderr(() =>
			captureStdout(() => main(["node", "agentpond", "traces", "list"])),
		);

		assert.equal(process.exitCode, undefined);
		assert.match(stderr, /Using AgentPond environment: dev/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI does not report implicit environment in JSON output", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-"));
	const dbPath = devDbPath(root);
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const db = new AgentPondCache(dbPath);
		await db.ensureSchema();
		await db.close();

		const stderr = await captureStderr(() =>
			captureStdout(() =>
				main(["node", "agentpond", "traces", "list", "--json"]),
			),
		);

		assert.equal(process.exitCode, undefined);
		assert.equal(stderr, "");
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env current defaults to table output and keeps JSON behind --json", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-current-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const tableOutput = await captureStdout(() =>
			main(["node", "agentpond", "env", "current"]),
		);
		assert.equal(process.exitCode, undefined);
		assert.match(tableOutput, /^\[/);
		assert.match(tableOutput, /"name":"dev"/);

		const jsonOutput = await captureStdout(() =>
			main(["node", "agentpond", "env", "current", "--json"]),
		);
		const environment = JSON.parse(jsonOutput) as {
			name: string;
			dbPath: string;
		};
		assert.equal(environment.name, "dev");
		assert.match(environment.dbPath, /\.agentpond\/envs\/dev\/cache\.duckdb$/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI sync is a no-op for the dev environment", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-sync-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main(["node", "agentpond", "sync", "--json"]),
		);
		const result = JSON.parse(output) as { skipped: boolean; reason: string };

		assert.equal(process.exitCode, undefined);
		assert.equal(result.skipped, true);
		assert.match(result.reason, /sync is not needed for agentpond dev/);
		assert.equal(
			existsSync(join(root, ".agentpond", "envs", "dev", "cache.duckdb")),
			false,
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI traces create writes directly to the dev DuckDB", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-trace-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"traces",
				"create",
				"--env",
				"dev",
				"--id",
				"0123456789abcdef0123456789abcdef",
				"--name",
				"Direct Dev Trace",
				"--json",
			]),
		);
		const result = JSON.parse(output) as {
			traceId: string;
			eventsProcessed: number;
		};

		assert.equal(process.exitCode, undefined);
		assert.equal(result.traceId, "0123456789abcdef0123456789abcdef");
		assert.equal(result.eventsProcessed, 2);
		assert.equal(
			existsSync(join(root, ".agentpond", "envs", "dev", "events")),
			false,
		);

		const db = new AgentPondCache(
			join(root, ".agentpond", "envs", "dev", "cache.duckdb"),
		);
		const rows = await db.query<{ id: string; name: string }>(
			"SELECT id, name FROM traces WHERE id = '0123456789abcdef0123456789abcdef'",
		);
		await db.close();

		assert.deepEqual(rows, [
			{
				id: "0123456789abcdef0123456789abcdef",
				name: "Direct Dev Trace",
			},
		]);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI scores create writes directly to the dev DuckDB", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-score-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"scores",
				"create",
				"--env",
				"dev",
				"--id",
				"score-direct",
				"--name",
				"quality",
				"--value",
				"0.95",
				"--traceId",
				"trace-direct",
				"--json",
			]),
		);
		const result = JSON.parse(output) as {
			scoreId: string;
			eventsProcessed: number;
		};

		assert.equal(process.exitCode, undefined);
		assert.equal(result.scoreId, "score-direct");
		assert.equal(result.eventsProcessed, 1);
		assert.equal(
			existsSync(join(root, ".agentpond", "envs", "dev", "events")),
			false,
		);

		const db = new AgentPondCache(
			join(root, ".agentpond", "envs", "dev", "cache.duckdb"),
		);
		const rows = await db.query<{
			id: string;
			trace_id: string;
			name: string;
			value: number;
		}>(
			"SELECT id, trace_id, name, value FROM scores WHERE id = 'score-direct'",
		);
		await db.close();

		assert.deepEqual(rows, [
			{
				id: "score-direct",
				trace_id: "trace-direct",
				name: "quality",
				value: 0.95,
			},
		]);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env get dev prints generated shell exports without creating dev env file", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-env-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main(["node", "agentpond", "env", "get", "dev"]),
		);

		assert.equal(process.exitCode, undefined);
		assert.equal(
			output,
			[
				"export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318/api/public/otel",
				"export OTEL_EXPORTER_OTLP_PROTOCOL=http/json",
				"export LANGFUSE_BASE_URL=http://127.0.0.1:4318",
				"export LANGFUSE_PUBLIC_KEY=pk-agentpond-dev",
				"export LANGFUSE_SECRET_KEY=sk-agentpond-dev",
				"",
			].join("\n"),
		);
		assert.equal(
			existsSync(join(root, ".agentpond", "envs", "dev.env")),
			false,
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env get dev --otel prints only OTEL exports", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-env-otel-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main(["node", "agentpond", "env", "get", "dev", "--otel"]),
		);

		assert.equal(process.exitCode, undefined);
		assert.equal(
			output,
			[
				"export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318/api/public/otel",
				"export OTEL_EXPORTER_OTLP_PROTOCOL=http/json",
				"",
			].join("\n"),
		);
		assert.equal(
			existsSync(join(root, ".agentpond", "envs", "dev.env")),
			false,
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env get dev --langfuse prints only Langfuse-compatible exports", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-env-langfuse-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main(["node", "agentpond", "env", "get", "dev", "--langfuse"]),
		);

		assert.equal(process.exitCode, undefined);
		assert.equal(
			output,
			[
				"export LANGFUSE_BASE_URL=http://127.0.0.1:4318",
				"export LANGFUSE_PUBLIC_KEY=pk-agentpond-dev",
				"export LANGFUSE_SECRET_KEY=sk-agentpond-dev",
				"",
			].join("\n"),
		);
		assert.equal(
			existsSync(join(root, ".agentpond", "envs", "dev.env")),
			false,
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env get rejects conflicting env family flags", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-env-conflict-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main([
				"node",
				"agentpond",
				"env",
				"get",
				"dev",
				"--otel",
				"--langfuse",
			]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /--langfuse and --otel cannot be used together/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env get dev honors custom host and port", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-env-override-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"env",
				"get",
				"dev",
				"--host",
				"0.0.0.0",
				"--port",
				"9999",
			]),
		);

		assert.equal(process.exitCode, undefined);
		assert.match(
			output,
			/export OTEL_EXPORTER_OTLP_ENDPOINT=http:\/\/0\.0\.0\.0:9999\/api\/public\/otel/,
		);
		assert.match(output, /export LANGFUSE_BASE_URL=http:\/\/0\.0\.0\.0:9999/);
		assert.match(output, /export LANGFUSE_PUBLIC_KEY=pk-agentpond-dev/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI dev logger prints JSON logs and suppresses server listen logs", () => {
	const loggerOptions = createDevLoggerOptions();
	assert.ok(loggerOptions.stream);
	const write = process.stdout.write;
	const chunks: string[] = [];
	process.stdout.write = ((chunk: string | Uint8Array) => {
		chunks.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
	try {
		loggerOptions.stream.write(
			`${JSON.stringify({
				level: 30,
				msg: "ingested event",
				source: "ingestion",
				projectId: "default-project",
				eventId: "event-1",
				eventType: eventTypes.TRACE_CREATE,
				entityId: "trace-1",
			})}\n`,
		);
		loggerOptions.stream.write(
			`${JSON.stringify({
				level: 30,
				msg: "ingested otel payload",
				source: "otel",
				projectId: "default-project",
				resourceSpanCount: 1,
			})}\n`,
		);
		loggerOptions.stream.write(
			`${JSON.stringify({
				level: 30,
				msg: "incoming request",
				reqId: "req-1",
			})}\n`,
		);
		loggerOptions.stream.write(
			`${JSON.stringify({
				level: 30,
				msg: "Server listening at http://127.0.0.1:4318",
			})}\n`,
		);
	} finally {
		process.stdout.write = write;
	}

	assert.deepEqual(
		chunks
			.join("")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line)),
		[
			{
				level: 30,
				msg: "ingested event",
				source: "ingestion",
				projectId: "default-project",
				eventId: "event-1",
				eventType: eventTypes.TRACE_CREATE,
				entityId: "trace-1",
			},
			{
				level: 30,
				msg: "ingested otel payload",
				source: "otel",
				projectId: "default-project",
				resourceSpanCount: 1,
			},
			{
				level: 30,
				msg: "incoming request",
				reqId: "req-1",
			},
		],
	);
});

test("CLI dev write commands fail while the dev server lock is active", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-lock-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const environment = initAgentPondEnvironment("dev");
		const lock = acquireDevServerLock(environment);
		try {
			const stderr = await captureStderr(() =>
				main([
					"node",
					"agentpond",
					"traces",
					"create",
					"--id",
					"0123456789abcdef0123456789abcdef",
				]),
			);

			assert.equal(process.exitCode, 2);
			assert.match(
				stderr,
				/dev server is running; stop it or use the dev ingestion endpoint/,
			);
		} finally {
			lock.release();
		}
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI read commands work while the dev server lock is active", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-read-lock-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const environment = initAgentPondEnvironment("dev");
		const db = new AgentPondCache(environment.dbPath);
		await db.ensureSchema();
		await db.directIngestion().writeEvents({
			projectId: "default-project",
			events: [
				{
					id: "trace-read-event",
					timestamp: "2026-06-14T00:00:00.000Z",
					type: eventTypes.TRACE_CREATE,
					body: {
						id: "trace-read",
						name: "Readable Trace",
						sessionId: "session-read",
					},
				},
				{
					id: "observation-read-event",
					timestamp: "2026-06-14T00:00:01.000Z",
					type: eventTypes.GENERATION_CREATE,
					body: {
						id: "observation-read",
						traceId: "trace-read",
						name: "Readable Observation",
					},
				},
				{
					id: "score-read-event",
					timestamp: "2026-06-14T00:00:02.000Z",
					type: eventTypes.SCORE_CREATE,
					body: {
						id: "score-read",
						traceId: "trace-read",
						name: "readability",
						value: 1,
					},
				},
			],
			source: "test-read-lock",
		});
		await db.close();
		const lock = acquireDevServerLock(environment);
		try {
			const runJson = async (args: string[]) => {
				process.exitCode = undefined;
				const output = await captureStdout(() =>
					main(["node", "agentpond", ...args, "--json"]),
				);
				assert.equal(process.exitCode, undefined);
				return JSON.parse(output) as Array<Record<string, unknown>>;
			};

			assert.equal(
				(await runJson(["traces", "get", "trace-read"]))[0].id,
				"trace-read",
			);
			assert.equal((await runJson(["traces", "list"]))[0].id, "trace-read");
			assert.equal(
				(await runJson(["observations", "list", "--traceId", "trace-read"]))[0]
					.id,
				"observation-read",
			);
			assert.equal((await runJson(["sessions", "list"]))[0].id, "session-read");
			assert.equal(
				(await runJson(["sessions", "get", "session-read"]))[0].id,
				"session-read",
			);
			assert.equal(
				(await runJson(["scores", "list", "--traceId", "trace-read"]))[0].id,
				"score-read",
			);
			assert.equal(
				(await runJson(["sql", "SELECT id FROM traces"]))[0].id,
				"trace-read",
			);
		} finally {
			lock.release();
		}
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI returns non-zero errors for invalid resources and actions", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "frobs", "list"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /unknown command 'frobs'/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI without arguments exits successfully", async () => {
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		await main(["node", "agentpond"]);

		assert.equal(process.exitCode, undefined);
	} finally {
		process.exitCode = originalExitCode;
	}
});

test("CLI reports unknown options as user errors", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-unknown-option-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "traces", "list", "--wat"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /unknown option '--wat'/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI supports equals-style flag values", async () => {
	const store = new MemoryObjectStore();
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-equals-"));
	const dbPath = devDbPath(root);
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
	]);

	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main(["node", "agentpond", "traces", "--json", "list", "--limit=1"]),
		);
		const traces = JSON.parse(output) as Array<{ id: string }>;

		assert.equal(process.exitCode, undefined);
		assert.equal(traces.length, 1);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI command-local help does not open the environment cache", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-help-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureProcessStdout(() =>
			main(["node", "agentpond", "traces", "list", "--help"]),
		);

		assert.equal(process.exitCode, undefined);
		assert.match(output, /Usage: agentpond traces list/);
		assert.equal(existsSync(join(root, ".agentpond")), false);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env init writes GCS store files from --store", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-init-store-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"env",
				"init",
				"staging",
				"--store",
				"gcs",
				"--json",
			]),
		);
		const result = JSON.parse(output) as {
			store: string;
			envFile: string;
		};

		assert.equal(process.exitCode, undefined);
		assert.equal(result.store, "gcs");
		assert.match(readFileSync(result.envFile, "utf8"), /AGENTPOND_STORE=gcs/);
		assert.match(
			readFileSync(result.envFile, "utf8"),
			/AGENTPOND_GCS_BUCKET=agentpond/,
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env init writes Vercel store files from --store", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-init-vercel-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"env",
				"init",
				"staging",
				"--store",
				"vercel",
				"--json",
			]),
		);
		const result = JSON.parse(output) as {
			store: string;
			envFile: string;
		};
		const envFile = readFileSync(result.envFile, "utf8");

		assert.equal(process.exitCode, undefined);
		assert.equal(result.store, "vercel");
		assert.match(envFile, /AGENTPOND_STORE=vercel/);
		assert.match(envFile, /AGENTPOND_BLOB_ACCESS=private/);
		assert.match(envFile, /BLOB_READ_WRITE_TOKEN=/);
		assert.match(envFile, /BLOB_STORE_ID=/);
		assert.match(envFile, /VERCEL_OIDC_TOKEN=/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env init writes S3 and local store files from --store", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-init-stores-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const awsOutput = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"env",
				"init",
				"s3-env",
				"--store",
				"s3",
				"--json",
			]),
		);
		const localOutput = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"env",
				"init",
				"local-env",
				"--store",
				"local",
				"--json",
			]),
		);
		const s3 = JSON.parse(awsOutput) as { store: string; envFile: string };
		const local = JSON.parse(localOutput) as {
			store: string;
			envFile: string;
		};

		assert.equal(process.exitCode, undefined);
		assert.equal(s3.store, "s3");
		assert.match(readFileSync(s3.envFile, "utf8"), /AGENTPOND_STORE=s3/);
		assert.match(readFileSync(s3.envFile, "utf8"), /AGENTPOND_S3_BUCKET/);
		assert.equal(local.store, "local");
		assert.match(readFileSync(local.envFile, "utf8"), /AGENTPOND_STORE=local/);
		assert.doesNotMatch(
			readFileSync(local.envFile, "utf8"),
			/AGENTPOND_S3_BUCKET/,
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env init rejects invalid stores", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-init-invalid-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "env", "init", "staging", "--store", "azure"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /--store must be s3, gcs, vercel, or local/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env init without --store errors in non-interactive mode", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-init-nontty-"));
	const originalExitCode = process.exitCode;
	const stdinDescriptor = Object.getOwnPropertyDescriptor(
		process.stdin,
		"isTTY",
	);
	const stdoutDescriptor = Object.getOwnPropertyDescriptor(
		process.stdout,
		"isTTY",
	);
	process.exitCode = undefined;
	try {
		process.chdir(root);
		Object.defineProperty(process.stdin, "isTTY", {
			configurable: true,
			value: false,
		});
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: false,
		});
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "env", "init", "staging"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /Missing --store/);
	} finally {
		if (stdinDescriptor)
			Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
		if (stdoutDescriptor)
			Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env init can select a store interactively", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-init-tty-"));
	const originalExitCode = process.exitCode;
	const stdinDescriptor = Object.getOwnPropertyDescriptor(
		process.stdin,
		"isTTY",
	);
	const stdoutDescriptor = Object.getOwnPropertyDescriptor(
		process.stdout,
		"isTTY",
	);
	process.exitCode = undefined;
	try {
		process.chdir(root);
		Object.defineProperty(process.stdin, "isTTY", {
			configurable: true,
			value: true,
		});
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});
		const output = await captureStdout(() =>
			main(["node", "agentpond", "env", "init", "staging", "--json"], {
				selectStore: async ({ choices }) => {
					assert.deepEqual(
						choices.map((choice) => choice.value),
						["s3", "gcs", "vercel", "local"],
					);
					return "local";
				},
			}),
		);
		const result = JSON.parse(output) as {
			store: string;
			envFile: string;
		};

		assert.equal(process.exitCode, undefined);
		assert.equal(result.store, "local");
		assert.match(readFileSync(result.envFile, "utf8"), /AGENTPOND_STORE=local/);
	} finally {
		if (stdinDescriptor)
			Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
		if (stdoutDescriptor)
			Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env use without a name errors in non-interactive mode", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-use-nontty-"));
	const originalExitCode = process.exitCode;
	const stdinDescriptor = Object.getOwnPropertyDescriptor(
		process.stdin,
		"isTTY",
	);
	const stdoutDescriptor = Object.getOwnPropertyDescriptor(
		process.stdout,
		"isTTY",
	);
	process.exitCode = undefined;
	try {
		process.chdir(root);
		Object.defineProperty(process.stdin, "isTTY", {
			configurable: true,
			value: false,
		});
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: false,
		});
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "env", "use"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /Missing environment name/);
	} finally {
		if (stdinDescriptor)
			Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
		if (stdoutDescriptor)
			Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env use can select an environment interactively", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-use-tty-"));
	const originalExitCode = process.exitCode;
	const stdinDescriptor = Object.getOwnPropertyDescriptor(
		process.stdin,
		"isTTY",
	);
	const stdoutDescriptor = Object.getOwnPropertyDescriptor(
		process.stdout,
		"isTTY",
	);
	process.exitCode = undefined;
	try {
		process.chdir(root);
		initAgentPondEnvironment("staging");
		Object.defineProperty(process.stdin, "isTTY", {
			configurable: true,
			value: true,
		});
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});
		const output = await captureStdout(() =>
			main(["node", "agentpond", "env", "use", "--json"], {
				selectEnvironment: async ({ choices }) => {
					assert.deepEqual(
						choices.map((choice) => choice.value),
						["staging"],
					);
					return "staging";
				},
			}),
		);

		assert.equal(process.exitCode, undefined);
		assert.deepEqual(JSON.parse(output), { selected: "staging" });
	} finally {
		if (stdinDescriptor)
			Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
		if (stdoutDescriptor)
			Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI --limit caps list result count", async () => {
	const store = new MemoryObjectStore();
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-"));
	const dbPath = devDbPath(root);
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
		process.chdir(root);
		const output = await captureStdout(() =>
			main(["node", "agentpond", "traces", "list", "--limit", "2", "--json"]),
		);
		const traces = JSON.parse(output) as Array<{ id: string }>;

		assert.equal(process.exitCode, undefined);
		assert.equal(traces.length, 2);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI --json returns parseable JSON for empty result sets", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-"));
	const dbPath = devDbPath(root);
	const db = new AgentPondCache(dbPath);
	await db.ensureSchema();
	await db.close();

	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main(["node", "agentpond", "traces", "get", "missing", "--json"]),
		);

		assert.equal(process.exitCode, undefined);
		assert.deepEqual(JSON.parse(output), []);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});
