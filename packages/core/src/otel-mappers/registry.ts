import { eventTypes } from "../schemas.js";
import { langfuseObservationTypeMapper } from "./langfuse.js";
import { openInferenceObservationTypeMapper } from "./openinference.js";
import type {
	ObservationCreateEventType,
	ObservationTypeMapper,
} from "./types.js";
import { vercelAiObservationTypeMapper } from "./vercel-ai.js";

const observationTypeMappers: ObservationTypeMapper[] = [
	langfuseObservationTypeMapper,
	openInferenceObservationTypeMapper,
	vercelAiObservationTypeMapper,
];

export function mapOtelObservationEventType(
	attributes: Record<string, unknown>,
): ObservationCreateEventType {
	for (const mapper of observationTypeMappers) {
		const mapped = mapper.map({ attributes });
		if (mapped) return mapped;
	}
	return eventTypes.SPAN_CREATE;
}
