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
export type EntityType = "trace" | "observation" | "score" | "otel";

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
const usageUnitSchema = z
	.enum([
		"CHARACTERS",
		"TOKENS",
		"SECONDS",
		"MILLISECONDS",
		"IMAGES",
		"REQUESTS",
	])
	.nullish();
const jsonInputOutputFields = {
	metadata: jsonRecordSchema.nullish(),
	input: jsonValue.nullish(),
	output: jsonValue.nullish(),
};
const usageValueFields = {
	input: z.number().int().nullish(),
	output: z.number().int().nullish(),
	total: z.number().int().nullish(),
	unit: usageUnitSchema,
	inputCost: z.number().nullish(),
	outputCost: z.number().nullish(),
	totalCost: z.number().nullish(),
};
const usageValueSchema = z.object(usageValueFields).nullish();
const environmentSchema = z
	.string()
	.toLowerCase()
	.transform((value) => {
		const stripped = value.replace(/^langfuse[-_]?/, "");
		const truncated = stripped.slice(0, 40);
		if (!truncated || !/^[a-z0-9-_]+$/.test(truncated)) return "default";
		return truncated;
	})
	.catch("default")
	.default("default");

const usageSchema = z
	.object({
		...usageValueFields,
		promptTokens: z.number().int().nullish(),
		completionTokens: z.number().int().nullish(),
		totalTokens: z.number().int().nullish(),
	})
	.nullish()
	.transform((value) => {
		if (!value) return null;
		if (
			"promptTokens" in value ||
			"completionTokens" in value ||
			"totalTokens" in value
		) {
			return {
				input: value.promptTokens,
				output: value.completionTokens,
				total: value.totalTokens,
				unit: "TOKENS" as const,
			};
		}
		if (
			Object.values(value).every(
				(entry) => entry === null || entry === undefined,
			)
		) {
			return undefined;
		}
		return value;
	})
	.pipe(usageValueSchema);

const usageDetailsSchema = numericRecordSchema((entry) => {
	if (typeof entry === "number" && Number.isInteger(entry) && entry >= 0) {
		return entry;
	}
	if (typeof entry === "string") {
		const parsed = Number.parseInt(entry, 10);
		if (!Number.isNaN(parsed) && parsed >= 0) return parsed;
	}
	return undefined;
});

const costDetailsSchema = numericRecordSchema((entry) =>
	typeof entry === "number" && Number.isFinite(entry) && entry >= 0
		? entry
		: undefined,
);

function numericRecordSchema(parse: (entry: unknown) => number | undefined) {
	return z
		.record(z.string(), z.unknown())
		.nullish()
		.transform((value) => {
			if (!value) return value;
			const result: Record<string, number> = {};
			for (const [key, entry] of Object.entries(value)) {
				const parsed = parse(entry);
				if (parsed !== undefined) result[key] = parsed;
			}
			return Object.keys(result).length > 0 ? result : undefined;
		})
		.nullish();
}

const traceBodySchema = z
	.object({
		id: idSchema.nullish(),
		timestamp: nullableIsoTimestampSchema,
		name: z.string().max(1000).nullish(),
		externalId: z.string().nullish(),
		...jsonInputOutputFields,
		sessionId: z.string().nullish(),
		userId: z.string().nullish(),
		environment: environmentSchema,
		release: z.string().nullish(),
		version: z.string().nullish(),
		public: z.boolean().nullish(),
		tags: z.array(z.string()).nullish(),
	})
	.catchall(jsonValue);

const optionalObservationBodySchema = z
	.object({
		traceId: idSchema.nullish(),
		environment: environmentSchema,
		name: z.string().nullish(),
		startTime: nullableIsoTimestampSchema,
		...jsonInputOutputFields,
		level: z.enum(["DEBUG", "DEFAULT", "WARNING", "ERROR"]).nullish(),
		statusMessage: z.string().nullish(),
		parentObservationId: idSchema.nullish(),
		version: z.string().nullish(),
	})
	.catchall(jsonValue);

const eventBodySchema = optionalObservationBodySchema.extend({
	id: idSchema.nullish(),
});

