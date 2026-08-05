import type { eventTypes, IngestionEvent } from "../schemas.js";

type EventBody<T extends IngestionEvent["type"]> = Extract<
	IngestionEvent,
	{ type: T }
>["body"];

type GenerationCreateBody = EventBody<typeof eventTypes.GENERATION_CREATE>;
type TraceCreateBody = EventBody<typeof eventTypes.TRACE_CREATE>;

export type ObservationCreateEventType =
	| typeof eventTypes.SPAN_CREATE
	| typeof eventTypes.GENERATION_CREATE
	| typeof eventTypes.EVENT_CREATE
	| typeof eventTypes.AGENT_CREATE
	| typeof eventTypes.TOOL_CREATE
	| typeof eventTypes.CHAIN_CREATE
	| typeof eventTypes.RETRIEVER_CREATE
	| typeof eventTypes.EMBEDDING_CREATE
	| typeof eventTypes.GUARDRAIL_CREATE;

export type ObservationMapperContext = {
	attributes: Record<string, unknown>;
};

export type NormalizedObservationFields = Partial<
	Pick<
		GenerationCreateBody,
		| "input"
		| "output"
		| "usageDetails"
		| "costDetails"
		| "model"
		| "modelParameters"
		| "level"
		| "statusMessage"
		| "version"
		| "environment"
	>
>;

export type NormalizedTraceFields = Partial<
	Pick<
		TraceCreateBody,
		| "name"
		| "userId"
		| "sessionId"
		| "metadata"
		| "input"
		| "output"
		| "tags"
		| "public"
		| "version"
		| "environment"
	>
>;

export type ObservationMapperResult = {
	observationType?: ObservationCreateEventType;
	observation?: NormalizedObservationFields;
	rootTrace?: NormalizedTraceFields;
	traceUpdate?: NormalizedTraceFields;
};

export type NormalizedOtelObservation = Required<ObservationMapperResult> & {
	hasTraceUpdates: boolean;
};

export type ObservationTypeMapper = {
	name: string;
	map: (
		context: ObservationMapperContext,
	) => ObservationMapperResult | undefined;
};
