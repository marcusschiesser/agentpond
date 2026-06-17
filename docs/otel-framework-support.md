# OTEL Framework Support

## Status

Accepted.

## Decision

AgentPond only treats OTEL spans as first-class Langfuse observations when they use the explicit Langfuse attribute shape, for example:

- `langfuse.observation.type`
- `langfuse.observation.usage_details`
- `langfuse.observation.cost_details`
- `langfuse.observation.model.name`
- `langfuse.trace.*`

Do not implement broad framework-specific OTEL inference for now. In particular, AgentPond does not infer `generation-create` from `gen_ai.*`, `openinference.*`, model attributes, or raw Vercel AI SDK `ai.*` spans. Without `langfuse.observation.type = generation`, these spans default to `span-create`.

For Vercel AI SDK, prefer the Langfuse SDK integration path: enable AI SDK telemetry and use `@langfuse/otel` / `@langfuse/tracing` to emit Langfuse-compatible telemetry where possible.

## Rationale

Langfuse's full OTEL mapper tracks many evolving conventions: GenAI semantic conventions, OpenInference, Vercel AI SDK, OpenLLMetry, OpenLIT, and framework-specific fields from LangChain, LlamaIndex, LiteLLM, CrewAI, AutoGen, Semantic Kernel, Pydantic AI, MLflow, and others.

AgentPond's goal is selective Langfuse compatibility, not full Langfuse server parity. The explicit Langfuse attribute path is smaller, deterministic, and covers direct SDK use cases.

## Impact

Raw framework OTEL spans may ingest as plain spans, but AgentPond will not normalize generation type, model, input/output, usage, or cost unless those fields are provided in the supported Langfuse-compatible shape. AgentPond also does not calculate cost from model pricing and token usage.

## Revisit

Revisit if AgentPond needs first-class raw Vercel AI SDK, OpenLLMetry, OpenLIT, OpenInference, or GenAI semantic-convention support without an intermediate Langfuse instrumentation layer.
