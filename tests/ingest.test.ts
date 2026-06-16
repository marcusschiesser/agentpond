import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import protobuf from "protobufjs";
import { buildServer } from "../apps/ingest/src/server.js";
import { eventTypes, MemoryObjectStore, type AgentPondConfig } from "@agentpond/core";

const config: AgentPondConfig = {
  projectId: "project-a",
  dbPath: "/tmp/agentpond-test.duckdb",
  s3: {
    bucket: "agentpond",
    prefix: "",
    region: "us-east-1",
    forcePathStyle: true,
  },
  auth: {
    projectId: "project-a",
    publicKey: "pk",
    secretKey: "sk",
  },
};

function authHeader(): string {
  return `Basic ${Buffer.from("pk:sk").toString("base64")}`;
}

test("ingestion endpoint validates auth and returns 207 batch result", async () => {
  const store = new MemoryObjectStore();
  const server = buildServer({ config, store });
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

test("ingestion endpoint rejects invalid auth without writing objects", async () => {
  const cases = [
    {},
    { authorization: `Basic ${Buffer.from("pk:wrong").toString("base64")}` },
    { authorization: `Basic ${Buffer.from("wrong:sk").toString("base64")}` },
    { authorization: "Bearer token" },
  ];

  for (const headers of cases) {
    const store = new MemoryObjectStore();
    const server = buildServer({ config, store });
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

test("ingestion endpoint writes trace observation and score bodies to raw storage", async () => {
  const store = new MemoryObjectStore();
  const server = buildServer({ config, store });
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
          id: "trace-event",
          timestamp: "2026-06-14T00:00:00.000Z",
          type: eventTypes.TRACE_CREATE,
          body: { id: "trace-1", name: "Trace 1" },
        },
        {
          id: "observation-event",
          timestamp: "2026-06-14T00:00:01.000Z",
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
          id: "score-event",
          timestamp: "2026-06-14T00:00:02.000Z",
          type: eventTypes.SCORE_CREATE,
          body: { id: "score-1", traceId: "trace-1", name: "quality", value: 0.9 },
        },
      ],
    }),
  });

  assert.equal(response.statusCode, 207);
  assert.equal((await store.listKeys("project-a/manifests/")).length, 1);

  const observationEvents = await store.getJson<Array<{ id: string; body: Record<string, unknown> }>>(
    "project-a/observation/observation-1/observation-event.json",
  );
  assert.deepEqual(observationEvents[0].body.usageDetails, { input: 10, output: 5, total: 15 });
  assert.deepEqual(observationEvents[0].body.costDetails, { input: 0.01, output: 0.02, total: 0.03 });
  assert.equal((await store.listKeys("project-a/trace/")).length, 1);
  assert.equal((await store.listKeys("project-a/score/")).length, 1);
  await server.close();
});

