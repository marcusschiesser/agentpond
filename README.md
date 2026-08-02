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

AgentPond is a lightweight trace backend and CLI for AI applications. It keeps raw traces in object storage you control and syncs them into a local DuckDB cache for fast analysis by your coding agent. It supports Node-compatible object and blob providers from [Files SDK](https://github.com/haydenbleasel/files-sdk) such as Amazon S3, Azure Blob Storage, Google Cloud Storage, R2, and MinIO; for platforms like Firebase, Supabase, and Vercel there are explicit one-command quick starts.

## How it works

![AgentPond data flow from agent traces through object storage and local CLI analysis](https://raw.githubusercontent.com/marcusschiesser/agentpond/main/docs/assets/agentpond-how-it-works.png)

Object storage is the durable source of truth. The local DuckDB database is a rebuildable analytical cache, so production traces stay in your infrastructure without requiring an always-on analytics database.

## Getting started

```sh
npx agentpond init
```

Run this from your application directory. It installs AgentPond's instrumentation
and analytics skills, and prints a setup prompt for your coding agent. The agent
then inspects your application, proposes the appropriate instrumentation and
storage setup, implements it after your confirmation, and verifies a real trace
end to end.

For setup options and platform-specific details, see the
[setup guide](./docs/getting-started/setup.md). See the
[CLI reference](./docs/cli.md) for all commands and options.

## Features

- Direct OpenTelemetry export through Files SDK, Firebase Storage, Supabase Storage, and Vercel Blob
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
- [Supabase setup](./docs/getting-started/supabase.md)
- [Vercel setup](./docs/getting-started/vercel.md)
- [Setup](./docs/getting-started/setup.md)
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
