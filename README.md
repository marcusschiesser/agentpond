# Aperto

Aperto is a small Langfuse-compatible ingestion and local analytics stack.

It accepts Langfuse SDK trace ingestion, stores accepted raw events in S3-compatible object storage, and syncs those events into a local DuckDB cache for SQL analytics.

## Scope

Included in v1:

- `POST /api/public/ingestion`
- `POST /api/public/otel/v1/traces`
- Trace, observation, generation, event, and score ingestion events
- OTel JSON/protobuf/gzip request handling
- S3-compatible raw event storage with manifest-based sync
- DuckDB tables/views: `events_raw`, `traces`, `observations`, `scores`, `sessions`
- CLI commands for sync, reads, score creation, and SQL

Not included:

- Web UI
- Postgres, ClickHouse, Redis, queues, or remote SQL
- Prompts, datasets, media, users, organizations, billing, integrations
- Eval workers or evaluator execution pipelines

## Configuration

The ingestion service and CLI read environment variables:

```sh
APERTO_PROJECT_ID=default-project
LANGFUSE_PUBLIC_KEY=pk-aperto
LANGFUSE_SECRET_KEY=sk-aperto
APERTO_S3_BUCKET=aperto
APERTO_S3_PREFIX=
APERTO_S3_ENDPOINT=http://localhost:9000
APERTO_S3_FORCE_PATH_STYLE=true
AWS_ACCESS_KEY_ID=minio
AWS_SECRET_ACCESS_KEY=minio123
AWS_REGION=us-east-1
APERTO_DB=~/.aperto/cache.duckdb
```

## Local Demo

Start MinIO and the ingestion service:

```sh
docker compose up --build
```

Point Langfuse SDKs at the ingestion service:

```sh
LANGFUSE_HOST=http://localhost:3000
LANGFUSE_PUBLIC_KEY=pk-aperto
LANGFUSE_SECRET_KEY=sk-aperto
```

Sync and query:

```sh
pnpm cli sync --s3-endpoint http://localhost:9000 --json
pnpm cli traces list --s3-endpoint http://localhost:9000 --json
pnpm cli sql "select id, name from traces" --json
```

## CLI

```sh
aperto sync
aperto traces list
aperto traces get <trace-id>
aperto observations list --trace-id <trace-id>
aperto sessions list
aperto sessions get <session-id>
aperto scores create --name quality --value 0.9 --trace-id <trace-id>
aperto scores list --trace-id <trace-id>
aperto scores list --observation-id <observation-id>
aperto sql "select * from traces limit 10"
```
