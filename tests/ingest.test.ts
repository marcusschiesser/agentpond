import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import protobuf from "protobufjs";
import { buildServer } from "../apps/ingest/src/server.js";
import { MemoryObjectStore, type ApertoConfig } from "@aperto/core";

const config: ApertoConfig = {
  projectId: "project-a",
  dbPath: "/tmp/aperto-test.duckdb",
  s3: {
    bucket: "aperto",
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
                  attributes: [{ key: "service.name", value: { stringValue: "demo" } }],
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
  assert.equal((await store.listKeys("project-a/trace/")).length, 1);
  assert.equal((await store.listKeys("project-a/observation/")).length, 1);
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
package aperto.otlp;
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
  const type = root.lookupType("aperto.otlp.ExportTraceServiceRequest");
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
