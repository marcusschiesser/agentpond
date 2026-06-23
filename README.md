<p align="center">
  <img src="https://raw.githubusercontent.com/marcusschiesser/agentpond/main/docs/assets/agentpond-logo-gpt-image.png" alt="AgentPond — private trace storage and local analytics for AI agents" width="720">
</p>

<p align="center">
  <strong>Store agent traces remotely. Analyze them locally. Keep control of the data.</strong>
</p>

AgentPond is a lightweight, self-hosted trace backend and CLI for AI agents. It accepts traces from Langfuse SDKs and OTLP, stores raw events in S3-compatible object storage, and syncs them into a local DuckDB cache for fast analysis.

It is designed for AI projects that want to:

- keep production traces and human annotations in their own infrastructure
- inspect traces through a CLI or SQL
- let coding agents analyze failures and propose regression tests
- avoid operating a full observability platform

AgentPond provides Langfuse-compatible ingestion endpoints, so supported Langfuse SDK integrations can send traces to AgentPond by changing their base URL and credentials.

> AgentPond is an alternative ingestion backend, not a replacement for the complete Langfuse product. It does not provide Langfuse's web UI, prompt management, datasets, or evaluation workflows.

## How it works

![AgentPond data flow from agent traces through object storage and local CLI analysis](./docs/assets/agentpond-how-it-works.png)

S3-compatible object storage is the source of truth. The local DuckDB database is a rebuildable cache optimized for fast analytical queries.

This gives you durable remote storage without requiring an always-on analytical database. Developers and coding agents can sync the latest production data, query it locally, identify recurring failures, and use those findings to improve the agent.

## Features

- Langfuse-compatible ingestion endpoints for SDK and OTLP traces
- S3-compatible raw event storage
- UTC bucket discovery and incremental synchronization
- Local DuckDB cache containing:
  - `events_raw`
  - `traces`
  - `observations`
  - `scores`
  - `sessions`
- CLI commands to create, list, and inspect traces, observations, sessions, and scores
- Human annotations represented as scores
- Custom SQL queries against synchronized trace data

## Intentional non-goals

AgentPond deliberately does not include:

- **A web UI:** developers and coding agents interact with the CLI and SQL
- **Always-on databases:** no Postgres, ClickHouse, or Redis
- **Background processing infrastructure:** no worker queues
- **Prompt or dataset management:** prompts, test cases, and generated evaluations can remain in your Git repository
- **Hosted trace storage:** you choose and control the object-storage infrastructure

A full observability platform is a better choice when you need shared dashboards, hosted evaluation workflows, or non-technical team access.

AgentPond is intended for projects whose main requirement is private, durable trace storage with programmable local analysis.

## Quick start

### Prerequisites

You need:

- Node.js and npm
- Docker with Docker Compose

Install the AgentPond CLI:

```sh
npm install -g agentpond
```

### Create and query a trace

Create a test trace directly through the CLI:

```sh
agentpond traces create \
  --name "checkout support answer" \
  --userId user_42 \
  --sessionId demo-session \
  --metadata '{"feature":"checkout","model":"gpt-5.5-mini"}' \
  --input '{"question":"Why was my card declined?"}' \
  --output '{"answer":"The bank declined the authorization. Please try another card or contact your bank."}'
```

Inspect the trace:

```sh
agentpond traces list
agentpond sql "select id, name, session_id from traces"
```

For the complete command reference, see [CLI usage](./docs/cli.md).

## Use AgentPond in your project

AgentPond implements Langfuse-compatible ingestion endpoints. To send traces to AgentPond, configure the environment variables `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY` printed by `agentpond dev`.

You can then use the normal Langfuse SDK integration for your language or framework.

See the [Langfuse SDK overview](https://langfuse.com/docs/observability/sdk/overview) for SDK installation and instrumentation instructions.

### Add coding agent

After sending traces to AgentPond, you need to give your coding agent the skill to access AgentPond:

```sh
npx skills add marcusschiesser/agentpond
```

This command installs a skill to use the AgentPond CLI, understand its DuckDB schema for advanced queries, and provides trace-analysis guidance to help improve your agents.

### Use your infrastructure

Deploy the ingestion service together with an S3-compatible store in your infrastructure. [docker-compose.yml](./docker-compose.yml) provides a template for local deployment.

For production deployments, replace all example credentials, use TLS, and give the ingestion service and CLI only the object-storage permissions they require.

> Coming soon: templates for your favorite Cloud provider: AWS, Google Cloud and Azure.

## Example projects

The repository contains scenario-based examples under [examples](./examples/README.md):

- [Basic traces](./examples/basic-traces/README.md): fixture-based Python and TypeScript examples that emit traces, observations, and annotation scores without calling an LLM.
- [LLM compliance workflow](./examples/llm-compliance/README.md): a Python `uv` example that calls OpenAI, parses a structured compliance score, and records the workflow in Langfuse.

Each scenario README includes prerequisites and run commands.


## Development

Install the workspace dependencies:

```sh
pnpm install
```

Run the CLI directly from the source tree:

```sh
pnpm cli --help
```
