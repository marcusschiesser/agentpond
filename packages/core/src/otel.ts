import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";
import protobuf from "protobufjs";
import { mapOtelObservation } from "./otel-mappers/registry.js";
import type { NormalizedOtelObservation } from "./otel-mappers/types.js";
import { booleanValue, stringValue, unwrapOtelValue } from "./otel-parsers.js";
import { eventTypes, type IngestionEvent } from "./schemas.js";

type RawOtelRequest = {
	resourceSpans?: unknown[];
};

type TraceCreateBody = Extract<
	IngestionEvent,
	{ type: typeof eventTypes.TRACE_CREATE }
>["body"];

export async function otelBodyToEvents(params: {
	body: unknown;
	contentType?: string;
	contentEncoding?: string;
	projectId: string;
}): Promise<IngestionEvent[]> {
	const resourceSpans = await otelBodyToResourceSpans(params);
	return otelResourceSpansToEvents(resourceSpans);
}

export async function otelBodyToResourceSpans(params: {
	body: unknown;
	contentType?: string;
	contentEncoding?: string;
	projectId?: string;
}): Promise<unknown[]> {
	const body = decodeBody(params.body, params.contentEncoding);
	const contentType = params.contentType?.toLowerCase() ?? "";

	let resourceSpans: unknown[] | undefined;
	if (contentType.includes("application/json")) {
		const parsed =
			typeof body === "string" ||
			Buffer.isBuffer(body) ||
			body instanceof Uint8Array
				? (JSON.parse(Buffer.from(body).toString("utf8")) as RawOtelRequest)
				: (body as RawOtelRequest);
		resourceSpans = parsed.resourceSpans;
	} else if (contentType.includes("application/x-protobuf")) {
		resourceSpans = await parseProtobufResourceSpans(body);
	} else {
		throw new Error("Invalid content type");
	}

	if (!resourceSpans || resourceSpans.length === 0) return [];
	return resourceSpans;
}

function decodeBody(body: unknown, contentEncoding?: string): unknown {
	if (!contentEncoding?.toLowerCase().includes("gzip")) return body;
	const buffer = Buffer.isBuffer(body)
		? body
		: Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
	return gunzipSync(buffer);
}

