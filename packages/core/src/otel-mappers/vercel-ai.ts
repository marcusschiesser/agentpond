import { eventTypes } from "../schemas.js";
import type { ObservationTypeMapper } from "./types.js";

const generationPrefixes = [
	"ai.generateText",
	"ai.generateText.doGenerate",
	"ai.streamText.doStream",
	"ai.generateObject",
	"ai.generateObject.doGenerate",
	"ai.streamObject.doStream",
];

const embeddingPrefixes = ["ai.embedMany.doEmbed", "ai.embed.doEmbed"];
const modelKeys = [
	"langfuse.observation.model.name",
	"ai.model.id",
	"gen_ai.request.model",
	"gen_ai.response.model",
];

export const vercelAiObservationTypeMapper: ObservationTypeMapper = {
	name: "vercel-ai",
	map: ({ attributes }) => {
		if (matchesOperation(attributes, ["ai.toolCall"])) {
			return eventTypes.TOOL_CREATE;
		}

		if (!hasAnyMeaningfulValue(attributes, modelKeys)) {
			return undefined;
		}

		if (matchesOperation(attributes, generationPrefixes)) {
			return eventTypes.GENERATION_CREATE;
		}
		if (matchesOperation(attributes, embeddingPrefixes)) {
			return eventTypes.EMBEDDING_CREATE;
		}
		return undefined;
	},
};

function matchesOperation(
	attributes: Record<string, unknown>,
	prefixes: string[],
): boolean {
	const operationName = stringAttribute(attributes["operation.name"]);
	if (
		operationName &&
		prefixes.some((prefix) => operationName.startsWith(prefix))
	) {
		return true;
	}

	const operationId = stringAttribute(attributes["ai.operationId"]);
	return Boolean(operationId && prefixes.includes(operationId));
}

function hasAnyMeaningfulValue(
	attributes: Record<string, unknown>,
	keys: string[],
): boolean {
	return keys.some((key) => hasMeaningfulValue(attributes[key]));
}

function hasMeaningfulValue(value: unknown): boolean {
	if (value === null || value === undefined || value === "") return false;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "object") return Object.keys(value).length > 0;
	return true;
}

function stringAttribute(value: unknown): string | undefined {
	if (!hasMeaningfulValue(value)) return undefined;
	return typeof value === "string" ? value : String(value);
}
