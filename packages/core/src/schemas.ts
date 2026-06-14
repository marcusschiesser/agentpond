import { z } from "zod";

export const eventTypes = {
  TRACE_CREATE: "trace-create",
  SPAN_CREATE: "span-create",
  SPAN_UPDATE: "span-update",
  GENERATION_CREATE: "generation-create",
  GENERATION_UPDATE: "generation-update",
  EVENT_CREATE: "event-create",
  SCORE_CREATE: "score-create",
  AGENT_CREATE: "agent-create",
  TOOL_CREATE: "tool-create",
  CHAIN_CREATE: "chain-create",
  RETRIEVER_CREATE: "retriever-create",
  EMBEDDING_CREATE: "embedding-create",
  GUARDRAIL_CREATE: "guardrail-create",
  OBSERVATION_CREATE: "observation-create",
  OBSERVATION_UPDATE: "observation-update",
} as const;

export type EventType = (typeof eventTypes)[keyof typeof eventTypes];
export type EntityType = "trace" | "observation" | "score" | "event";

const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

export const jsonRecordSchema = z.record(z.string(), jsonValue);

export const idSchema = z
  .string()
  .min(1)
  .max(800)
  .refine((id) => !id.includes("\r"), {
    message: "ID cannot contain carriage return characters",
  });

const isoTimestampSchema = z.iso.datetime({ offset: true });
const nullableIsoTimestampSchema = isoTimestampSchema.nullish();

const baseBodySchema = z
  .object({
    id: idSchema.nullish(),
    traceId: idSchema.nullish(),
    sessionId: z.string().nullish(),
    name: z.string().nullish(),
    userId: z.string().nullish(),
    metadata: jsonRecordSchema.nullish(),
    input: jsonValue.nullish(),
    output: jsonValue.nullish(),
    level: z.enum(["DEBUG", "DEFAULT", "WARNING", "ERROR"]).nullish(),
    statusMessage: z.string().nullish(),
    startTime: nullableIsoTimestampSchema,
    endTime: nullableIsoTimestampSchema,
    createdAt: nullableIsoTimestampSchema,
    completionStartTime: nullableIsoTimestampSchema,
    version: z.string().nullish(),
    environment: z.string().nullish(),
  })
  .catchall(jsonValue);

const traceBodySchema = baseBodySchema.extend({
  id: idSchema.nullish(),
});

const observationBodySchema = baseBodySchema.extend({
  id: idSchema.nullish(),
  traceId: idSchema.nullish(),
  parentObservationId: idSchema.nullish(),
  usage: jsonRecordSchema.nullish(),
  usageDetails: jsonRecordSchema.nullish(),
  costDetails: jsonRecordSchema.nullish(),
  model: z.string().nullish(),
  modelParameters: jsonRecordSchema.nullish(),
});

const scoreBodySchema = z
  .object({
    id: idSchema.nullish(),
    traceId: idSchema.nullish(),
    observationId: idSchema.nullish(),
    sessionId: z.string().nullish(),
    name: z.string().min(1),
    value: z.union([z.number(), z.string(), z.boolean()]),
    dataType: z
      .enum(["NUMERIC", "CATEGORICAL", "BOOLEAN", "CORRECTION", "TEXT"])
      .nullish(),
    source: z.enum(["API", "EVAL", "ANNOTATION"]).nullish(),
    comment: z.string().nullish(),
    metadata: jsonRecordSchema.nullish(),
    configId: z.string().nullish(),
    queueId: z.string().nullish(),
    authorUserId: z.string().nullish(),
    createdAt: nullableIsoTimestampSchema,
    environment: z.string().nullish(),
  })
  .catchall(jsonValue);

const baseEventSchema = z.object({
  id: idSchema,
  timestamp: isoTimestampSchema,
  metadata: jsonRecordSchema.nullish(),
});

export const ingestionEventSchema = z.discriminatedUnion("type", [
  baseEventSchema.extend({ type: z.literal(eventTypes.TRACE_CREATE), body: traceBodySchema }),
  baseEventSchema.extend({ type: z.literal(eventTypes.SPAN_CREATE), body: observationBodySchema }),
  baseEventSchema.extend({ type: z.literal(eventTypes.SPAN_UPDATE), body: observationBodySchema }),
  baseEventSchema.extend({ type: z.literal(eventTypes.GENERATION_CREATE), body: observationBodySchema }),
  baseEventSchema.extend({ type: z.literal(eventTypes.GENERATION_UPDATE), body: observationBodySchema }),
  baseEventSchema.extend({ type: z.literal(eventTypes.EVENT_CREATE), body: observationBodySchema }),
  baseEventSchema.extend({ type: z.literal(eventTypes.SCORE_CREATE), body: scoreBodySchema }),
  baseEventSchema.extend({ type: z.literal(eventTypes.AGENT_CREATE), body: observationBodySchema }),
  baseEventSchema.extend({ type: z.literal(eventTypes.TOOL_CREATE), body: observationBodySchema }),
  baseEventSchema.extend({ type: z.literal(eventTypes.CHAIN_CREATE), body: observationBodySchema }),
  baseEventSchema.extend({ type: z.literal(eventTypes.RETRIEVER_CREATE), body: observationBodySchema }),
  baseEventSchema.extend({ type: z.literal(eventTypes.EMBEDDING_CREATE), body: observationBodySchema }),
  baseEventSchema.extend({ type: z.literal(eventTypes.GUARDRAIL_CREATE), body: observationBodySchema }),
  baseEventSchema.extend({ type: z.literal(eventTypes.OBSERVATION_CREATE), body: observationBodySchema }),
  baseEventSchema.extend({ type: z.literal(eventTypes.OBSERVATION_UPDATE), body: observationBodySchema }),
]);

export const ingestionBatchSchema = z.object({
  batch: z.array(z.unknown()),
  metadata: jsonRecordSchema.nullish(),
});

export type IngestionEvent = z.infer<typeof ingestionEventSchema>;

export type BatchResult = {
  successes: { id: string; status: number }[];
  errors: { id: string; status: number; message?: string; error?: string }[];
};

export function entityTypeForEvent(type: EventType): EntityType {
  if (type === eventTypes.TRACE_CREATE) return "trace";
  if (type === eventTypes.SCORE_CREATE) return "score";
  if (type === eventTypes.EVENT_CREATE) return "event";
  return "observation";
}

export function bodyIdForEvent(event: IngestionEvent): string | undefined {
  if ("id" in event.body && typeof event.body.id === "string") return event.body.id;
  if ("traceId" in event.body && typeof event.body.traceId === "string") return event.body.traceId;
  return undefined;
}

export function parseIngestionEvents(input: unknown[]): {
  events: IngestionEvent[];
  errors: BatchResult["errors"];
} {
  const events: IngestionEvent[] = [];
  const errors: BatchResult["errors"] = [];

  for (const rawEvent of input) {
    const parsed = ingestionEventSchema.safeParse(rawEvent);
    if (parsed.success) {
      events.push(parsed.data);
      continue;
    }

    const maybeId =
      rawEvent && typeof rawEvent === "object" && "id" in rawEvent && typeof rawEvent.id === "string"
        ? rawEvent.id
        : "unknown";
    errors.push({
      id: maybeId,
      status: 400,
      message: "Invalid request data",
      error: parsed.error.issues.map((issue) => issue.message).join("; "),
    });
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { events, errors };
}
