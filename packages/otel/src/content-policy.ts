export const AGENTPOND_REDACTED_VALUE = "__REDACTED__";

export type AgentPondContentPolicy = "metadata-only" | "capture";

type OtelAttribute = {
	key?: unknown;
	value?: unknown;
};

const redactedAttributeKeys = new Set([
	"ai.prompt",
	"ai.response.object",
	"ai.response.text",
	"ai.response.toolCalls",
	"ai.toolCall.args",
	"ai.toolCall.result",
	"error.message",
	"error.stack",
	"error.stacktrace",
	"exception.message",
	"exception.stacktrace",
	"gen_ai.completion",
	"gen_ai.prompt",
	"gen_ai.system_instructions",
	"http.request.body",
	"http.response.body",
	"input.value",
	"langfuse.observation.input",
	"langfuse.observation.output",
	"langfuse.trace.input",
	"langfuse.trace.output",
	"output.value",
]);

const removedAttributeKeys = new Set(["input.attributes", "output.attributes"]);

const removedAttributePrefixes = [
	"gen_ai.completion.",
	"gen_ai.input.messages",
	"gen_ai.output.messages",
	"gen_ai.prompt.",
	"gen_ai.system_instructions.",
	"input.attributes.",
	"llm.input_messages",
	"llm.output_messages",
	"output.attributes.",
];

export function applyAgentPondContentPolicy(
	resourceSpans: unknown[],
	policy: AgentPondContentPolicy,
): void {
	if (policy === "capture") return;

	for (const resourceSpan of resourceSpans) {
		const resourceSpanRecord = record(resourceSpan);
		if (!resourceSpanRecord) continue;
		sanitizeAttributes(record(resourceSpanRecord.resource));
		sanitizeScopeSpans(resourceSpanRecord.scopeSpans);
		sanitizeScopeSpans(resourceSpanRecord.instrumentationLibrarySpans);
	}
}

function sanitizeScopeSpans(value: unknown): void {
	if (!Array.isArray(value)) return;
	for (const scopeSpan of value) {
		const scopeSpanRecord = record(scopeSpan);
		if (!scopeSpanRecord || !Array.isArray(scopeSpanRecord.spans)) continue;
		for (const span of scopeSpanRecord.spans) sanitizeSpan(span);
	}
}

function sanitizeSpan(value: unknown): void {
	const span = record(value);
	if (!span) return;
	sanitizeAttributes(span);
	sanitizeStatus(span.status);

	if (Array.isArray(span.events)) {
		for (const event of span.events) sanitizeAttributes(record(event));
	}
	if (Array.isArray(span.links)) {
		for (const link of span.links) sanitizeAttributes(record(link));
	}
}

function sanitizeAttributes(
	container: Record<string, unknown> | undefined,
): void {
	if (!container || !Array.isArray(container.attributes)) return;
	container.attributes = container.attributes.filter((attribute) => {
		const entry = record(attribute) as OtelAttribute | undefined;
		if (!entry || typeof entry.key !== "string") return true;
		const key = entry.key;
		if (removedAttributeKeys.has(key)) return false;
		if (removedAttributePrefixes.some((prefix) => key.startsWith(prefix))) {
			return false;
		}
		if (redactedAttributeKeys.has(key)) {
			entry.value = { stringValue: AGENTPOND_REDACTED_VALUE };
		}
		return true;
	});
}

function sanitizeStatus(value: unknown): void {
	const status = record(value);
	if (!status || typeof status.message !== "string" || !status.message) return;
	status.message = AGENTPOND_REDACTED_VALUE;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}
