import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { eventTypes, MemoryObjectStore, type AgentPondConfig, type IngestionEvent } from "@agentpond/core";
import { AgentPondDuckDb } from "@agentpond/duckdb";
import { writeEventsAndSyncCache } from "../apps/cli/src/index.js";

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
