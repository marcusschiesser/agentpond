import {
	arrayValue,
	booleanValue,
	isObservationLevel,
	parseJsonRecordString,
	parseJsonString,
	stringValue,
} from "../otel-parsers.js";
import { eventTypes } from "../schemas.js";
import type {
	NormalizedObservationFields,
	NormalizedTraceFields,
	ObservationTypeMapper,
} from "./types.js";

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
		const observationType = rawType
			? langfuseObservationTypes.get(rawType.toLowerCase())
			: undefined;
		const observation = observationFields(attributes);
		const rootTrace = rootTraceFields(attributes, observation);
		const traceUpdate = hasTraceUpdatesFromAttributes(attributes)
			? traceUpdateFields(attributes)
			: undefined;

		if (
			observationType === undefined &&
			Object.keys(observation).length === 0 &&
			Object.keys(rootTrace).length === 0 &&
			traceUpdate === undefined
		) {
			return undefined;
		}

		return {
			observationType,
			observation,
			rootTrace,
			traceUpdate,
		};
	},
};

function observationFields(
	attributes: Record<string, unknown>,
): NormalizedObservationFields {
	const observation: NormalizedObservationFields = {};
	if (Object.hasOwn(attributes, "langfuse.observation.input")) {
		observation.input = parseJsonString(
			attributes["langfuse.observation.input"],
		);
	}
	if (Object.hasOwn(attributes, "langfuse.observation.output")) {
		observation.output = parseJsonString(
			attributes["langfuse.observation.output"],
		);
	}
	if (Object.hasOwn(attributes, "langfuse.observation.usage_details")) {
		observation.usageDetails = parseJsonRecordString(
			attributes["langfuse.observation.usage_details"],
		) as Record<string, number> | undefined;
	}
	if (Object.hasOwn(attributes, "langfuse.observation.cost_details")) {
		observation.costDetails = parseJsonRecordString(
			attributes["langfuse.observation.cost_details"],
		) as Record<string, number> | undefined;
	}
	if (Object.hasOwn(attributes, "langfuse.observation.model.name")) {
		observation.model = stringValue(
			attributes["langfuse.observation.model.name"],
		);
	}
	if (Object.hasOwn(attributes, "langfuse.observation.model.parameters")) {
		observation.modelParameters = parseJsonRecordString(
			attributes["langfuse.observation.model.parameters"],
		) as NormalizedObservationFields["modelParameters"];
	}
	if (Object.hasOwn(attributes, "langfuse.observation.level")) {
		const level = stringValue(attributes["langfuse.observation.level"]);
		observation.level = isObservationLevel(level) ? level : undefined;
	}
	if (Object.hasOwn(attributes, "langfuse.observation.status_message")) {
		observation.statusMessage = stringValue(
			attributes["langfuse.observation.status_message"],
		);
	}
	if (Object.hasOwn(attributes, "langfuse.version")) {
		observation.version = stringValue(attributes["langfuse.version"]);
	}
	if (Object.hasOwn(attributes, "langfuse.environment")) {
		observation.environment = stringValue(attributes["langfuse.environment"]);
	}
	return observation;
}

function rootTraceFields(
	attributes: Record<string, unknown>,
	observation: NormalizedObservationFields,
): NormalizedTraceFields {
	const trace: NormalizedTraceFields = {};
	const traceName = stringValue(attributes["langfuse.trace.name"]);
	if (traceName !== undefined) trace.name = traceName;

	const userId = firstStringValue(attributes, [
		"langfuse.user.id",
		"user.id",
		"langfuse.observation.metadata.langfuse_user_id",
		"langfuse.trace.metadata.langfuse_user_id",
		"ai.telemetry.metadata.userId",
	]);
	if (userId !== undefined) trace.userId = userId;

	const sessionId = firstStringValue(attributes, [
		"langfuse.session.id",
		"session.id",
		"gen_ai.conversation.id",
		"langfuse.observation.metadata.langfuse_session_id",
		"langfuse.trace.metadata.langfuse_session_id",
		"ai.telemetry.metadata.sessionId",
	]);
	if (sessionId !== undefined) trace.sessionId = sessionId;

	const metadata = traceMetadataFromAttributes(attributes);
	if (metadata !== undefined) trace.metadata = metadata;

	if (Object.hasOwn(attributes, "langfuse.trace.input")) {
		trace.input = parseJsonString(attributes["langfuse.trace.input"]);
	} else if (Object.hasOwn(observation, "input")) {
		trace.input = observation.input;
	}
	if (Object.hasOwn(attributes, "langfuse.trace.output")) {
		trace.output = parseJsonString(attributes["langfuse.trace.output"]);
	} else if (Object.hasOwn(observation, "output")) {
		trace.output = observation.output;
	}

	const tags = traceTagsFromAttributes(attributes);
	if (tags !== undefined) trace.tags = tags;
	const tracePublic = booleanValue(attributes["langfuse.trace.public"]);
	if (tracePublic !== undefined) trace.public = tracePublic;
	if (Object.hasOwn(attributes, "langfuse.version")) {
		trace.version = stringValue(attributes["langfuse.version"]);
	}
	if (Object.hasOwn(attributes, "langfuse.environment")) {
		trace.environment = stringValue(attributes["langfuse.environment"]);
	}
	return trace;
}

