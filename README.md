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
- Manifest-based discovery and incremental synchronization
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

Start the local MinIO object store and AgentPond ingestion service:

```sh
docker compose up --build
```

### Configure the CLI

Configure AgentPond to use the local MinIO instance:

```sh
export AGENTPOND_S3_ENDPOINT=http://localhost:9000
export AGENTPOND_S3_BUCKET=agentpond
export AWS_ACCESS_KEY_ID=minio
export AWS_SECRET_ACCESS_KEY=minio123
```

> The CLI accesses S3-compatible object storage directly. The credentials above are for local development only.

### Create and query a trace

Create a test trace directly through the CLI:

```sh
agentpond traces create \
  --name "checkout support answer" \
  --userId user_42 \
  --sessionId demo-session \
  --metadata '{"env":"local","feature":"checkout","model":"gpt-5.5-mini"}' \
  --input '{"question":"Why was my card declined?"}' \
  --output '{"answer":"The bank declined the authorization. Please try another card or contact your bank."}'
```

Synchronize the stored events into the local DuckDB cache:

```sh
agentpond sync
```

Inspect the synchronized data:

```sh
agentpond traces list
agentpond sql "select id, name, session_id from traces"
```

For the complete command reference, see [CLI usage](./docs/cli.md).

## Send traces from a Langfuse SDK

AgentPond implements Langfuse-compatible ingestion endpoints. To send traces to the local service, configure your Langfuse SDK with:

```sh
export LANGFUSE_BASE_URL=http://localhost:3030
export LANGFUSE_PUBLIC_KEY=pk-agentpond
export LANGFUSE_SECRET_KEY=sk-agentpond
```

You can then use the normal Langfuse SDK integration for your language or framework.

See the [Langfuse SDK overview](https://langfuse.com/docs/observability/sdk/overview) for SDK installation and instrumentation instructions.

### Example projects

The repository contains matching Python and TypeScript examples. Each example emits:

- one trace
- one generation observation with usage and cost data
- one human annotation score

The examples use fixture data and do not call an LLM, so no model-provider API key is required.

Run the Python example with `uv`:

```sh
uv run --project examples/python python examples/python/send_traces.py
```

Run the TypeScript example:

```sh
pnpm --dir examples/typescript start
```

Each example prints the generated trace ID and the corresponding `agentpond` commands for inspecting its trace, observations, and annotation score.

## Use AgentPond in your project

Install the latest Langfuse SDK for your language and configure it to point to your AgentPond deployment:

```sh
export LANGFUSE_BASE_URL=https://your-agentpond-ingestion.example.com
export LANGFUSE_PUBLIC_KEY=your-public-key
export LANGFUSE_SECRET_KEY=your-secret-key
```

Deploy the [ingestion service](./docker-compose.yml) in your infrastructure and configure it to use your S3-compatible object store.

For production deployments, replace all example credentials, use TLS, and give the ingestion service and CLI only the object-storage permissions they require.

## Configuration

The ingestion service and CLI use the following environment variables:

```sh
# Project
AGENTPOND_PROJECT_ID=default-project

# Ingestion authentication
LANGFUSE_PUBLIC_KEY=pk-agentpond
LANGFUSE_SECRET_KEY=sk-agentpond

# Object storage
AGENTPOND_S3_BUCKET=agentpond
AGENTPOND_S3_PREFIX=
AGENTPOND_S3_ENDPOINT=http://localhost:9000
AGENTPOND_S3_FORCE_PATH_STYLE=true

# AWS or S3-compatible credentials
AWS_ACCESS_KEY_ID=minio
AWS_SECRET_ACCESS_KEY=minio123
AWS_REGION=us-east-1

# Local analytical cache
AGENTPOND_DB=~/.agentpond/cache.duckdb
```

`AWS_REGION` defaults to `us-east-1`.

When `--s3-endpoint` and `AGENTPOND_S3_ENDPOINT` are both omitted, AgentPond uses the standard AWS S3 endpoint for the configured region.

For local MinIO or another S3-compatible service, set `AGENTPOND_S3_ENDPOINT` or pass `--s3-endpoint` to the CLI.

## Development

Install the workspace dependencies:

```sh
pnpm install
```

Run the CLI directly from the source tree:

```sh
pnpm cli --help
```
