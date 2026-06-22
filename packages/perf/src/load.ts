import {
	getActiveTraceId,
	propagateAttributes,
	startActiveObservation,
} from "@langfuse/tracing";

type ObservationType = "span" | "generation" | "tool";

export type LoadProgress = {
	generatedTraces: number;
	totalTraces: number;
};

export async function generateLoad(
	traceCount: number,
	onProgress?: (progress: LoadProgress) => void,
): Promise<number> {
	let generated = 0;
	onProgress?.({ generatedTraces: generated, totalTraces: traceCount });
	for (let i = 0; i < traceCount; i += 1) {
		await generateTrace(i);
		generated += 1;
		if (generated === traceCount || generated % 1000 === 0) {
			onProgress?.({ generatedTraces: generated, totalTraces: traceCount });
		}
	}
	return generated;
}

async function generateTrace(index: number): Promise<void> {
	const sessionId = `perf-session-${index % 250}`;
	const userId = `perf-user-${index % 10_000}`;
	let traceId: string | undefined;

	await startActiveObservation(`agent workflow ${index}`, async (root) => {
		traceId = getActiveTraceId();
		root.update({
			input: makeTraceInput(index),
			output: makeTraceOutput(index),
			metadata: makeTraceMetadata(index),
		});

		await propagateAttributes(
			{
				userId,
				sessionId,
				traceName: `agent workflow ${index}`,
				metadata: {
					benchmark: "langfuse-sync",
					tenant: `tenant-${index % 25}`,
					route: `/api/tasks/${index % 40}`,
					cohort: index % 2 === 0 ? "control" : "variant",
				},
			},
			async () => {
				const childSpanCount = 2 + (index % 6);
				for (let child = 0; child < childSpanCount; child += 1) {
					await generateChildObservation(index, child);
				}
			},
		);

		root.update({
			output: {
				status: "completed",
				steps: 2 + (index % 6),
				decision: `decision-${index % 13}`,
			},
		});
	});

	if (!traceId) throw new Error(`Langfuse SDK did not create trace ${index}`);
}

async function generateChildObservation(
	traceIndex: number,
	childIndex: number,
): Promise<void> {
	const type = observationType(traceIndex, childIndex);
	const name = `${type} step ${childIndex}`;
	await startActiveObservation(
		name,
		async (span) => {
			if (type === "generation") {
				const inputTokens = 120 + ((traceIndex + childIndex) % 700);
				const outputTokens = 40 + ((traceIndex * 3 + childIndex) % 260);
				span.update({
					model: `gpt-perf-${(traceIndex + childIndex) % 4}`,
					input: makeMessages(traceIndex, childIndex),
					output: {
						answer: sizedText("generated answer", traceIndex, childIndex),
						tool_calls: childIndex % 3,
					},
					metadata: {
						provider: "benchmark-fixture",
						temperature: Number((0.1 + (childIndex % 5) * 0.1).toFixed(1)),
						cache_hit: traceIndex % 9 === 0,
					},
					usageDetails: {
						input: inputTokens,
						output: outputTokens,
						total: inputTokens + outputTokens,
					},
					costDetails: {
						input: roundCost(inputTokens * 0.0000015),
						output: roundCost(outputTokens * 0.000006),
						total: roundCost(inputTokens * 0.0000015 + outputTokens * 0.000006),
					},
				});
				return;
			}

			span.update({
				input: {
					step: childIndex,
					payload: sizedText("step input", traceIndex, childIndex),
				},
				output: {
					ok: true,
					items: Array.from({ length: 1 + (childIndex % 4) }, (_, offset) => ({
						id: `item-${traceIndex}-${childIndex}-${offset}`,
						score: Number(((traceIndex + offset) % 100) / 100).toFixed(2),
					})),
				},
				metadata: {
					component: type,
					retry_count: traceIndex % 5 === 0 ? 1 : 0,
					latency_bucket: ["fast", "normal", "slow"][
						(traceIndex + childIndex) % 3
					],
				},
			});
		},
		{ asType: type },
	);
}

function observationType(
	traceIndex: number,
	childIndex: number,
): ObservationType {
	if (childIndex % 3 === 1) return "generation";
	if ((traceIndex + childIndex) % 4 === 0) return "tool";
	return "span";
}

function makeTraceInput(index: number): Record<string, unknown> {
	return {
		task_id: `task-${index}`,
		question: sizedText("customer asks for help", index, 0),
		priority: ["low", "normal", "high"][index % 3],
	};
}

function makeTraceOutput(index: number): Record<string, unknown> {
	return {
		status: "queued",
		expected_steps: 2 + (index % 6),
	};
}

function makeTraceMetadata(index: number): Record<string, unknown> {
	return {
		benchmark: "langfuse-sync",
		release: "perf-2026-06-22",
		feature: `feature-${index % 12}`,
		size_class: ["small", "medium", "large", "xl"][index % 4],
	};
}

function makeMessages(
	traceIndex: number,
	childIndex: number,
): Array<Record<string, string>> {
	return [
		{
			role: "system",
			content: "Follow policy, inspect context, and answer concisely.",
		},
		{
			role: "user",
			content: sizedText("perform task", traceIndex, childIndex),
		},
	];
}

function sizedText(
	label: string,
	traceIndex: number,
	childIndex: number,
): string {
	const size = 64 + ((traceIndex * 31 + childIndex * 17) % 1536);
	return `${label} ${traceIndex}/${childIndex} `.repeat(
		Math.max(1, Math.ceil(size / Math.max(1, label.length + 16))),
	);
}

function roundCost(value: number): number {
	return Math.round(value * 1_000_000) / 1_000_000;
}
