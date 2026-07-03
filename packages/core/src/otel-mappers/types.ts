import type { eventTypes } from "../schemas.js";

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

export type ObservationTypeMapper = {
	name: string;
	map: (
		context: ObservationMapperContext,
	) => ObservationCreateEventType | undefined;
};
