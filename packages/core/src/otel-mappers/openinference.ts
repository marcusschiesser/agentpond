import { eventTypes } from "../schemas.js";
import { stringValue } from "../otel-parsers.js";
import type { ObservationTypeMapper } from "./types.js";

const openInferenceSpanKinds = new Map([
	["CHAIN", eventTypes.CHAIN_CREATE],
	["RETRIEVER", eventTypes.RETRIEVER_CREATE],
	["LLM", eventTypes.GENERATION_CREATE],
	["EMBEDDING", eventTypes.EMBEDDING_CREATE],
	["AGENT", eventTypes.AGENT_CREATE],
	["TOOL", eventTypes.TOOL_CREATE],
	["GUARDRAIL", eventTypes.GUARDRAIL_CREATE],
]);

export const openInferenceObservationTypeMapper: ObservationTypeMapper = {
	name: "openinference",
	map: ({ attributes }) => {
		const spanKind = stringValue(attributes["openinference.span.kind"]);
		if (!spanKind) return undefined;
		return openInferenceSpanKinds.get(spanKind.toUpperCase());
	},
};
