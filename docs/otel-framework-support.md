# OTEL Framework Support

## Decision

AgentPond treats OTEL spans as first-class Langfuse observations when they use the explicit Langfuse attribute shape, for example:

- `langfuse.observation.type`
- `langfuse.observation.usage_details`
- `langfuse.observation.cost_details`
- `langfuse.observation.model.name`
- `langfuse.trace.*`

AgentPond also supports a small mapper set for common framework telemetry:

- OpenInference `openinference.span.kind` maps supported values such as `LLM`, `CHAIN`, `TOOL`, and `EMBEDDING` to AgentPond observation event types.
- Vercel AI SDK `operation.name` or `ai.operationId` maps tool calls to `tool-create`, and generation or embedding operations to their matching event types when model information is present.

Currently, for Vercel AI SDK, prefer the Langfuse SDK integration path: enable AI SDK telemetry and use `@langfuse/otel` / `@langfuse/tracing` to emit Langfuse-compatible telemetry where possible.

## Rationale

Langfuse's full OTEL mapper tracks many evolving conventions: GenAI semantic conventions, OpenInference, Vercel AI SDK, OpenLLMetry, OpenLIT, and framework-specific fields from LangChain, LlamaIndex, LiteLLM, CrewAI, AutoGen, Semantic Kernel, Pydantic AI, MLflow, and others.

AgentPond's goal is selective Langfuse compatibility, not full Langfuse server parity. The explicit Langfuse attribute path stays deterministic, while the OpenInference and Vercel AI SDK mappers cover common raw OTEL cases.

## Impact

Raw framework OTEL spans may ingest as plain spans when no supported mapper applies. AgentPond will not normalize input/output, usage, or cost unless those fields are provided in the supported Langfuse-compatible shape. AgentPond also does not calculate cost from model pricing and token usage.

## Revisit

Revisit if AgentPond needs broader OpenLLMetry, OpenLIT, GenAI semantic-convention, Genkit, LiveKit, or model-pricing support without an intermediate Langfuse instrumentation layer.
