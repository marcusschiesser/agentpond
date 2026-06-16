import test from "node:test";
import assert from "node:assert/strict";
import { AcceptedEventWriter, eventTypes, MemoryObjectStore, type IngestionEvent } from "@agentpond/core";

test("accepted event writer stores entity objects before the manifest", async () => {
  const store = new MemoryObjectStore();
  const writer = new AcceptedEventWriter({ store, projectId: "project-a", prefix: "prefix/" });
  const event: IngestionEvent = {
    id: "event-1",
    timestamp: "2026-06-14T00:00:00.000Z",
    type: eventTypes.TRACE_CREATE,
    body: { id: "trace-1", name: "Trace 1" },
  };

  const manifest = await writer.writeAcceptedEvents([event], "batch-1");

  assert.equal(manifest.objects.length, 1);
  assert.equal(manifest.objects[0].key, "prefix/project-a/trace/trace-1/event-1.json");
  assert.equal(store.writes[0], "prefix/project-a/trace/trace-1/event-1.json");
  assert.match(store.writes[1], /^prefix\/project-a\/manifests\/\d{4}\/\d{2}\/\d{2}\/\d{2}\/batch-1\.json$/);
});

test("memory object store lists sorted keys within the requested prefix", async () => {
  const store = new MemoryObjectStore();
  await store.putJson("prefix/project-a/trace/trace-2/event-2.json", {});
  await store.putJson("prefix/project-a/trace/trace-1/event-1.json", {});
  await store.putJson("prefix/project-b/trace/trace-3/event-3.json", {});

  assert.deepEqual(await store.listKeys("prefix/project-a/trace/"), [
    "prefix/project-a/trace/trace-1/event-1.json",
    "prefix/project-a/trace/trace-2/event-2.json",
  ]);
});

test("processBatch returns Langfuse-style per-event successes and errors", async () => {
  const store = new MemoryObjectStore();
  const writer = new AcceptedEventWriter({ store, projectId: "project-a" });
  const result = await writer.processBatch([
    {
      id: "event-1",
      timestamp: "2026-06-14T00:00:00.000Z",
      type: "trace-create",
      body: { id: "trace-1" },
    },
    {
      id: "bad-event",
      timestamp: "not-a-date",
      type: "trace-create",
      body: { id: "trace-2" },
    },
  ]);

  assert.deepEqual(result.successes, [{ id: "event-1", status: 201 }]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].id, "bad-event");
  assert.equal(result.errors[0].status, 400);
});

test("processBatch rejects carriage returns in ids while processing valid events", async () => {
  const store = new MemoryObjectStore();
  const writer = new AcceptedEventWriter({ store, projectId: "project-a" });
  const result = await writer.processBatch([
    {
      id: "event-1",
      timestamp: "2026-06-14T00:00:00.000Z",
      type: eventTypes.TRACE_CREATE,
      body: { id: "trace-1" },
    },
    {
      id: "bad\r-event",
      timestamp: "2026-06-14T00:00:01.000Z",
      type: eventTypes.TRACE_CREATE,
      body: { id: "trace-2" },
    },
  ]);

  assert.deepEqual(result.successes, [{ id: "event-1", status: 201 }]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].id, "bad\r-event");
  assert.equal(result.errors[0].status, 400);
  assert.equal((await store.listKeys("project-a/manifests/")).length, 1);
});
