<p align="center">
  <img src="https://raw.githubusercontent.com/marcusschiesser/agentpond/main/docs/assets/agentpond-logo-gpt-image.png" alt="AgentPond — private trace storage and local analytics for AI agents" width="720">
</p>

<p align="center">
  <strong>Store agent traces remotely. Analyze them locally. Keep control of the data.</strong>
</p>

<p align="center">
  <a href="https://github.com/marcusschiesser/agentpond/actions/workflows/ci.yml"><img src="https://github.com/marcusschiesser/agentpond/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://www.npmjs.com/package/agentpond"><img src="https://img.shields.io/npm/v/agentpond.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/agentpond"><img src="https://img.shields.io/npm/dm/agentpond.svg" alt="npm downloads"></a>
  <a href="https://github.com/marcusschiesser/agentpond/blob/main/LICENSE"><img src="https://img.shields.io/github/license/marcusschiesser/agentpond.svg" alt="MIT license"></a>
  <a href="https://www.npmjs.com/package/agentpond"><img src="https://img.shields.io/node/v/agentpond.svg" alt="Node.js version"></a>
</p>

AgentPond is a lightweight, self-hosted trace backend and CLI for AI agents. It accepts traces from Langfuse SDKs and OTLP, stores raw events in a cloud object storage, and syncs them into a local DuckDB cache for fast analysis.

It is designed for AI projects that want to:

- keep production traces and human annotations in their own infrastructure
- inspect traces through a CLI or SQL
- let coding agents analyze failures and propose regression tests
- avoid operating a full observability platform

AgentPond provides Langfuse-compatible ingestion endpoints, so supported Langfuse SDK integrations can send traces to AgentPond by changing their base URL and credentials.

> AgentPond is an alternative ingestion backend, not a replacement for the complete Langfuse product. It does not provide Langfuse's web UI, prompt management, datasets, or evaluation workflows.

## How it works

![AgentPond data flow from agent traces through object storage and local CLI analysis](https://raw.githubusercontent.com/marcusschiesser/agentpond/main/docs/assets/agentpond-how-it-works.png)

The object storage is the source of truth. The local DuckDB database is a rebuildable cache optimized for fast analytical queries.

This gives you durable remote storage without requiring an always-on analytical database. Developers and coding agents can sync the latest production data, query it locally, identify recurring failures, and use those findings to improve the agent.

## Features

- Langfuse-compatible ingestion endpoints for SDK and OTLP traces
- Use AWS S3, Google Cloud Storage, Vercel Blob or local filesystem as raw event storage
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

## Example projects

The repository contains scenario-based examples under [examples](./examples/README.md):

- [Basic traces](./examples/basic-traces/README.md): fixture-based Python and TypeScript examples that emit traces, observations, and annotation scores without calling an LLM.
- [Hugging Face Space](./examples/huggingface-space/README.md): deploy AgentPond ingestion to a Docker Space and store traces in a Hugging Face Storage Bucket.
- [LLM compliance workflow](./examples/llm-compliance/README.md): a Python `uv` example that calls OpenAI, parses a structured compliance score, and records the workflow in Langfuse.
- [OpenInference OpenAI traces](./examples/openinference-openai/README.md): minimal Python and TypeScript examples that call OpenAI once and export OpenInference traces to AgentPond.

Each scenario README includes prerequisites and run commands.

## Use AgentPond in your project

To use AgentPond in your project, your app sends traces to an AgentPond server, and your coding agent uses the AgentPond CLI to analyze those traces.

### Sending traces

AgentPond accepts Langfuse-compatible ingestion and standard OpenTelemetry Protocol (OTLP) traces.

To send traces from your app, use one of these instrumentation paths:

- the [Langfuse SDK](https://langfuse.com/docs/observability/sdk/overview) integration for your language or framework
- the [OpenInference SDK](https://github.com/Arize-ai/openinference) with an OpenTelemetry OTLP exporter

Install the matching instrumentation skill so your coding agent can add the SDK to your app:

```sh
npx skills add https://github.com/langfuse/skills --skill langfuse-observability
```

```sh
npx skills add https://github.com/arize-ai/arize-skills --skill arize-instrumentation
```

For complete examples, see the [LLM compliance workflow](./examples/llm-compliance/README.md) for Langfuse SDK instrumentation and the [OpenInference OpenAI traces](./examples/openinference-openai/README.md) example for OpenInference instrumentation.

### Storing traces

AgentPond provides a local ingestion server, so you can receive traces for your development environment. To start it, just call:

```sh
agentpond dev
```

Then, start a second terminal and load the environment values your app needs to send traces to AgentPond:

```sh
eval "$(agentpond env get dev)"
```

Finally, run your development server as usual.

### Analyzing traces

After your app emits traces, inspect them with your coding agent.
Add this skill so it can query trace data, inspect failures, and propose evals and regression tests:

```sh
npx skills add marcusschiesser/agentpond
```

Then ask your coding agent to start an analysis like this:

```text
Analyze why the last agent run for user 32423 did not return a result
```

### Environments

AgentPond keeps data separated by your deployment environment (e.g. dev, staging, prod).

For staging and production services, deploy the AgentPond ingestion service together with an object store in your infrastructure. Docker images are published to `ghcr.io/marcusschiesser/agentpond`, and [docker-compose.yml](./docker-compose.yml) provides a template that you can run locally with `docker compose up`. See [Deployment](./docs/deployment.md) for real AWS, Google Cloud, Vercel Blob, and other infrastructure options.

To point AgentPond to this service, call the `env init` command in your project:

```sh
agentpond env init <env-name>
```

The command prompts for an object store (S3, GCS, Vercel Blob, or local filesystem) in an interactive terminal.

Using `staging` for `env-name`, this generates a `.agentpond/envs/staging.env` file that you need to update with the ingestion and object-store settings for your deployed AgentPond services.

Then you can call:

```sh
agentpond env use staging
```

After that, `agentpond` queries traces from the selected staging environment by default.


## Development

Install the workspace dependencies:

```sh
pnpm install
```

Run the CLI directly from the source tree:

```sh
pnpm cli --help
```