async function parseProtobufResourceSpans(body: unknown): Promise<unknown[]> {
	if (!Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
		throw new Error("Failed to parse OTel Protobuf Trace");
	}
	try {
		const type = otlpTraceRoot.lookupType(
			"agentpond.otlp.ExportTraceServiceRequest",
		);
		const decoded = type.decode(Buffer.from(body));
		const object = type.toObject(decoded) as { resourceSpans?: unknown[] };
		return object.resourceSpans ?? [];
	} catch (error) {
		throw new Error(
			`Failed to parse OTel Protobuf Trace: ${error instanceof Error ? error.message : String(error)}`,
		);
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

function bytesToHex(value: unknown): string | undefined {
	if (Array.isArray(value)) {
		if (value.length === 0) return undefined;
		return Buffer.from(value as number[]).toString("hex");
	}
	if (value instanceof Uint8Array) {
		if (value.length === 0) return undefined;
		return Buffer.from(value).toString("hex");
	}
	if (value && typeof value === "object") {
		const object = value as Record<string, unknown>;
		if (object.type === "Buffer" && Array.isArray(object.data)) {
			if (object.data.length === 0) return undefined;
			return Buffer.from(object.data as number[]).toString("hex");
		}
		const numericEntries = Object.entries(object).sort(
			([a], [b]) => Number(a) - Number(b),
		);
		if (
			numericEntries.length > 0 &&
			numericEntries.every(
				([key, entry]) =>
					String(Number(key)) === key && typeof entry === "number",
			)
		) {
			return Buffer.from(
				numericEntries.map(([, entry]) => entry as number),
			).toString("hex");
		}
	}
	return undefined;
}

export function otelResourceSpansToEvents(
	resourceSpans: unknown[],
): IngestionEvent[] {
	const events: IngestionEvent[] = [];
	const seenTraces = new Set<string>();

	for (const resourceSpan of resourceSpans) {
		const scopeSpans =
			getArray(resourceSpan, "scopeSpans") ??
			getArray(resourceSpan, "instrumentationLibrarySpans") ??
			[];
		for (const scopeSpan of scopeSpans) {
			for (const span of getArray(scopeSpan, "spans") ?? []) {
				const traceId = idField(span, "traceId") ?? randomUUID();
				const spanId = idField(span, "spanId") ?? randomUUID();
				const parentSpanId = idField(span, "parentSpanId");
				const timestamp =
					nanosToIso(stringField(span, "startTimeUnixNano")) ??
					new Date().toISOString();
				const endTime = nanosToIso(stringField(span, "endTimeUnixNano"));
				const attributes = attributesToRecord(
					getArray(span, "attributes") ?? [],
				);
				const mapped = mapOtelObservation(attributes);
				const name = stringField(span, "name") ?? "otel-span";
				const observationEvent = {
					id: randomUUID(),
					timestamp,
					type: mapped.observationType,
					metadata: { source: "otel" },
					body: {
						id: spanId,
						traceId,
						parentObservationId: parentSpanId,
						name,
						startTime: timestamp,
						endTime,
						metadata: attributes,
						...mapped.observation,
						environment: mapped.observation.environment ?? "default",
					},
				} as IngestionEvent;
				events.push(observationEvent);

				const isAppRoot =
					booleanValue(attributes["langfuse.internal.is_app_root"]) === true;
				const isRootSpan =
					!parentSpanId ||
					booleanValue(attributes["langfuse.internal.as_root"]) === true ||
					// Langfuse uses is_app_root in its raw OTEL event path. AgentPond
					// bridges it here because DuckDB projection consumes trace-create events.
					isAppRoot;
				if (isRootSpan || mapped.hasTraceUpdates || !seenTraces.has(traceId)) {
					seenTraces.add(traceId);
					events.push(
						createTraceEvent({
							traceId,
							timestamp,
							attributes,
							mapped,
							name,
							isRootSpan,
						}),
					);
				}
			}
		}
	}

	return filterRedundantShallowTraceEvents(events);
}

function createTraceEvent(params: {
	traceId: string;
	timestamp: string;
	attributes: Record<string, unknown>;
	mapped: NormalizedOtelObservation;
	name: string;
	isRootSpan: boolean;
}): IngestionEvent {
	const { traceId, timestamp, attributes, mapped, name, isRootSpan } = params;
	let body: TraceCreateBody = {
		id: traceId,
		timestamp,
		environment: mapped.rootTrace.environment ?? "default",
	};

	if (isRootSpan) {
		body = {
			...body,
			name: mapped.rootTrace.name ?? name,
			userId: mapped.rootTrace.userId,
			sessionId: mapped.rootTrace.sessionId,
			startTime: timestamp,
			metadata: mapped.rootTrace.metadata ?? attributes,
			input: mapped.rootTrace.input,
			output: mapped.rootTrace.output,
			tags: mapped.rootTrace.tags,
			public: mapped.rootTrace.public,
			version: mapped.rootTrace.version,
		};
	}

	if (mapped.hasTraceUpdates && !isRootSpan) {
		body = {
			...body,
			name: mapped.traceUpdate.name,
			userId: mapped.traceUpdate.userId,
			sessionId: mapped.traceUpdate.sessionId,
			startTime: timestamp,
			metadata: mapped.traceUpdate.metadata,
			input: mapped.traceUpdate.input,
			output: mapped.traceUpdate.output,
			tags: mapped.traceUpdate.tags,
			public: mapped.traceUpdate.public,
			version: mapped.traceUpdate.version,
		};
	}

	return {
		id: randomUUID(),
		timestamp,
		type: eventTypes.TRACE_CREATE,
		metadata: { source: "otel" },
		body,
	};
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
	if (typeof field === "number" || typeof field === "bigint")
		return String(field);
	const longValue = longLikeToString(field);
	if (longValue) return longValue;
	return undefined;
}

function longLikeToString(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const object = value as Record<string, unknown>;
	const low = object.low;
	const high = object.high;
	if (typeof low !== "number" || typeof high !== "number") return undefined;
	const lowBig = BigInt(low >>> 0);
	const highBig = BigInt(high >>> 0);
	let combined = (highBig << 32n) | lowBig;
	if (object.unsigned !== true && (high & 0x80000000) !== 0) {
		combined -= 1n << 64n;
	}
	return combined.toString();
}

function idField(value: unknown, key: string): string | undefined {
	const stringId = stringField(value, key);
	if (stringId) return stringId;
	if (!value || typeof value !== "object") return undefined;
	return bytesToHex((value as Record<string, unknown>)[key]);
}

function nanosToIso(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	try {
		const nanos = BigInt(raw);
		return new Date(Number(nanos / 1_000_000n)).toISOString();
	} catch {
		return undefined;
	}
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

function filterRedundantShallowTraceEvents(
	events: IngestionEvent[],
): IngestionEvent[] {
	const fullTraceIds = new Set(
		events
			.filter(
				(event) =>
					event.type === eventTypes.TRACE_CREATE && !isShallowTraceEvent(event),
			)
			.map((event) => stringValue(event.body.id ?? event.body.traceId))
			.filter((id): id is string => Boolean(id)),
	);
	if (fullTraceIds.size === 0) return events;
	return events.filter((event) => {
		if (event.type !== eventTypes.TRACE_CREATE) return true;
		const traceId = stringValue(event.body.id ?? event.body.traceId);
		return (
			!traceId || !fullTraceIds.has(traceId) || !isShallowTraceEvent(event)
		);
	});
}

function isShallowTraceEvent(event: IngestionEvent): boolean {
	const body = event.body as Record<string, unknown>;
	return (
		!hasMeaningfulValue(body.name) &&
		!hasMeaningfulValue(body.externalId) &&
		!hasMeaningfulValue(body.input) &&
		!hasMeaningfulValue(body.output) &&
		!hasMeaningfulValue(body.sessionId) &&
		!hasMeaningfulValue(body.userId) &&
		!hasMeaningfulValue(body.metadata) &&
		!hasMeaningfulValue(body.release) &&
		!hasMeaningfulValue(body.version) &&
		!hasMeaningfulValue(body.public) &&
		!hasMeaningfulValue(body.tags)
	);
}

function hasMeaningfulValue(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "string") return value.length > 0;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "object") return Object.keys(value).length > 0;
	return true;
}
