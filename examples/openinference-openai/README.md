# OpenInference OpenAI traces

These examples make one OpenAI chat completion call with OpenInference OpenAI instrumentation and export the resulting OpenTelemetry trace to AgentPond.

Run commands in this README from the repository root.

## Prerequisites

Start AgentPond in one terminal:

```sh
agentpond dev
```

Load the local OpenTelemetry exporter environment in a second terminal that will run the examples:

```sh
eval "$(agentpond env get dev --otel)"
```

If `agentpond dev` falls back to another port because `4318` is already in use, `agentpond env get dev --otel` automatically returns the running server URL for this AgentPond directory.

Set your OpenAI API key:

```sh
export OPENAI_API_KEY=...
```

## Python

Run the Python example with `uv`:

```sh
uv run --project examples/openinference-openai/python python examples/openinference-openai/python/send_trace.py
```

## TypeScript

Run the TypeScript example:

```sh
pnpm --dir examples/openinference-openai/typescript start
```

## Inspect traces

Each example prints the model response and commands for inspecting the latest trace:

```sh
agentpond traces list --limit 1
agentpond observations list --traceId <trace-id>
```

Use the trace id returned by `agentpond traces list --limit 1` in the observations command.
