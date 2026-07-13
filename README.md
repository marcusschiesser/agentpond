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

AgentPond is a lightweight trace backend and CLI for AI applications. It keeps raw traces in object storage you control and syncs them into a local DuckDB cache for fast analysis by developers and coding agents. Use it with Firebase Storage, Amazon S3, Google Cloud Storage, Vercel Blob, or custom infrastructure. Firebase and Vercel include automated setup; other deployments use the manual setup path.

## How it works

![AgentPond data flow from agent traces through object storage and local CLI analysis](https://raw.githubusercontent.com/marcusschiesser/agentpond/main/docs/assets/agentpond-how-it-works.png)

Object storage is the durable source of truth. The local DuckDB database is a rebuildable analytical cache, so production traces stay in your infrastructure without requiring an always-on analytics database.

## Getting started

Start with the [Manual deployment setup](./docs/getting-started/manual-setup.md) to choose a write path, configure object storage, instrument the application, and sync its traces into AgentPond.

For Firebase and Vercel, AgentPond also provides automated quick starts:

- [Firebase quick start](./docs/getting-started/firebase.md)
- [Vercel quick start](./docs/getting-started/vercel.md)

Both require Node.js 22 or newer. From the Firebase or Vercel project, run:

```sh
npx agentpond init
```

The command detects the platform, installs AgentPond's instrumentation and analytics skills, and prints a prompt for your coding agent. The agent inspects the trusted Node.js application, proposes the provider-specific setup, implements it after confirmation, and verifies a real trace.

Once the application has emitted a trace:

```sh
npx agentpond sync
npx agentpond traces list --limit 10
```

## Analyze traces

Use focused commands for individual traces and sessions:

```sh
npx agentpond traces get <trace-id>
npx agentpond observations list --traceId <trace-id>
npx agentpond sessions get <session-id>
npx agentpond scores list --traceId <trace-id>
```

Use DuckDB SQL for aggregation, joins, time windows, or cost analysis:

```sh
npx agentpond sql "select id, name, session_id, total_cost from traces order by start_time desc limit 10"
```

## Features

- Direct OpenTelemetry export to Firebase Storage, S3, GCS, and Vercel Blob
- Langfuse-compatible and OTLP HTTP ingestion adapters
- Incremental object-store synchronization
- Local DuckDB projections for traces, observations, sessions, and scores
- Focused CLI commands plus arbitrary SQL
- Human annotations represented as scores
- Agent skills for instrumentation and trace investigation

## Intentional non-goals

AgentPond does not provide a web UI, hosted trace storage, prompt management, datasets, or always-on Postgres, ClickHouse, Redis, and worker infrastructure. Use a full observability platform when shared dashboards or non-technical workflows are required.

## Documentation

- [Firebase setup](./docs/getting-started/firebase.md)
- [Vercel setup](./docs/getting-started/vercel.md)
- [Manual deployment setup](./docs/getting-started/manual-setup.md)
- [CLI reference](./docs/cli.md)
- [Deployment reference](./docs/deployment.md)
- [Direct object-store export](./docs/direct-object-store-export.md)
- [Examples](./examples/README.md)

## Development

```sh
pnpm install
pnpm cli --help
pnpm test
```
