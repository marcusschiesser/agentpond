import assert from "node:assert/strict";
import test from "node:test";
import { mapOtelObservationEventType } from "../src/otel-mappers/registry.js";

test("maps OpenTelemetry GenAI operations to observation event types", () => {
	const cases = [
		["chat", "generation-create"],
		["text_completion", "generation-create"],
		["generate_content", "generation-create"],
		["embeddings", "embedding-create"],
		["create_agent", "agent-create"],
		["invoke_agent", "agent-create"],
		["execute_tool", "tool-create"],
		["invoke_workflow", "chain-create"],
		["retrieval", "retriever-create"],
		["completion", "generation-create"],
		["generate", "generation-create"],
	] as const;

	for (const [operationName, expectedType] of cases) {
		assert.equal(
			mapOtelObservationEventType({
				"gen_ai.operation.name": operationName,
			}),
			expectedType,
		);
	}
});

test("keeps unknown or missing GenAI operations as spans", () => {
	for (const operationName of [undefined, "", "custom_operation"]) {
		assert.equal(
			mapOtelObservationEventType({
				"gen_ai.operation.name": operationName,
			}),
			"span-create",
		);
	}
});

test("applies explicit observation mapper precedence", () => {
	assert.equal(
		mapOtelObservationEventType({
			"langfuse.observation.type": "tool",
			"openinference.span.kind": "LLM",
			"gen_ai.operation.name": "chat",
			"operation.name": "ai.embed.doEmbed",
			"gen_ai.request.model": "text-embedding-3-small",
		}),
		"tool-create",
	);

	assert.equal(
		mapOtelObservationEventType({
			"openinference.span.kind": "TOOL",
			"gen_ai.operation.name": "chat",
		}),
		"tool-create",
	);

	assert.equal(
		mapOtelObservationEventType({
			"gen_ai.operation.name": "execute_tool",
			"operation.name": "ai.generateText.doGenerate",
			"gen_ai.request.model": "gpt-5-mini",
		}),
		"tool-create",
	);
});
