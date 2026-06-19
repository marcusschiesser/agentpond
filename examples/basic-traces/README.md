# Basic traces

These examples emit fixture-based traces through Langfuse SDKs. They do not call an LLM, so no model-provider API key is required.

Run commands in this README from the repository root.

Each example sends:

- one trace
- one generation observation with usage and cost data
- one human annotation score

## Prerequisites

Start AgentPond and load the local Langfuse-compatible credentials:

```sh
docker compose up --build
set -a
. ./.env.example
set +a
```

## Python

Run the Python example with `uv`:

```sh
uv run --project examples/basic-traces/python python examples/basic-traces/python/send_traces.py
```

## TypeScript

Run the TypeScript example:

```sh
pnpm --dir examples/basic-traces/typescript start
```

Each example prints the generated trace ID and corresponding `agentpond` commands for inspecting its trace, observations, and annotation score.