test("otel endpoint accepts JSON resource spans and writes trace data", async () => {
  const store = new MemoryObjectStore();
  const server = buildServer({ config, store });
  const response = await server.inject({
    method: "POST",
    url: "/api/public/otel/v1/traces",
    headers: {
      authorization: authHeader(),
      "content-type": "application/json",
      "x-langfuse-ingestion-version": "4",
    },
    payload: JSON.stringify({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: "trace-otel",
                  spanId: "span-root",
                  name: "root span",
                  startTimeUnixNano: "1781395200000000000",
                  endTimeUnixNano: "1781395201000000000",
                  attributes: [
                    { key: "service.name", value: { stringValue: "demo" } },
                    { key: "user.id", value: { stringValue: "user-otel" } },
                    { key: "session.id", value: { stringValue: "session-otel" } },
                    { key: "langfuse.trace.name", value: { stringValue: "Langfuse OTel Trace" } },
                    { key: "langfuse.trace.metadata.example", value: { stringValue: "sdk" } },
                    { key: "langfuse.observation.type", value: { stringValue: "generation" } },
                    { key: "langfuse.observation.input", value: { stringValue: "{\"question\":\"hello\"}" } },
                    { key: "langfuse.observation.output", value: { stringValue: "{\"answer\":\"world\"}" } },
                    { key: "langfuse.observation.model.name", value: { stringValue: "gpt-5.5-mini" } },
                    { key: "langfuse.observation.usage_details", value: { stringValue: "{\"input\":38,\"output\":22,\"total\":60}" } },
                    {
                      key: "langfuse.observation.cost_details",
                      value: { stringValue: "{\"input\":0.038,\"output\":0.044,\"total\":0.082}" },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal((await store.listKeys("project-a/manifests/")).length, 1);
  const traceKeys = await store.listKeys("project-a/trace/");
  const observationKeys = await store.listKeys("project-a/observation/");
  assert.equal(traceKeys.length, 1);
  assert.equal(observationKeys.length, 1);
  const traceEvents = await store.getJson<Array<{ type: string; body: Record<string, unknown> }>>(traceKeys[0]);
  assert.equal(traceEvents[0].type, "trace-create");
  assert.deepEqual(traceEvents[0].body, {
    id: "trace-otel",
    name: "Langfuse OTel Trace",
    userId: "user-otel",
    sessionId: "session-otel",
    startTime: "2026-06-14T00:00:00.000Z",
    metadata: { example: "sdk" },
    input: { question: "hello" },
    output: { answer: "world" },
  });
  const observationEvents = await store.getJson<Array<{ type: string; body: Record<string, unknown> }>>(observationKeys[0]);
  assert.equal(observationEvents[0].type, "generation-create");
  assert.deepEqual(observationEvents[0].body.usageDetails, { input: 38, output: 22, total: 60 });
  assert.deepEqual(observationEvents[0].body.costDetails, { input: 0.038, output: 0.044, total: 0.082 });
  assert.equal(observationEvents[0].body.model, "gpt-5.5-mini");
  await server.close();
});

test("otel endpoint accepts ingestion version header in underscore format", async () => {
  const store = new MemoryObjectStore();
  const server = buildServer({ config, store });
  const response = await server.inject({
    method: "POST",
    url: "/api/public/otel/v1/traces",
    headers: {
      authorization: authHeader(),
      "content-type": "application/json",
      "x_langfuse_ingestion_version": "4",
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
  assert.equal((await store.listKeys("project-a/manifests/")).length, 1);
  await server.close();
});

test("otel endpoint accepts gzip JSON bodies", async () => {
  const store = new MemoryObjectStore();
  const server = buildServer({ config, store });
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
  assert.equal((await store.listKeys("project-a/manifests/")).length, 1);
  await server.close();
});

test("otel endpoint accepts protobuf trace bodies", async () => {
  const store = new MemoryObjectStore();
  const server = buildServer({ config, store });
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
  assert.equal((await store.listKeys("project-a/manifests/")).length, 1);
  assert.equal((await store.listKeys("project-a/trace/")).length, 1);
  await server.close();
});

test("otel endpoint rejects invalid content types", async () => {
  const server = buildServer({ config, store: new MemoryObjectStore() });
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
  const server = buildServer({ config, store: new MemoryObjectStore() });
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

function makeOtlpTraceProtobuf(): Buffer {
  const root = protobuf.parse(`
syntax = "proto3";
package agentpond.otlp;
message ExportTraceServiceRequest { repeated ResourceSpans resource_spans = 1; }
message ResourceSpans { repeated ScopeSpans scope_spans = 2; }
message ScopeSpans { repeated Span spans = 2; }
message Span {
  bytes trace_id = 1;
  bytes span_id = 2;
  string name = 5;
  fixed64 start_time_unix_nano = 7;
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
                name: "protobuf span",
                startTimeUnixNano: "1781395200000000000",
                attributes: [{ key: "service.name", value: { stringValue: "demo" } }],
              },
            ],
          },
        ],
      },
    ],
  });
  return Buffer.from(type.encode(message).finish());
}
