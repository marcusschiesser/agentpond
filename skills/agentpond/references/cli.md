# AgentPond CLI

Use `npx agentpond` for AgentPond data access unless the user has installed the package globally.

## Configuration

AgentPond reads object storage settings from the selected environment file under `.agentpond/envs/<name>.env`, then process environment variables, then flags. Environments can use `local`, `s3`, or `gcs` storage:

```bash
export AGENTPOND_PROJECT_ID=default-project
export AGENTPOND_PREFIX=
export AGENTPOND_STORE=s3
export AGENTPOND_S3_BUCKET=agentpond
export AGENTPOND_S3_ENDPOINT=http://localhost:9000
export AGENTPOND_S3_FORCE_PATH_STYLE=true
export AWS_ACCESS_KEY_ID=minio
export AWS_SECRET_ACCESS_KEY=minio123
export AWS_REGION=us-east-1
```

GCS environments use:

```bash
export AGENTPOND_STORE=gcs
export AGENTPOND_GCS_BUCKET=agentpond
export AGENTPOND_PREFIX=
```

Authenticate GCS with Google Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`; do not ask users to paste service-account JSON into chat.

Provider package serverless ingestion exports:

```ts
import { lambdaIngestHandler } from "@agentpond/aws";
import { createHttpIngestFunction, httpIngestFunction } from "@agentpond/google";
```

Use `lambdaIngestHandler` for AWS Lambda Function URLs or API Gateway HTTP API v2, `httpIngestFunction` for Google HTTP Cloud Functions, and `createHttpIngestFunction` with `pathPrefix` for Firebase Functions.

If no environment is selected, AgentPond uses `dev`. DuckDB caches are stored at `./.agentpond/envs/<name>/cache.duckdb`.

The CLI also accepts common settings as flags:

```bash
npx agentpond --env dev sync
npx agentpond --env production sync
npx agentpond --s3-bucket agentpond --s3-endpoint http://localhost:9000 sync
```

Initialize environments interactively, or pass the object store explicitly in scripts:

```bash
npx agentpond env init staging
npx agentpond env init staging --store s3
npx agentpond env init staging --store gcs
npx agentpond env init staging --store local
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
