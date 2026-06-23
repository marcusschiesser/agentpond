---
name: agentpond
description: Work with AgentPond trace analytics. Use when needing to inspect traces, observations, sessions, or scores (e.g. annotations), run local SQL analysis, or configure Langfuse-compatible SDK ingestion into AgentPond.
allowed-tools:
  - Bash(npx agentpond --help *)
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

AgentPond is a data pond for AI agent traces with an agent-native CLI for local analytics. It accepts Langfuse-compatible ingestion, stores accepted events in S3-compatible object storage, and syncs those events into a local DuckDB cache for inspection.

## Core Principles

Follow these principles for AgentPond work:

1. **Sync before analysis**: Run `npx agentpond sync` before querying recent production data unless the user is intentionally inspecting an existing local cache.
2. **Use supported CLI commands**: AgentPond exposes focused trace analytics commands and local SQL. 
3. **Use DuckDB for deeper analysis**: Prefer `npx agentpond sql "..."` when a question requires joins, aggregation, time filtering, raw event inspection, or cost analysis.
4. **Keep credentials out of chat**: Ask the user to set environment variables or an `.env` file instead of pasting secrets into the conversation.

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

Configure the CLI with environment variables or an env file:

```bash
export AGENTPOND_S3_ENDPOINT=http://localhost:9000
export AGENTPOND_S3_BUCKET=agentpond
export AWS_ACCESS_KEY_ID=minio
export AWS_SECRET_ACCESS_KEY=minio123
```

For a named environment setup:

```bash
npx agentpond --env production sync
```

Common inspection flow:

```bash
npx agentpond sync
npx agentpond traces list --limit 25
npx agentpond traces get <trace-id>
npx agentpond observations list --traceId <trace-id>
npx agentpond scores list --traceId <trace-id>
```

Run SQL against the local DuckDB cache:

```bash
npx agentpond sql "select id, name, session_id, total_cost from traces order by start_time desc limit 10"
```

## Langfuse-Compatible Ingestion

AgentPond ingestion uses Langfuse-compatible endpoints. Applications can use normal Langfuse SDK configuration while pointing at an AgentPond ingestion service:

```bash
export LANGFUSE_BASE_URL=http://127.0.0.1:4318
export LANGFUSE_PUBLIC_KEY=pk-agentpond-dev
export LANGFUSE_SECRET_KEY=sk-agentpond-dev
```

These variables configure SDK ingestion. They are not credentials for using the AgentPond CLI to query Langfuse Cloud. The AgentPond CLI reads from object storage and the local DuckDB cache.
