import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { AcceptedEventWriter, eventTypes, MemoryObjectStore, type IngestionEvent } from "@aperto/core";
import { ApertoDuckDb } from "@aperto/duckdb";

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
      id: "score-event",
      timestamp: "2026-06-14T00:00:01.000Z",
      type: eventTypes.SCORE_CREATE,
      body: { id: "score-1", traceId: "trace-1", name: "quality", value: 0.9, source: "EVAL" },
    },
  ];
  await writer.writeAcceptedEvents(events, "batch-1");

  const db = new ApertoDuckDb(join(mkdtempSync(join(tmpdir(), "aperto-")), "cache.duckdb"));
  const first = await db.syncFromStore({ store, projectId: "project-a", prefix: "" });
  const second = await db.syncFromStore({ store, projectId: "project-a", prefix: "" });

  assert.equal(first.manifestsProcessed, 1);
  assert.equal(first.eventsProcessed, 2);
  assert.equal(second.manifestsProcessed, 0);
  assert.equal((await db.query("select * from traces")).length, 1);
  assert.equal((await db.query("select * from sessions")).length, 1);
  assert.equal((await db.query("select * from scores")).length, 1);
  assert.equal((await db.query("select * from events_raw")).length, 2);
  await db.close();
});
