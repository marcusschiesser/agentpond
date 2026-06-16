import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { eventTypes, MemoryObjectStore, type AgentPondConfig, type IngestionEvent } from "@agentpond/core";
import { AgentPondDuckDb } from "@agentpond/duckdb";
import { main, writeEventsAndSyncCache } from "../apps/cli/src/index.js";

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const stdoutWrite = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  process.stdout.write = ((chunk: any) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await fn();
  } finally {
    process.stdout.write = stdoutWrite;
  }
  return chunks.join("");
}

test("CLI-created scores are immediately visible to score list queries", async () => {
  const store = new MemoryObjectStore();
  const dbPath = join(mkdtempSync(join(tmpdir(), "agentpond-cli-")), "cache.duckdb");
  const config: AgentPondConfig = {
    projectId: "default-project",
    dbPath,
    s3: {
      bucket: "agentpond",
      prefix: "",
      region: "us-east-1",
      forcePathStyle: true,
    },
  };
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
  const rows = await db.query<{ id: string; trace_id: string; name: string; value: number }>(
    "SELECT id, trace_id, name, value FROM scores WHERE trace_id = '0'",
  );
  await db.close();

  assert.deepEqual(rows, [{ id: "score-1", trace_id: "0", name: "quality", value: 0.9 }]);
});

test("CLI trace and observation reads expose provided usage and cost fields as JSON", async () => {
  const store = new MemoryObjectStore();
  const dbPath = join(mkdtempSync(join(tmpdir(), "agentpond-cli-")), "cache.duckdb");
  const config: AgentPondConfig = {
    projectId: "default-project",
    dbPath,
    s3: {
      bucket: "agentpond",
      prefix: "",
      region: "us-east-1",
      forcePathStyle: true,
    },
  };
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
      main(["node", "agentpond", "--db", dbPath, "observations", "list", "--traceId", "trace-1", "--json"]),
    );
    const observations = JSON.parse(observationsOutput) as Array<{
      id: string;
      usage_details_json: string;
      cost_details_json: string;
      total_cost: number;
    }>;
    assert.equal(observations[0].id, "observation-1");
    assert.deepEqual(JSON.parse(observations[0].usage_details_json), { input: 38, output: 22, total: 60 });
    assert.deepEqual(JSON.parse(observations[0].cost_details_json), { input: 0.038, output: 0.044, total: 0.082 });
    assert.equal(observations[0].total_cost, 0.082);

    const traceOutput = await captureStdout(() =>
      main(["node", "agentpond", "--db", dbPath, "traces", "get", "trace-1", "--json"]),
    );
    const traces = JSON.parse(traceOutput) as Array<{ id: string; total_cost: number }>;
    assert.equal(traces.length, 1);
    assert.equal(traces[0].id, "trace-1");
    assert.equal(traces[0].total_cost, 0.082);
    assert.equal(process.exitCode, undefined);
  } finally {
    process.exitCode = originalExitCode;
  }
});
