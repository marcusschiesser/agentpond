# OpenInference integration

Use current official OpenInference documentation to select packages and initialization for the detected AI SDK or framework.

## Routing

1. Prefer a framework-native integration when it captures model, chain, and tool activity.
2. Otherwise select the provider-specific `@arizeai/openinference-*` instrumentor matching imports actually used by the server.
3. Do not add both framework and provider instrumentation when that would duplicate spans.
4. If no auto-instrumentor exists, retain normal OpenTelemetry tracing and add OpenInference semantic attributes to manual spans.

Common JavaScript surfaces include OpenAI, Anthropic, LangChain, Bedrock, Vercel AI SDK, MCP, and GenAI semantic-convention adapters. Verify the current package name and version before installation rather than guessing from this list.

## Initialization order

Set up the selected provider's AgentPond exporter and tracer provider, register instrumentations, and only then import or construct AI clients. Respect any framework-specific preload or bootstrap mechanism.

If the application already has a global provider, add the AgentPond exporter to it. Do not replace existing exporters unless the user explicitly asks.

Before enabling instrumentation, identify and configure the application's
content-capture policy. AgentPond exporters default to metadata-only tracing.
Prompts, responses, tool arguments, tool results, exception messages, and stack
traces may contain secrets or personal data and must not be stored without an
explicit opt-in that follows the application's existing configuration and
consent patterns.

## Manual spans

Use manual spans for custom application steps that auto-instrumentation cannot see:

- `CHAIN`: orchestration or agent-loop boundaries
- `TOOL`: each tool invocation, including input, output, and error status
- `AGENT`: a meaningful agent execution boundary when the framework does not emit one

Always set `openinference.span.kind`. Set `input.value`, `output.value`, their
MIME types, or provider-specific message/tool payload attributes only when the
approved content policy explicitly permits those fields. Metadata-only spans
should retain operational attributes such as model, token usage, status code,
duration, parent-child relationships, and session ID while omitting or
redacting content and provider error details.

## Sessions

Set `session.id` on the outer CHAIN or AGENT span. Generate it once at the conversation boundary and reuse it for every turn in that conversation. Auto-instrumented model and tool spans should be children of that outer span.

## Flush and verification

- Long-running servers: keep the provider alive and flush at supported lifecycle boundaries.
- Short-lived scripts and test commands: force-flush and shut down before process exit.
- Reusable Firebase, Supabase, or Vercel request handlers: do not shut down a module-level provider after every request.

Run a real application request and verify the resulting trace rather than treating compilation alone as success. Confirm span kinds, inputs/outputs, parent-child relationships, tool results, and session grouping.

Read back the raw stored object as part of verification. Under the default
metadata-only policy:

- `input.value` and `output.value` must be `__REDACTED__` when present.
- `input.attributes` and `output.attributes` must be empty or absent.
- Provider message, completion, tool payload, exception message, and stack
  fields must be absent or redacted.
- Searching the serialized object for the representative prompt, response,
  tool payload, and provider error text must return no matches.

Do not treat a redacted projected trace as sufficient evidence when the raw
object still contains recoverable content.
