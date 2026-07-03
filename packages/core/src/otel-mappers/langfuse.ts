import { stringValue } from "../otel-parsers.js";
import { eventTypes } from "../schemas.js";
import type { ObservationTypeMapper } from "./types.js";

const langfuseObservationTypes = new Map([
	["span", eventTypes.SPAN_CREATE],
	["generation", eventTypes.GENERATION_CREATE],
	["event", eventTypes.EVENT_CREATE],
	["agent", eventTypes.AGENT_CREATE],
	["tool", eventTypes.TOOL_CREATE],
	["chain", eventTypes.CHAIN_CREATE],
	["retriever", eventTypes.RETRIEVER_CREATE],
	["embedding", eventTypes.EMBEDDING_CREATE],
	["guardrail", eventTypes.GUARDRAIL_CREATE],
]);

export const langfuseObservationTypeMapper: ObservationTypeMapper = {
	name: "langfuse",
	map: ({ attributes }) => {
		const rawType = stringValue(attributes["langfuse.observation.type"]);
		if (!rawType) return undefined;
		return langfuseObservationTypes.get(rawType.toLowerCase());
	},
};
