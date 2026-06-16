# AgentPond

AgentPond is a data pond for AI agent traces with a agent-native CLI for local analytics. It accepts Langfuse SDK ingestion and its using the same data format, so you can use it as a drop-in replacement.

It is for AI projects that want to privately store valuable traces, analyze them automatically with a coding agent, and avoid operating a Kubernetes cluster or sending trace data to a public cloud. You just need a S3-compatible object storage with a serverless ingestion service.

Raw events from the object storage are synced into a local DuckDB cache for fast, agent-native queries.

## Scope

AgentPond focuses on collecting and analysing agent traces:

- Langfuse-compatible ingestion endpoints for SDK traces and OTLP traces
- S3-compatible raw event storage with manifest-based discovery
- Local DuckDB cache with `events_raw`, `traces`, `observations`, `scores`, and `sessions`
- CLI commands to create list/read traces, observations, scores, and to run custom SQL

Compared to Langfuse there's no: 
- Web UI: Your coding agent talks directly to the CLI
- Postgres, ClickHouse, Redis or background queues: Simplified infrastructure by just using S3 with ingestion service
- Prompts, datasets, evals: Let your coding agent generate and store them in GitHub

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

We provide matching Python and TypeScript examples using the Langfuse SDK. Both send one realistic trace with generation cost details and one human annotation score. To keep dependencies simple, the examples do not call an LLM; they directly call the Langfuse SDK with fixture inputs, outputs, usage, and cost data. To run the Python example with `uv`:

```sh
uv run --project examples/python python examples/python/send_traces.py
```

Run the TypeScript SDK example:

```sh
pnpm --dir examples/typescript start
```

Each example prints the trace ID it created and the `pnpm cli` commands to inspect trace cost, observations, and scores. After your app sends traces, run:

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
