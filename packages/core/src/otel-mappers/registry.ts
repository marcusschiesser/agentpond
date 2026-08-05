import { eventTypes } from "../schemas.js";
import { genAiObservationTypeMapper } from "./gen-ai.js";
import { langfuseObservationTypeMapper } from "./langfuse.js";
import { openInferenceObservationTypeMapper } from "./openinference.js";
import type {
	NormalizedOtelObservation,
	NormalizedObservationFields,
	NormalizedTraceFields,
	ObservationMapperResult,
	ObservationTypeMapper,
} from "./types.js";
import { vercelAiObservationTypeMapper } from "./vercel-ai.js";

const observationTypeMappers: ObservationTypeMapper[] = [
	langfuseObservationTypeMapper,
	openInferenceObservationTypeMapper,
	genAiObservationTypeMapper,
	vercelAiObservationTypeMapper,
];

export function mapOtelObservation(
	attributes: Record<string, unknown>,
): NormalizedOtelObservation {
	const results: ObservationMapperResult[] = [];
	for (const mapper of observationTypeMappers) {
		const mapped = mapper.map({ attributes });
		if (mapped) results.push(mapped);
	}

	return {
		observationType:
			results.find(({ observationType }) => observationType)?.observationType ??
			eventTypes.SPAN_CREATE,
		observation: mergeFirstPresent(
			results.map(({ observation }) => observation),
		),
		rootTrace: mergeFirstPresent(results.map(({ rootTrace }) => rootTrace)),
		traceUpdate: mergeFirstPresent(
			results.map(({ traceUpdate }) => traceUpdate),
		),
		hasTraceUpdates: results.some(
			({ traceUpdate }) => traceUpdate !== undefined,
		),
	};
}

function mergeFirstPresent(
	patches: Array<NormalizedObservationFields | undefined>,
): NormalizedObservationFields;
function mergeFirstPresent(
	patches: Array<NormalizedTraceFields | undefined>,
): NormalizedTraceFields;
function mergeFirstPresent<T extends object>(patches: Array<T | undefined>): T {
	const result: Record<string, unknown> = {};
	for (const patch of patches) {
		if (!patch) continue;
		for (const [key, value] of Object.entries(patch)) {
			if (!Object.hasOwn(result, key)) result[key] = value;
		}
	}
	return result as T;
}
