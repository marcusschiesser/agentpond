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
- OpenTelemetry GenAI [`gen_ai.operation.name`](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/#gen-ai-operation-name) maps `chat`, `text_completion`, and `generate_content` to generations; `embeddings` to embeddings; `create_agent` and `invoke_agent` to agents; `execute_tool` to tools; `invoke_workflow` to chains; and `retrieval` to retrievers. AI SDK 7's `agent_step` extension maps to a chain. Historical `completion` and `generate` operation names remain supported for compatibility.
- Vercel AI SDK `operation.name` or `ai.operationId` maps tool calls to `tool-create`, and generation or embedding operations to their matching event types when model information is present.

When more than one convention is present, explicit Langfuse observation types take precedence, followed by OpenInference, OpenTelemetry GenAI, and Vercel AI SDK mappings. Unknown GenAI operation names remain plain spans. In particular, AI SDK's `rerank` remains a plain span pending a native AgentPond reranker type; a reranker is not classified as a retriever.

These mappings apply identically whether resource spans arrive through an OTLP ingestion endpoint or through `AgentPondSpanExporter` writing directly to object storage.

AI SDK 7 applications can use `@ai-sdk/otel` directly. Register its `OpenTelemetry` integration once during application instrumentation setup, then enable telemetry on the agent with a `functionId`. AgentPond recognizes the emitted agent, step, chat, tool, and embedding spans without a Langfuse translation layer.

For supported GenAI operations, AgentPond normalizes input and output messages, the actual response model (falling back to the requested model), input/output/total token usage, and tool arguments/results into canonical observation fields. AI SDK's supplemental embedding values and vectors are also supported. Explicit Langfuse fields still win field-by-field, and every original attribute remains available in observation metadata for lossless inspection.

AI SDK's `recordInputs` and `recordOutputs` options control whether content attributes are emitted. Disabling either option leaves that canonical field absent; AgentPond does not invent content. Raw metadata can contain prompts, model responses, and tool data when recording is enabled, so configure these privacy controls for the application's data-handling requirements.

## Rationale

Langfuse's full OTEL mapper tracks many evolving conventions: OpenInference, Vercel AI SDK, OpenLLMetry, OpenLIT, and framework-specific fields from LangChain, LlamaIndex, LiteLLM, CrewAI, AutoGen, Semantic Kernel, Pydantic AI, MLflow, and others.

AgentPond's goal is selective Langfuse compatibility, not full Langfuse server parity. The explicit Langfuse attribute path stays deterministic, while the OpenInference, OpenTelemetry GenAI, and Vercel AI SDK mappers cover common raw OTEL cases.

## Impact

Raw framework OTEL spans may ingest as plain spans when no supported mapper applies. AgentPond normalizes the documented fields for supported GenAI operations, but does not calculate cost from model pricing and token usage. Cache-read, cache-creation, and reasoning-token details remain in raw metadata.

## Revisit

Revisit if AgentPond needs broader OpenLLMetry, OpenLIT, Genkit, LiveKit, a native reranker observation type, or model-pricing support without an intermediate Langfuse instrumentation layer.