function traceUpdateFields(
	attributes: Record<string, unknown>,
): NormalizedTraceFields {
	const trace: NormalizedTraceFields = {};
	const traceName = stringValue(attributes["langfuse.trace.name"]);
	if (traceName !== undefined) trace.name = traceName;

	const userId = firstStringValue(attributes, [
		"langfuse.user.id",
		"user.id",
		"langfuse.observation.metadata.langfuse_user_id",
		"langfuse.trace.metadata.langfuse_user_id",
		"ai.telemetry.metadata.userId",
	]);
	if (userId !== undefined) trace.userId = userId;
	const sessionId = firstStringValue(attributes, [
		"langfuse.session.id",
		"session.id",
		"gen_ai.conversation.id",
		"langfuse.observation.metadata.langfuse_session_id",
		"langfuse.trace.metadata.langfuse_session_id",
		"ai.telemetry.metadata.sessionId",
	]);
	if (sessionId !== undefined) trace.sessionId = sessionId;

	const metadata = traceMetadataFromAttributes(attributes);
	if (metadata !== undefined) trace.metadata = metadata;
	if (Object.hasOwn(attributes, "langfuse.trace.input")) {
		trace.input = parseJsonString(attributes["langfuse.trace.input"]);
	}
	if (Object.hasOwn(attributes, "langfuse.trace.output")) {
		trace.output = parseJsonString(attributes["langfuse.trace.output"]);
	}
	const tags = traceTagsFromAttributes(attributes);
	if (tags !== undefined) trace.tags = tags;
	const tracePublic = booleanValue(attributes["langfuse.trace.public"]);
	if (tracePublic !== undefined) trace.public = tracePublic;
	if (Object.hasOwn(attributes, "langfuse.version")) {
		trace.version = stringValue(attributes["langfuse.version"]);
	}
	return trace;
}

function traceMetadataFromAttributes(
	attributes: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const traceMetadata =
		parseJsonRecordString(attributes["langfuse.trace.metadata"]) ?? {};
	for (const [key, value] of Object.entries(attributes)) {
		if (key.startsWith("langfuse.trace.metadata.")) {
			traceMetadata[key.slice("langfuse.trace.metadata.".length)] =
				parseJsonMetadataValue(value);
		}
	}
	return Object.keys(traceMetadata).length > 0 ? traceMetadata : undefined;
}

function firstStringValue(
	attributes: Record<string, unknown>,
	keys: string[],
): string | undefined {
	for (const key of keys) {
		const value = stringValue(attributes[key]);
		if (value) return value;
	}
	return undefined;
}

function traceTagsFromAttributes(
	attributes: Record<string, unknown>,
): string[] | undefined {
	const raw =
		attributes["langfuse.trace.tags"] ??
		attributes["langfuse.tags"] ??
		attributes["langfuse.observation.metadata.langfuse_tags"] ??
		attributes["langfuse.trace.metadata.langfuse_tags"] ??
		attributes["ai.telemetry.metadata.tags"] ??
		attributes["tag.tags"];
	if (raw === undefined || raw === null) return undefined;
	const array = arrayValue(raw);
	if (array) return array.map((tag) => String(tag));
	if (typeof raw !== "string") return [String(raw)];
	const parsed = parseJsonString(raw);
	if (Array.isArray(parsed)) return parsed.map((tag) => String(tag));
	if (raw.includes(",")) return raw.split(",").map((tag) => tag.trim());
	return raw ? [raw] : undefined;
}

function hasTraceUpdatesFromAttributes(
	attributes: Record<string, unknown>,
): boolean {
	const traceAttributeKeys = [
		"langfuse.trace.name",
		"langfuse.trace.input",
		"langfuse.trace.output",
		"langfuse.trace.metadata",
		"user.id",
		"session.id",
		"langfuse.trace.public",
		"langfuse.trace.tags",
		"langfuse.user.id",
		"langfuse.session.id",
		"langfuse.observation.metadata.langfuse_user_id",
		"langfuse.observation.metadata.langfuse_session_id",
		"langfuse.observation.metadata.langfuse_tags",
		"langfuse.trace.metadata.langfuse_session_id",
		"langfuse.trace.metadata.langfuse_user_id",
		"langfuse.trace.metadata.langfuse_tags",
		"ai.telemetry.metadata.sessionId",
		"ai.telemetry.metadata.userId",
		"ai.telemetry.metadata.tags",
		"tag.tags",
	];
	return (
		traceAttributeKeys.some((key) => Boolean(attributes[key])) ||
		Object.keys(attributes).some((key) =>
			key.startsWith("langfuse.trace.metadata"),
		)
	);
}

function parseJsonMetadataValue(value: unknown): unknown {
	return typeof value === "string" ? parseJsonString(value) : value;
}
