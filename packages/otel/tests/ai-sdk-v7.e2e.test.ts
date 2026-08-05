import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MemoryObjectStore } from "@agentpond/core";
import { AgentPondCache } from "@agentpond/duckdb";
import { OpenTelemetry } from "@ai-sdk/otel";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BasicTracerProvider,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { jsonSchema, registerTelemetry, ToolLoopAgent, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { AgentPondSpanExporter } from "../src/index.js";

type ObservationRow = {
	id: string;
	parent_observation_id: string | null;
	type: string;
	name: string;
	input_json: string | null;
	output_json: string | null;
	usage_details_json: string | null;
	metadata_json: string | null;
};

const usage = (input: number, output: number) => ({
	inputTokens: {
		total: input,
		noCache: input,
		cacheRead: 0,
		cacheWrite: 0,
	},
	outputTokens: {
		total: output,
		text: output,
		reasoning: 0,
	},
});

test("AI SDK 7 ToolLoopAgent exports and syncs a complete GenAI trace", async () => {
	const projectId = "ai-sdk-v7-e2e";
	const store = new MemoryObjectStore();
	const exporter = new AgentPondSpanExporter({ store, projectId });
	const provider = new BasicTracerProvider({
		resource: resourceFromAttributes({ "service.name": "ai-sdk-v7-e2e" }),
		spanProcessors: [new SimpleSpanProcessor(exporter)],
	});
	const tracer = provider.getTracer("ai-sdk-v7-e2e");
	registerTelemetry(new OpenTelemetry({ tracer }));

	const model = new MockLanguageModelV4({
		provider: "mock-provider",
		modelId: "mock-weather-model",
		doGenerate: [
			{
				content: [
					{
						type: "tool-call",
						toolCallId: "weather-call-1",
						toolName: "weather",
						input: JSON.stringify({ city: "Madrid" }),
					},
				],
				finishReason: { unified: "tool-calls", raw: "tool-calls" },
				usage: usage(11, 7),
				warnings: [],
				response: {
					id: "mock-response-1",
					modelId: "mock-weather-response-model",
				},
			},
			{
				content: [
					{
						type: "text",
						text: "Madrid is sunny and 27°C.",
					},
				],
				finishReason: { unified: "stop", raw: "stop" },
				usage: usage(13, 5),
				warnings: [],
				response: {
					id: "mock-response-2",
					modelId: "mock-weather-response-model",
				},
			},
		],
	});

	const agent = new ToolLoopAgent({
		model,
		telemetry: {
			functionId: "weather-agent",
		},
		tools: {
			weather: tool({
				description: "Get deterministic weather for a city",
				inputSchema: jsonSchema<{ city: string }>({
					type: "object",
					properties: { city: { type: "string" } },
					required: ["city"],
					additionalProperties: false,
				}),
				execute: async ({ city }) => ({
					city,
					condition: "sunny",
					celsius: 27,
				}),
			}),
		},
	});

	try {
		const result = await agent.generate({
			prompt: "What is the weather in Madrid?",
		});
		assert.equal(result.text, "Madrid is sunny and 27°C.");
		await provider.forceFlush();
	} finally {
		await provider.shutdown();
	}

	assert.ok((await store.listKeys(`otel/${projectId}/`)).length > 0);

	const root = mkdtempSync(join(tmpdir(), "agentpond-ai-sdk-v7-"));
	const cache = new AgentPondCache(join(root, "cache.duckdb"));
	try {
		const sync = await cache.syncFromStore({
			store,
			projectId,
			prefix: "",
		});
		assert.ok(sync.eventsProcessed >= 7);

		const traces = await cache.query<{
			id: string;
			name: string;
			input_json: string | null;
			output_json: string | null;
		}>("select id, name, input_json, output_json from traces");
		assert.equal(traces.length, 1);
		const trace = traces[0];
		assert.equal(trace.name, "weather-agent");
		assert.deepEqual(JSON.parse(trace.input_json ?? "null"), [
			{
				role: "user",
				parts: [
					{
						type: "text",
						content: "What is the weather in Madrid?",
					},
				],
			},
		]);
		const traceOutput = JSON.parse(trace.output_json ?? "null") as Array<{
			parts?: Array<{ type?: string; content?: string }>;
		}>;
		assert.ok(
			traceOutput[0]?.parts?.some(
				(part) =>
					part.type === "text" && part.content === "Madrid is sunny and 27°C.",
			),
		);

		const observations = await cache.query<ObservationRow>(
			"select id, parent_observation_id, type, name, input_json, output_json, usage_details_json, metadata_json from observations order by start_time, name",
		);
		assert.equal(observations.length, 6);
		assert.equal(
			observations.some((observation) => observation.type === "span-create"),
			false,
		);

		const agentObservation = observations.find(
			(observation) => observation.type === "agent-create",
		);
		assert.ok(agentObservation);
		assert.equal(agentObservation.parent_observation_id, null);
		assert.deepEqual(
			JSON.parse(agentObservation.input_json ?? "null"),
			JSON.parse(trace.input_json ?? "null"),
		);
		assert.deepEqual(
			JSON.parse(agentObservation.output_json ?? "null"),
			traceOutput,
		);
		assert.deepEqual(
			JSON.parse(agentObservation.usage_details_json ?? "null"),
			{ input: 24, output: 12, total: 36 },
		);

		const steps = observations.filter(
			(observation) => observation.type === "chain-create",
		);
		assert.equal(steps.length, 2);
		assert.ok(
			steps.every(
				(observation) =>
					observation.parent_observation_id === agentObservation.id,
			),
		);

		const generations = observations.filter(
			(observation) => observation.type === "generation-create",
		);
		assert.equal(generations.length, 2);
		assert.ok(
			steps.every(
				(step) =>
					generations.filter(
						(generation) => generation.parent_observation_id === step.id,
					).length === 1,
			),
		);
		assert.deepEqual(
			generations
				.map((generation) =>
					JSON.parse(generation.usage_details_json ?? "null"),
				)
				.sort((a, b) => a.input - b.input),
			[
				{ input: 11, output: 7, total: 18 },
				{ input: 13, output: 5, total: 18 },
			],
		);

		const firstStep = steps.find(
			(observation) => observation.name === "step 1",
		);
		assert.ok(firstStep);
		const toolObservation = observations.find(
			(observation) => observation.type === "tool-create",
		);
		assert.ok(toolObservation);
		assert.equal(toolObservation.parent_observation_id, firstStep.id);
		assert.deepEqual(JSON.parse(toolObservation.input_json ?? "null"), {
			city: "Madrid",
		});
		assert.deepEqual(JSON.parse(toolObservation.output_json ?? "null"), {
			city: "Madrid",
			condition: "sunny",
			celsius: 27,
		});

		assert.ok(
			generations.some((generation) => {
				const input = JSON.parse(generation.input_json ?? "null") as Array<{
					parts?: Array<{ content?: string }>;
				}>;
				return (
					input[0]?.parts?.[0]?.content === "What is the weather in Madrid?"
				);
			}),
		);
		assert.ok(
			generations.some((generation) => {
				const output = JSON.parse(generation.output_json ?? "null") as Array<{
					parts?: Array<{ content?: string }>;
				}>;
				return output[0]?.parts?.some(
					(part) => part.content === "Madrid is sunny and 27°C.",
				);
			}),
		);

		const generationRawEvents = await cache.query<{ body_json: string }>(
			"select body_json from events_raw where event_type = 'generation-create'",
		);
		assert.equal(generationRawEvents.length, 2);
		for (const event of generationRawEvents) {
			const body = JSON.parse(event.body_json) as {
				model?: string;
				metadata?: Record<string, unknown>;
			};
			assert.equal(body.model, "mock-weather-model");
			assert.equal(
				body.metadata?.["gen_ai.request.model"],
				"mock-weather-model",
			);
			assert.equal(body.metadata?.["gen_ai.operation.name"], "chat");
		}
		for (const generation of generations) {
			const metadata = JSON.parse(generation.metadata_json ?? "null") as Record<
				string,
				unknown
			>;
			assert.equal(metadata["gen_ai.request.model"], "mock-weather-model");
			assert.equal(metadata["gen_ai.operation.name"], "chat");
		}
	} finally {
		await cache.close();
	}
});
