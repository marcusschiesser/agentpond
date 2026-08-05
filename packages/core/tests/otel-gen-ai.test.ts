import assert from "node:assert/strict";
import test from "node:test";
import { otelResourceSpansToEvents } from "../src/otel.js";

function attr(key: string, value: unknown) {
	return { key, value };
}

function convert(
	operation: string,
	attributes: Array<{ key: string; value: unknown }> = [],
	options: { parentSpanId?: string; spanId?: string } = {},
) {
	return otelResourceSpansToEvents([
		{
			scopeSpans: [
				{
					spans: [
						{
							traceId: "trace-1",
							spanId: options.spanId ?? "span-1",
							parentSpanId: options.parentSpanId,
							name: operation,
							startTimeUnixNano: "1781395200000000000",
							attributes: [
								attr("gen_ai.operation.name", operation),
								...attributes,
							],
						},
					],
				},
			],
		},
	]);
}

function observation(events: ReturnType<typeof convert>) {
	const event = events.find(({ type }) => type !== "trace-create");
	assert.ok(event);
	return event;
}

test("normalizes supported GenAI observation fields", () => {
	const cases = [
		["invoke_agent", "agent-create"],
		["agent_step", "chain-create"],
		["chat", "generation-create"],
		["execute_tool", "tool-create"],
	] as const;
	for (const [operation, type] of cases) {
		const event = observation(
			convert(operation, [], {
				parentSpanId: "parent",
				spanId: `span-${operation}`,
			}),
		);
		assert.equal(event.type, type);
		assert.equal(event.body.parentObservationId, "parent");
	}

	const event = observation(
		convert("chat", [
			attr("gen_ai.input.messages", '[{"role":"user","content":"hi"}]'),
			attr("gen_ai.output.messages", [{ role: "assistant", content: "hello" }]),
			attr("gen_ai.request.model", "requested"),
			attr("gen_ai.response.model", "actual"),
			attr("gen_ai.usage.input_tokens", "3"),
			attr("gen_ai.usage.output_tokens", 4),
		]),
	);
	assert.deepEqual(event.body.input, [{ role: "user", content: "hi" }]);
	assert.deepEqual(event.body.output, [
		{ role: "assistant", content: "hello" },
	]);
	assert.equal(event.body.model, "actual");
	assert.deepEqual(event.body.usageDetails, { input: 3, output: 4, total: 7 });
	assert.equal(event.body.metadata?.["gen_ai.request.model"], "requested");
});

test("normalizes tool and embedding compatibility attributes", () => {
	const tool = observation(
		convert("execute_tool", [
			attr("gen_ai.input.messages", "ignored"),
			attr("gen_ai.tool.call.arguments", '{"city":"Berlin"}'),
			attr("gen_ai.tool.call.result", { temperature: 21 }),
		]),
	);
	assert.deepEqual(tool.body.input, { city: "Berlin" });
	assert.deepEqual(tool.body.output, { temperature: 21 });

	const embedding = observation(
		convert("embeddings", [
			attr("ai.values", ['"first"', "not-json"]),
			attr("ai.embeddings", ["[0.1,0.2]", [0.3, 0.4]]),
		]),
	);
	assert.deepEqual(embedding.body.input, ["first", "not-json"]);
	assert.deepEqual(embedding.body.output, [
		[0.1, 0.2],
		[0.3, 0.4],
	]);
});

test("preserves missing and malformed optional content", () => {
	const missing = observation(convert("chat"));
	assert.equal(missing.body.input, undefined);
	assert.equal(missing.body.output, undefined);
	const malformed = observation(
		convert("chat", [attr("gen_ai.input.messages", "{not json")]),
	);
	assert.equal(malformed.body.input, "{not json");
});

test("explicit Langfuse fields win field-by-field, including null", () => {
	const event = observation(
		convert("chat", [
			attr("gen_ai.input.messages", '["genai"]'),
			attr("gen_ai.output.messages", '["genai"]'),
			attr("gen_ai.response.model", "genai-model"),
			attr("gen_ai.usage.input_tokens", 10),
			attr("langfuse.observation.input", "null"),
			attr("langfuse.observation.output", '{"source":"langfuse"}'),
			attr("langfuse.observation.model.name", "langfuse-model"),
			attr("langfuse.observation.usage_details", '{"input":1,"total":1}'),
		]),
	);
	assert.equal(event.body.input, null);
	assert.deepEqual(event.body.output, { source: "langfuse" });
	assert.equal(event.body.model, "langfuse-model");
	assert.deepEqual(event.body.usageDetails, { input: 1, total: 1 });
});

test("root traces use agent and GenAI content fallbacks", () => {
	const events = convert("invoke_agent", [
		attr("gen_ai.agent.name", "weather-agent"),
		attr("gen_ai.input.messages", '[{"role":"user","content":"weather"}]'),
		attr("gen_ai.output.messages", '[{"role":"assistant","content":"sunny"}]'),
	]);
	const trace = events.find(({ type }) => type === "trace-create");
	assert.ok(trace);
	assert.equal(trace.body.name, "weather-agent");
	assert.deepEqual(trace.body.input, [{ role: "user", content: "weather" }]);
	assert.deepEqual(trace.body.output, [
		{ role: "assistant", content: "sunny" },
	]);
});
