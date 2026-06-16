import { gunzipSync } from "node:zlib";
import { randomUUID } from "node:crypto";
import protobuf from "protobufjs";
import { eventTypes, type IngestionEvent } from "./schemas.js";

type RawOtelRequest = {
  resourceSpans?: unknown[];
};

export async function otelBodyToEvents(params: {
  body: unknown;
  contentType?: string;
  contentEncoding?: string;
  projectId: string;
}): Promise<IngestionEvent[]> {
  const body = decodeBody(params.body, params.contentEncoding);
  const contentType = params.contentType?.toLowerCase() ?? "";

  let resourceSpans: unknown[] | undefined;
  if (contentType.includes("application/json")) {
    const parsed =
      typeof body === "string" || Buffer.isBuffer(body) || body instanceof Uint8Array
        ? (JSON.parse(Buffer.from(body).toString("utf8")) as RawOtelRequest)
        : (body as RawOtelRequest);
    resourceSpans = parsed.resourceSpans;
  } else if (contentType.includes("application/x-protobuf")) {
    resourceSpans = await parseProtobufResourceSpans(body);
  } else {
    throw new Error("Invalid content type");
  }

  if (!resourceSpans || resourceSpans.length === 0) return [];
  return convertResourceSpans(resourceSpans);
}

function decodeBody(body: unknown, contentEncoding?: string): unknown {
  if (!contentEncoding?.toLowerCase().includes("gzip")) return body;
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return gunzipSync(buffer);
}

