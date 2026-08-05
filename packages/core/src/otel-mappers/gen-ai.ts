import {
	arrayValue,
	nonNegativeNumberValue,
	parseJsonAttribute,
	stringValue,
} from "../otel-parsers.js";
import { eventTypes } from "../schemas.js";
import type { ObservationTypeMapper } from "./types.js";

const genAiOperations = new Map([
	["chat", eventTypes.GENERATION_CREATE],
	["text_completion", eventTypes.GENERATION_CREATE],
	["generate_content", eventTypes.GENERATION_CREATE],
	["embeddings", eventTypes.EMBEDDING_CREATE],
	["create_agent", eventTypes.AGENT_CREATE],
	["invoke_agent", eventTypes.AGENT_CREATE],
	["agent_step", eventTypes.CHAIN_CREATE],
	["execute_tool", eventTypes.TOOL_CREATE],
	["invoke_workflow", eventTypes.CHAIN_CREATE],
	["retrieval", eventTypes.RETRIEVER_CREATE],
	// Historical operation names retained for compatibility with older emitters.
	["completion", eventTypes.GENERATION_CREATE],
	["generate", eventTypes.GENERATION_CREATE],
]);

export type NormalizedGenAiFields = {
	agentName?: string;
	input?: unknown;
	output?: unknown;
	model?: string;
	usageDetails?: Record<string, number>;
};

function parsePluralAttribute(value: unknown): unknown[] | undefined {
	const values = arrayValue(parseJsonAttribute(value));
	return values?.map(parseJsonAttribute);
}

export function normalizeGenAiObservationFields(
	attributes: Record<string, unknown>,
): NormalizedGenAiFields | undefined {
	const operationName = stringValue(attributes["gen_ai.operation.name"]);
	if (!operationName || !genAiOperations.has(operationName)) return undefined;

	let input = parseJsonAttribute(attributes["gen_ai.input.messages"]);
	let output = parseJsonAttribute(attributes["gen_ai.output.messages"]);
	if (operationName === "execute_tool") {
		if ("gen_ai.tool.call.arguments" in attributes) {
			input = parseJsonAttribute(attributes["gen_ai.tool.call.arguments"]);
		}
		if ("gen_ai.tool.call.result" in attributes) {
			output = parseJsonAttribute(attributes["gen_ai.tool.call.result"]);
		}
	}
	if (operationName === "embeddings") {
		if ("ai.values" in attributes) {
			input = parsePluralAttribute(attributes["ai.values"]);
		} else if ("ai.value" in attributes) {
			input = parseJsonAttribute(attributes["ai.value"]);
		}
		if ("ai.embeddings" in attributes) {
			output = parsePluralAttribute(attributes["ai.embeddings"]);
		} else if ("ai.embedding" in attributes) {
			output = parseJsonAttribute(attributes["ai.embedding"]);
		}
	}

	const usageInput = nonNegativeNumberValue(
		attributes["gen_ai.usage.input_tokens"],
	);
	const usageOutput = nonNegativeNumberValue(
		attributes["gen_ai.usage.output_tokens"],
	);
	const usageDetails =
		usageInput === undefined && usageOutput === undefined
			? undefined
			: {
					...(usageInput === undefined ? {} : { input: usageInput }),
					...(usageOutput === undefined ? {} : { output: usageOutput }),
					total: (usageInput ?? 0) + (usageOutput ?? 0),
				};

	return {
		agentName: stringValue(attributes["gen_ai.agent.name"]),
		input,
		output,
		model:
			stringValue(attributes["gen_ai.response.model"]) ??
			stringValue(attributes["gen_ai.request.model"]),
		usageDetails,
	};
}

export const genAiObservationTypeMapper: ObservationTypeMapper = {
	name: "otel-gen-ai",
	map: ({ attributes }) => {
		const operationName = stringValue(attributes["gen_ai.operation.name"]);
		if (!operationName) return undefined;
		return genAiOperations.get(operationName);
	},
};
