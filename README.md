<p align="center">
  <img src="https://raw.githubusercontent.com/marcusschiesser/agentpond/main/docs/assets/agentpond-logo-gpt-image.png" alt="AgentPond - trace analytics for AI agents" width="720">
</p>

AgentPond is a data pond for AI agent traces and human annotations with a agent-native CLI for local analytics. It accepts Langfuse SDK ingestion and its using the same data format, so you can use it as a drop-in replacement.

It is for AI projects that want to privately store valuable traces, analyze them automatically with a coding agent, and avoid operating a Kubernetes cluster or sending trace data to a public cloud. You just need a S3-compatible object storage with a serverless ingestion service.

Events from the object storage are synced into a local DuckDB cache for fast analytical queries of your production agent data. Coding agents use these queries to generate regression tests and improvements of your agents.

## Scope

AgentPond focuses on collecting and analysing agent traces:

- Langfuse-compatible ingestion endpoints for SDK traces and OTLP traces
- S3-compatible raw event storage with manifest-based discovery
- Local DuckDB cache with `events_raw`, `traces`, `observations`, `scores`, and `sessions`
- CLI commands to create list/read traces, observations, scores, and to run custom SQL

Compared to Langfuse there's no: 
- Web UI: Your coding agent talks directly to the CLI
- Postgres, ClickHouse, Redis or background queues: Simplified infrastructure by just using S3 with one ingestion service
- Prompts, datasets, evals: Let your coding agent generate and store them in GitHub

## Getting Started 

### Prerequisites

Install the AgentPond CLI from npm:

```sh
npm install -g agentpond
```

Start MinIO (S3-compatible storage) and the ingestion service:

```sh
docker compose up --build
```

### Test the CLI

Configure the CLI for the local MinIO endpoint:

```sh
export AGENTPOND_S3_ENDPOINT=http://localhost:9000
export AGENTPOND_S3_BUCKET=agentpond
export AWS_ACCESS_KEY_ID=minio
export AWS_SECRET_ACCESS_KEY=minio123
```

> Note: The CLI is directly accessing the remote object storage

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

Sync S3 data into DuckDB and query it:

```sh
agentpond sync
agentpond traces list
agentpond sql "select id, name, session_id from traces"
```

For the full command reference, see [CLI usage](./docs/cli.md).

### Test Ingestion

AgentPond's ingestion service is using the same API as Langfuse. To point a Langfuse SDK to the AgentPond service started in the prerequisites, set these environment variables:

```sh
export LANGFUSE_BASE_URL=http://localhost:3030
export LANGFUSE_PUBLIC_KEY=pk-agentpond
export LANGFUSE_SECRET_KEY=sk-agentpond
```

Then you can use the normal Langfuse SDK setup for your language and framework. 

We provide matching Python and TypeScript examples using the Langfuse SDK. Both send one realistic trace with generation cost details and one human annotation score. To keep dependencies simple, the examples do not call an LLM; they directly call the Langfuse SDK with fixture inputs, outputs, usage, and cost data. To run the Python example with `uv`:

```sh
uv run --project examples/python python examples/python/send_traces.py
```

Run the TypeScript SDK example:

```sh
pnpm --dir examples/typescript start
```

Each example prints the trace ID it created and the `agentpond` commands to inspect trace, observations, and human annotation score. Call them to analyze the generated trace.

To add AgentPond to your own project, add the latest Langfuse SDK, the docs are here:

- [Langfuse SDK overview](https://langfuse.com/docs/observability/sdk/overview)

Make sure to set the `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` variables in your project to point to a deployment of the [ingestion containers](./docker-compose.yml) in your own infrastructure.

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

## Development

Install workspace dependencies once before running tests, examples, or local development commands:

```sh
pnpm i
```

Instead of `agentpond`, run the CLI from source code:

```sh
pnpm cli --help
```
