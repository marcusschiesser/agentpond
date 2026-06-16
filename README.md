# AgentPond

AgentPond is a small Langfuse-compatible trace store with local DuckDB analytics.

It is for projects that want to store valuable traces, analyze them from a CLI either manually or automatically with a coding agent, and avoid operating a Kubernetes cluster or sending trace data to a public cloud.

AgentPond accepts Langfuse SDK ingestion, writes raw accepted events to S3-compatible object storage, and syncs those events into a local DuckDB cache for SQL queries.

## Scope

AgentPond v1 focuses on the trace analytics path:

- Langfuse-compatible ingestion endpoints for SDK traces and OTLP traces
- S3-compatible raw event storage with manifest-based discovery
- Local DuckDB cache with `events_raw`, `traces`, `observations`, `scores`, and `sessions`
- CLI commands to create test traces, sync, list/read resources, create scores, and run SQL

Not included: web UI, Postgres, ClickHouse, Redis, background queues, prompts, datasets, media, users, organizations, billing, integrations, or eval workers.

## Local Demo

Install workspace dependencies once before running local CLI commands, tests, or examples:

```sh
pnpm i
```

Start MinIO and the ingestion service:

```sh
docker compose up --build
```

Configure the CLI for the local MinIO endpoint:

```sh
export AGENTPOND_S3_ENDPOINT=http://localhost:9000
export AGENTPOND_S3_BUCKET=agentpond
export AWS_ACCESS_KEY_ID=minio
export AWS_SECRET_ACCESS_KEY=minio123
```

Create a test trace directly through the CLI:

```sh
pnpm cli traces create \
  --id trace-demo-checkout-001 \
  --name "checkout support answer" \
  --userId user_42 \
  --sessionId demo-session \
  --metadata '{"env":"local","feature":"checkout","model":"gpt-5.5-mini"}' \
  --input '{"question":"Why was my card declined?","locale":"en-US"}' \
  --output '{"answer":"The bank declined the authorization. Please try another card or contact your bank.","confidence":0.92}'
```

Sync S3 data into DuckDB and query it:

```sh
pnpm cli sync
pnpm cli traces list
pnpm cli sql "select id, name, session_id from traces"
```

## Real Ingestion

Point a Langfuse SDK at the AgentPond ingestion service:

```sh
export LANGFUSE_BASE_URL=http://localhost:3030
export LANGFUSE_PUBLIC_KEY=pk-agentpond
export LANGFUSE_SECRET_KEY=sk-agentpond
```

Use the normal Langfuse SDK setup for your language and framework. The latest Langfuse docs are here:

- [Langfuse SDK overview](https://langfuse.com/docs/observability/sdk/overview)

We provide matching Python and TypeScript examples using the Langfuse SDK. Both send the same two realistic traces and add one human annotation score. To run the Python example with `uv`:

```sh
uv run --project examples/python python examples/python/send_traces.py
```

Run the TypeScript SDK example:

```sh
pnpm --dir examples/typescript start
```

Each example prints the trace IDs it created and the `pnpm cli` commands to inspect observations and scores for one trace. After your app sends traces, run:

```sh
pnpm cli sync
pnpm cli traces list
```

## CLI

```sh
agentpond sync
agentpond traces create --name "manual trace" --userId user_42 --sessionId session_42
agentpond traces list
agentpond traces get <trace-id>
agentpond observations list --traceId <trace-id>
agentpond sessions list
agentpond sessions get <session-id>
agentpond scores create --name quality --value 0.9 --traceId <trace-id>
agentpond scores list --traceId <trace-id>
agentpond scores list --observationId <observation-id>
agentpond sql "select * from traces limit 10"
```

## Configuration

The ingestion service and CLI read environment variables:

```sh
AGENTPOND_PROJECT_ID=default-project
LANGFUSE_PUBLIC_KEY=pk-agentpond
LANGFUSE_SECRET_KEY=sk-agentpond
AGENTPOND_S3_BUCKET=agentpond
AGENTPOND_S3_PREFIX=
AGENTPOND_S3_ENDPOINT=http://localhost:9000
AGENTPOND_S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=minio
AWS_SECRET_ACCESS_KEY=minio123
AWS_REGION=us-east-1 # optional, defaults to us-east-1
AGENTPOND_DB=~/.agentpond/cache.duckdb
```

If `--s3-endpoint` and `AGENTPOND_S3_ENDPOINT` are both omitted, AgentPond uses the default AWS S3 endpoint for `AWS_REGION`. For local MinIO, set `AGENTPOND_S3_ENDPOINT` or pass `--s3-endpoint`.
