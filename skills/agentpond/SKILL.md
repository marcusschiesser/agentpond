---
name: agentpond
description: Work with AgentPond trace analytics. Use when needing to inspect traces, observations, sessions, or scores (e.g. annotations), run local SQL analysis, switch AgentPond environments, start the local dev ingestion server, or configure Langfuse-compatible SDK ingestion into AgentPond.
allowed-tools:
  - Bash(npx agentpond --help *)
  - Bash(npx agentpond dev *)
  - Bash(npx agentpond env current *)
  - Bash(npx agentpond env get *)
  - Bash(npx agentpond env init *)
  - Bash(npx agentpond env list *)
  - Bash(npx agentpond env use *)
  - Bash(npx agentpond sync *)
  - Bash(npx agentpond traces create *)
  - Bash(npx agentpond traces list *)
  - Bash(npx agentpond traces get *)
  - Bash(npx agentpond observations list *)
  - Bash(npx agentpond sessions list *)
  - Bash(npx agentpond sessions get *)
  - Bash(npx agentpond scores create *)
  - Bash(npx agentpond scores list *)
  - Bash(npx agentpond sql *)
---

# AgentPond

AgentPond is a data pond for AI agent traces with an agent-native CLI for local analytics. It accepts Langfuse-compatible ingestion, stores staging/production events in local, S3-compatible, or Google Cloud Storage object storage, and uses a local DuckDB cache for inspection. The dev server writes directly to the dev DuckDB cache.

## Core Principles

Follow these principles for AgentPond work:

1. **Default to dev**: If the user does not mention an environment, assume `dev`.
2. **Select environments explicitly**: Use `npx agentpond env use <env>` to switch the selected environment, or add `--env <env>` for a single command.
3. **Sync only when needed**: Run `npx agentpond sync` before querying recent staging/production object-storage data. Do not sync dev; `agentpond dev` writes directly to the dev DuckDB cache.
4. **Use supported CLI commands**: AgentPond exposes focused trace analytics commands and local SQL.
5. **Use DuckDB for deeper analysis**: Prefer `npx agentpond sql "..."` when a question requires joins, aggregation, time filtering, raw event inspection, or cost analysis.
6. **Keep credentials out of chat**: Ask the user to set environment variables or an `.env` file instead of pasting secrets into the conversation.

## Use Case References

- CLI usage and configuration: [references/cli.md](references/cli.md)
- DuckDB tables and SQL examples: [references/duckdb-schema.md](references/duckdb-schema.md)
- Langfuse SDK ingestion into AgentPond: [references/instrumentation.md](references/instrumentation.md)
- Trace investigation and error analysis: [references/error-analysis.md](references/error-analysis.md)

## AgentPond CLI

Run AgentPond through `npx` unless the user has installed it globally:

```bash
npx agentpond --help
```

Use AgentPond environments to separate dev, staging, and production caches and configuration:

```bash
npx agentpond env current
npx agentpond env list
npx agentpond env use dev
```

When the user names an environment, use it explicitly:

```bash
npx agentpond env use staging
npx agentpond --env production sync
```

If the user asks to set up an environment, initialize its dotenv file:

```bash
npx agentpond env init staging
```

In an interactive terminal, choose the requested object store when prompted. In scripts or non-interactive terminals, pass it explicitly:

```bash
npx agentpond env init staging --store s3
npx agentpond env init staging --store gcs
npx agentpond env init staging --store local
```

Then tell the user to edit `.agentpond/envs/staging.env` with SDK and object-store settings. GCS environments use Google Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`. Do not ask users to paste secrets into chat.

Common inspection flow for `dev`:

```bash
npx agentpond traces list --limit 25
npx agentpond traces get <trace-id>
npx agentpond observations list --traceId <trace-id>
npx agentpond scores list --traceId <trace-id>
```

For staging or production, sync before inspection:

```bash
npx agentpond --env production sync
npx agentpond --env production traces list --limit 25
```

Run SQL against the local DuckDB cache:

```bash
npx agentpond sql "select id, name, session_id, total_cost from traces order by start_time desc limit 10"
```

## Langfuse-Compatible Ingestion

For local development, start the dev ingestion server:

```bash
npx agentpond dev
```

This selects the `dev` environment and writes directly to `.agentpond/envs/dev/cache.duckdb`. Keep the process running while SDKs send traces.

To configure an app to send traces to the dev server, use:

```bash
eval "$(npx agentpond env get dev)"
```

If the user asks for the env values without running `eval`, use:

```bash
npx agentpond env get dev
```

AgentPond ingestion uses Langfuse-compatible endpoints. Applications can use normal Langfuse SDK configuration while pointing at an AgentPond ingestion service:

```bash
export LANGFUSE_BASE_URL=http://127.0.0.1:4318
export LANGFUSE_PUBLIC_KEY=pk-agentpond-dev
export LANGFUSE_SECRET_KEY=sk-agentpond-dev
```

These variables configure SDK ingestion. They are not credentials for using the AgentPond CLI to query Langfuse Cloud. The AgentPond CLI reads from object storage and the local DuckDB cache.

For serverless deployments, AWS infrastructure can use `lambdaIngestHandler` from `@agentpond/aws`, and Google infrastructure can use `httpIngestFunction` or `createHttpIngestFunction` from `@agentpond/google`. Firebase Functions should use `createHttpIngestFunction` with `pathPrefix` to strip Firebase function URL prefixes. These handlers expose the same Langfuse-compatible ingestion endpoints and write to the configured object store.