const spanBodySchema = eventBodySchema.extend({
	endTime: nullableIsoTimestampSchema,
});

const generationBodySchema = spanBodySchema.extend({
	completionStartTime: nullableIsoTimestampSchema,
	model: z.string().nullish(),
	modelParameters: z
		.record(
			z.string(),
			z
				.union([
					z.string(),
					z.number(),
					z.boolean(),
					z.array(z.string()),
					z.record(z.string(), z.string()),
				])
				.nullish(),
		)
		.nullish(),
	usage: usageSchema,
	usageDetails: usageDetailsSchema,
	costDetails: costDetailsSchema,
	promptName: z.string().nullish(),
	promptVersion: z.number().int().nullish(),
});

// Langfuse keeps observation-create/update for backwards compatibility.
const legacyObservationBodySchema = generationBodySchema.extend({
	id: idSchema.nullish(),
	traceId: idSchema.nullish(),
	type: z.enum(["GENERATION", "SPAN", "EVENT"]).nullish(),
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
		source: z.enum(["API", "EVAL", "ANNOTATION"]).default("API"),
		comment: z.string().nullish(),
		metadata: jsonInputOutputFields.metadata,
		configId: z.string().nullish(),
		queueId: z.string().nullish(),
		authorUserId: z.string().nullish(),
		createdAt: nullableIsoTimestampSchema,
		environment: environmentSchema,
	})
	.catchall(jsonValue);

const baseEventSchema = z.object({
	id: idSchema,
	timestamp: isoTimestampSchema,
	metadata: jsonRecordSchema.nullish(),
});

export const ingestionEventSchema = z.discriminatedUnion("type", [
	baseEventSchema.extend({
		type: z.literal(eventTypes.TRACE_CREATE),
		body: traceBodySchema,
	}),
	baseEventSchema.extend({
		type: z.literal(eventTypes.SPAN_CREATE),
		body: spanBodySchema,
	}),
	baseEventSchema.extend({
		type: z.literal(eventTypes.SPAN_UPDATE),
		body: spanBodySchema,
	}),
	baseEventSchema.extend({
		type: z.literal(eventTypes.GENERATION_CREATE),
		body: generationBodySchema,
	}),
	baseEventSchema.extend({
		type: z.literal(eventTypes.GENERATION_UPDATE),
		body: generationBodySchema,
	}),
	baseEventSchema.extend({
		type: z.literal(eventTypes.EVENT_CREATE),
		body: eventBodySchema,
	}),
	baseEventSchema.extend({
		type: z.literal(eventTypes.SCORE_CREATE),
		body: scoreBodySchema,
	}),
	baseEventSchema.extend({
		type: z.literal(eventTypes.AGENT_CREATE),
		body: generationBodySchema,
	}),
	baseEventSchema.extend({
		type: z.literal(eventTypes.TOOL_CREATE),
		body: generationBodySchema,
	}),
	baseEventSchema.extend({
		type: z.literal(eventTypes.CHAIN_CREATE),
		body: generationBodySchema,
	}),
	baseEventSchema.extend({
		type: z.literal(eventTypes.RETRIEVER_CREATE),
		body: generationBodySchema,
	}),
	baseEventSchema.extend({
		type: z.literal(eventTypes.EMBEDDING_CREATE),
		body: generationBodySchema,
	}),
	baseEventSchema.extend({
		type: z.literal(eventTypes.GUARDRAIL_CREATE),
		body: generationBodySchema,
	}),
	baseEventSchema.extend({
		type: z.literal(eventTypes.OBSERVATION_CREATE),
		body: legacyObservationBodySchema,
	}),
	baseEventSchema.extend({
		type: z.literal(eventTypes.OBSERVATION_UPDATE),
		body: legacyObservationBodySchema,
	}),
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
	return "observation";
}

export function bodyIdForEvent(event: IngestionEvent): string | undefined {
	if ("id" in event.body && typeof event.body.id === "string")
		return event.body.id;
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
			rawEvent &&
			typeof rawEvent === "object" &&
			"id" in rawEvent &&
			typeof rawEvent.id === "string"
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