async function parseProtobufResourceSpans(body: unknown): Promise<unknown[]> {
  if (!Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
    throw new Error("Failed to parse OTel Protobuf Trace");
  }
  try {
    const type = otlpTraceRoot.lookupType("agentpond.otlp.ExportTraceServiceRequest");
    const decoded = type.decode(Buffer.from(body));
    const object = type.toObject(decoded, {
      longs: String,
      bytes: Array,
      defaults: false,
    }) as { resourceSpans?: unknown[] };
    return normalizeProtobufResourceSpans(object.resourceSpans ?? []);
  } catch (error) {
    throw new Error(`Failed to parse OTel Protobuf Trace: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const otlpTraceRoot = protobuf.parse(`
syntax = "proto3";
package agentpond.otlp;

message ExportTraceServiceRequest {
  repeated ResourceSpans resource_spans = 1;
}

message ResourceSpans {
  repeated ScopeSpans scope_spans = 2;
}

message ScopeSpans {
  repeated Span spans = 2;
}

message Span {
  bytes trace_id = 1;
  bytes span_id = 2;
  bytes parent_span_id = 4;
  string name = 5;
  fixed64 start_time_unix_nano = 7;
  fixed64 end_time_unix_nano = 8;
  repeated KeyValue attributes = 9;
}

message KeyValue {
  string key = 1;
  AnyValue value = 2;
}

message AnyValue {
  string string_value = 1;
  bool bool_value = 2;
  int64 int_value = 3;
  double double_value = 4;
  ArrayValue array_value = 5;
  bytes bytes_value = 7;
}

message ArrayValue {
  repeated AnyValue values = 1;
}
`).root;

function normalizeProtobufResourceSpans(resourceSpans: unknown[]): unknown[] {
  return resourceSpans.map((resourceSpan) => {
    const scopeSpans = getArray(resourceSpan, "scopeSpans") ?? [];
    return {
      scopeSpans: scopeSpans.map((scopeSpan) => ({
        spans: (getArray(scopeSpan, "spans") ?? []).map((span) => ({
          ...(span as Record<string, unknown>),
          traceId: bytesToHex((span as Record<string, unknown>).traceId),
          spanId: bytesToHex((span as Record<string, unknown>).spanId),
          parentSpanId: bytesToHex((span as Record<string, unknown>).parentSpanId),
        })),
      })),
    };
  });
}

function bytesToHex(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.length === 0) return undefined;
  return Buffer.from(value as number[]).toString("hex");
}

function convertResourceSpans(resourceSpans: unknown[]): IngestionEvent[] {
  const events: IngestionEvent[] = [];

  for (const resourceSpan of resourceSpans) {
    const scopeSpans = getArray(resourceSpan, "scopeSpans") ?? getArray(resourceSpan, "instrumentationLibrarySpans") ?? [];
    for (const scopeSpan of scopeSpans) {
      for (const span of getArray(scopeSpan, "spans") ?? []) {
        const traceId = stringField(span, "traceId") ?? randomUUID();
        const spanId = stringField(span, "spanId") ?? randomUUID();
        const parentSpanId = stringField(span, "parentSpanId");
        const timestamp = nanosToIso(stringField(span, "startTimeUnixNano")) ?? new Date().toISOString();
        const endTime = nanosToIso(stringField(span, "endTimeUnixNano"));
        const attributes = attributesToRecord(getArray(span, "attributes") ?? []);
        const langfuse = langfuseAttributes(attributes);
        const name = stringField(span, "name") ?? "otel-span";
        const observationType = stringValue(attributes["langfuse.observation.type"]);
        const observationEvent: IngestionEvent = {
          id: randomUUID(),
          timestamp,
          type: observationTypeToEventType(observationType),
          metadata: { source: "otel" },
          body: {
            id: spanId,
            traceId,
            parentObservationId: parentSpanId,
            name,
            startTime: timestamp,
            endTime,
            metadata: attributes,
            input: parseJsonString(attributes["langfuse.observation.input"]),
            output: parseJsonString(attributes["langfuse.observation.output"]),
            usageDetails: parseJsonRecordString(attributes["langfuse.observation.usage_details"]),
            costDetails: parseJsonRecordString(attributes["langfuse.observation.cost_details"]),
            model: stringValue(attributes["langfuse.observation.model.name"]),
            modelParameters: parseJsonRecordString(attributes["langfuse.observation.model.parameters"]),
          },
        };
        events.push(observationEvent);

        if (!parentSpanId) {
          events.push({
            id: randomUUID(),
            timestamp,
            type: eventTypes.TRACE_CREATE,
            metadata: { source: "otel" },
            body: {
              id: traceId,
              name: langfuse.traceName ?? name,
              userId: langfuse.userId,
              sessionId: langfuse.sessionId,
              startTime: timestamp,
              metadata: langfuse.traceMetadata ?? attributes,
              input: parseJsonString(attributes["langfuse.observation.input"]),
              output: parseJsonString(attributes["langfuse.observation.output"]),
            },
          });
        }
      }
    }
  }

  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function observationTypeToEventType(observationType: string | undefined): IngestionEvent["type"] {
  if (observationType === "generation") return eventTypes.GENERATION_CREATE;
  if (observationType === "event") return eventTypes.EVENT_CREATE;
  if (observationType === "agent") return eventTypes.AGENT_CREATE;
  if (observationType === "tool") return eventTypes.TOOL_CREATE;
  if (observationType === "chain") return eventTypes.CHAIN_CREATE;
  if (observationType === "retriever") return eventTypes.RETRIEVER_CREATE;
  if (observationType === "embedding") return eventTypes.EMBEDDING_CREATE;
  if (observationType === "guardrail") return eventTypes.GUARDRAIL_CREATE;
  return eventTypes.SPAN_CREATE;
}

function getArray(value: unknown, key: string): unknown[] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const maybe = (value as Record<string, unknown>)[key];
  return Array.isArray(maybe) ? maybe : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const field = (value as Record<string, unknown>)[key];
  if (typeof field === "string") return field;
  if (typeof field === "number" || typeof field === "bigint") return String(field);
  return undefined;
}

function nanosToIso(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const nanos = BigInt(raw);
  return new Date(Number(nanos / 1_000_000n)).toISOString();
}

function attributesToRecord(attributes: unknown[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const attribute of attributes) {
    if (!attribute || typeof attribute !== "object") continue;
    const key = (attribute as Record<string, unknown>).key;
    const value = (attribute as Record<string, unknown>).value;
    if (typeof key !== "string") continue;
    record[key] = unwrapOtelValue(value);
  }
  return record;
}

function unwrapOtelValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  for (const key of ["stringValue", "intValue", "doubleValue", "boolValue", "bytesValue"]) {
    if (key in object) return object[key];
  }
  if (Array.isArray(object.arrayValue)) return object.arrayValue.map(unwrapOtelValue);
  return object;
}

function langfuseAttributes(attributes: Record<string, unknown>): {
  traceName?: string;
  userId?: string;
  sessionId?: string;
  traceMetadata?: Record<string, unknown>;
} {
  const traceMetadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith("langfuse.trace.metadata.")) {
      traceMetadata[key.slice("langfuse.trace.metadata.".length)] = value;
    }
  }

  return {
    traceName: stringValue(attributes["langfuse.trace.name"]),
    userId: stringValue(attributes["user.id"]),
    sessionId: stringValue(attributes["session.id"]),
    traceMetadata: Object.keys(traceMetadata).length > 0 ? traceMetadata : undefined,
  };
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function parseJsonRecordString(value: unknown): Record<string, unknown> | undefined {
  const parsed = parseJsonString(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}
