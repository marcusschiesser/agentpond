import { stringValue } from "../otel-parsers.js";
import { eventTypes } from "../schemas.js";
import type { ObservationTypeMapper } from "./types.js";

const genAiOperations = new Map([
	["chat", eventTypes.GENERATION_CREATE],
	["text_completion", eventTypes.GENERATION_CREATE],
	["generate_content", eventTypes.GENERATION_CREATE],
	["embeddings", eventTypes.EMBEDDING_CREATE],
	["create_agent", eventTypes.AGENT_CREATE],
	["invoke_agent", eventTypes.AGENT_CREATE],
	["execute_tool", eventTypes.TOOL_CREATE],
	["invoke_workflow", eventTypes.CHAIN_CREATE],
	["retrieval", eventTypes.RETRIEVER_CREATE],
	// Historical operation names retained for compatibility with older emitters.
	["completion", eventTypes.GENERATION_CREATE],
	["generate", eventTypes.GENERATION_CREATE],
]);

export const genAiObservationTypeMapper: ObservationTypeMapper = {
	name: "otel-gen-ai",
	map: ({ attributes }) => {
		const operationName = stringValue(attributes["gen_ai.operation.name"]);
		if (!operationName) return undefined;
		return genAiOperations.get(operationName);
	},
};
