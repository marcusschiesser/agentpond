import {
	arrayValue,
	nonNegativeNumberValue,
	parseJsonAttribute,
	stringValue,
} from "../otel-parsers.js";
import { eventTypes } from "../schemas.js";
import type {
	NormalizedObservationFields,
	NormalizedTraceFields,
	ObservationMapperResult,
	ObservationTypeMapper,
} from "./types.js";

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

function parsePluralAttribute(value: unknown): unknown[] | undefined {
	const values = arrayValue(parseJsonAttribute(value));
	return values?.map(parseJsonAttribute);
}

function mapGenAiObservation(
	attributes: Record<string, unknown>,
): ObservationMapperResult | undefined {
	const operationName = stringValue(attributes["gen_ai.operation.name"]);
	if (!operationName) return undefined;
	const observationType = genAiOperations.get(operationName);
	if (!observationType) return undefined;

	const observation: NormalizedObservationFields = {};
	if (Object.hasOwn(attributes, "gen_ai.input.messages")) {
		observation.input = parseJsonAttribute(attributes["gen_ai.input.messages"]);
	}
	if (Object.hasOwn(attributes, "gen_ai.output.messages")) {
		observation.output = parseJsonAttribute(
			attributes["gen_ai.output.messages"],
		);
	}
	if (operationName === "execute_tool") {
		if (Object.hasOwn(attributes, "gen_ai.tool.call.arguments")) {
			observation.input = parseJsonAttribute(
				attributes["gen_ai.tool.call.arguments"],
			);
		}
		if (Object.hasOwn(attributes, "gen_ai.tool.call.result")) {
			observation.output = parseJsonAttribute(
				attributes["gen_ai.tool.call.result"],
			);
		}
	}
	if (operationName === "embeddings") {
		if (Object.hasOwn(attributes, "ai.values")) {
			observation.input = parsePluralAttribute(attributes["ai.values"]);
		} else if (Object.hasOwn(attributes, "ai.value")) {
			observation.input = parseJsonAttribute(attributes["ai.value"]);
		}
		if (Object.hasOwn(attributes, "ai.embeddings")) {
			observation.output = parsePluralAttribute(attributes["ai.embeddings"]);
		} else if (Object.hasOwn(attributes, "ai.embedding")) {
			observation.output = parseJsonAttribute(attributes["ai.embedding"]);
		}
	}

	if (
		Object.hasOwn(attributes, "gen_ai.usage.input_tokens") ||
		Object.hasOwn(attributes, "gen_ai.usage.output_tokens")
	) {
		const usageInput = nonNegativeNumberValue(
			attributes["gen_ai.usage.input_tokens"],
		);
		const usageOutput = nonNegativeNumberValue(
			attributes["gen_ai.usage.output_tokens"],
		);
		observation.usageDetails =
			usageInput === undefined && usageOutput === undefined
				? undefined
				: {
						...(usageInput === undefined ? {} : { input: usageInput }),
						...(usageOutput === undefined ? {} : { output: usageOutput }),
						total: (usageInput ?? 0) + (usageOutput ?? 0),
					};
	}

	const model =
		stringValue(attributes["gen_ai.response.model"]) ??
		stringValue(attributes["gen_ai.request.model"]);
	if (model !== undefined) observation.model = model;

	const rootTrace: NormalizedTraceFields = {};
	const agentName = stringValue(attributes["gen_ai.agent.name"]);
	if (agentName !== undefined) rootTrace.name = agentName;
	if (Object.hasOwn(observation, "input")) {
		rootTrace.input = observation.input;
	}
	if (Object.hasOwn(observation, "output")) {
		rootTrace.output = observation.output;
	}

	return {
		observationType,
		observation,
		rootTrace,
	};
}

export const genAiObservationTypeMapper: ObservationTypeMapper = {
	name: "otel-gen-ai",
	map: ({ attributes }) => mapGenAiObservation(attributes),
};
