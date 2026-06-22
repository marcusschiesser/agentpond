# AgentPond CLI

Use `npx agentpond` for AgentPond data access unless the user has installed the package globally.

## Configuration

AgentPond reads object storage and cache settings from environment variables:

```bash
export AGENTPOND_PROJECT_ID=default-project
export AGENTPOND_S3_BUCKET=agentpond
export AGENTPOND_S3_PREFIX=
export AGENTPOND_S3_ENDPOINT=http://localhost:9000
export AGENTPOND_S3_FORCE_PATH_STYLE=true
export AWS_ACCESS_KEY_ID=minio
export AWS_SECRET_ACCESS_KEY=minio123
export AWS_REGION=us-east-1
export AGENTPOND_DB=./.agentpond/cache.duckdb
```

If `AGENTPOND_DB` is not set, AgentPond stores its DuckDB cache at `./.agentpond/cache.duckdb` in the current working directory.

The CLI also accepts common settings as flags:

```bash
npx agentpond --env .env sync
npx agentpond --db ./.agentpond/cache.duckdb sync
npx agentpond --s3-bucket agentpond --s3-endpoint http://localhost:9000 sync
```

## Sync

Sync scans UTC object-storage buckets for OTEL trace payloads and non-OTEL score manifests, then projects new data into the local DuckDB cache:

```bash
npx agentpond sync
npx agentpond sync --json
```

Run sync before analysis when fresh data may exist in object storage.

## Traces

List and read traces:

```bash
npx agentpond traces list
npx agentpond traces list --limit 25
npx agentpond traces get <trace-id>
```

## Observations

List observations for a trace:

```bash
npx agentpond observations list --traceId <trace-id>
```

## Sessions

List and read sessions:

```bash
npx agentpond sessions list
npx agentpond sessions get <session-id>
```

## Scores

List scores (e.g. human annotations) for a trace or observation:

```bash
npx agentpond scores list --traceId <trace-id>
npx agentpond scores list --observationId <observation-id>
```

## SQL

Run SQL against the local DuckDB cache:

```bash
npx agentpond sql "select id, name, session_id from traces limit 10"
npx agentpond sql "select * from scores where trace_id = '<trace-id>'"
npx agentpond sql "select * from traces limit 10" --json
```
