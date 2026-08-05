import assert from "node:assert/strict";
import test from "node:test";
import { mapOtelObservation } from "../src/otel-mappers/registry.js";

function mapType(attributes: Record<string, unknown>) {
	return mapOtelObservation(attributes).observationType;
}

test("maps OpenTelemetry GenAI operations to observation event types", () => {
	const cases = [
		["chat", "generation-create"],
		["text_completion", "generation-create"],
		["generate_content", "generation-create"],
		["embeddings", "embedding-create"],
		["create_agent", "agent-create"],
		["invoke_agent", "agent-create"],
		["agent_step", "chain-create"],
		["execute_tool", "tool-create"],
		["invoke_workflow", "chain-create"],
		["retrieval", "retriever-create"],
		["completion", "generation-create"],
		["generate", "generation-create"],
	] as const;

	for (const [operationName, expectedType] of cases) {
		assert.equal(
			mapType({
				"gen_ai.operation.name": operationName,
			}),
			expectedType,
		);
	}
});

test("keeps unknown or missing GenAI operations as spans", () => {
	// A reranker is not a retriever; keep it plain until AgentPond has a native type.
	for (const operationName of [undefined, "", "custom_operation", "rerank"]) {
		assert.equal(
			mapType({
				"gen_ai.operation.name": operationName,
			}),
			"span-create",
		);
	}
});

test("applies explicit observation mapper precedence", () => {
	assert.equal(
		mapType({
			"langfuse.observation.type": "tool",
			"openinference.span.kind": "LLM",
			"gen_ai.operation.name": "chat",
			"operation.name": "ai.embed.doEmbed",
			"gen_ai.request.model": "text-embedding-3-small",
		}),
		"tool-create",
	);

	assert.equal(
		mapType({
			"openinference.span.kind": "TOOL",
			"gen_ai.operation.name": "chat",
		}),
		"tool-create",
	);

	assert.equal(
		mapType({
			"gen_ai.operation.name": "execute_tool",
			"operation.name": "ai.generateText.doGenerate",
			"gen_ai.request.model": "gpt-5-mini",
		}),
		"tool-create",
	);
});

test("composes normalized fields with field-level mapper precedence", () => {
	const mapped = mapOtelObservation({
		"langfuse.observation.type": "tool",
		"langfuse.observation.input": "null",
		"langfuse.trace.name": "explicit-trace",
		"gen_ai.operation.name": "chat",
		"gen_ai.agent.name": "fallback-agent",
		"gen_ai.input.messages": '["genai-input"]',
		"gen_ai.output.messages": '["genai-output"]',
	});

	assert.equal(mapped.observationType, "tool-create");
	assert.equal(mapped.observation.input, null);
	assert.deepEqual(mapped.observation.output, ["genai-output"]);
	assert.equal(mapped.rootTrace.name, "explicit-trace");
	assert.equal(mapped.rootTrace.input, null);
	assert.deepEqual(mapped.rootTrace.output, ["genai-output"]);

	const explicitUndefined = mapOtelObservation({
		"langfuse.observation.model.name": { invalid: true },
		"gen_ai.operation.name": "chat",
		"gen_ai.response.model": "fallback-model",
	});
	assert.equal(Object.hasOwn(explicitUndefined.observation, "model"), true);
	assert.equal(explicitUndefined.observation.model, undefined);
});

test("keeps root trace fallbacks out of explicit trace updates", () => {
	const mapped = mapOtelObservation({
		"langfuse.trace.name": "child-update",
		"gen_ai.operation.name": "chat",
		"gen_ai.input.messages": '["root-only"]',
	});

	assert.equal(mapped.hasTraceUpdates, true);
	assert.equal(mapped.traceUpdate.name, "child-update");
	assert.equal(Object.hasOwn(mapped.traceUpdate, "input"), false);
	assert.deepEqual(mapped.rootTrace.input, ["root-only"]);
});
