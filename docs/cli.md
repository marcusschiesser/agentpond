# CLI Usage

AgentPond ships a CLI named `agentpond` for syncing traces and scores from local, S3-compatible, or Google Cloud Storage object storage into a local DuckDB cache, so you can analyze production agent data with SQL and focused trace commands. It can also create manual traces and scores for local testing.

## Install

Install the published package from npm:

```sh
npm install -g agentpond
```

Verify the executable is available:

```sh
agentpond --help
```

## Configure

For local development without MinIO, start the built-in dev ingestion server:

```sh
agentpond dev
```

The command selects the `dev` environment, listens on `127.0.0.1:4318`, and prints the `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY` values to use with Langfuse SDKs.

You can print the same SDK environment for a shell with:

```sh
eval "$(agentpond env get dev)"
```

For shared environments, store dotenv-compatible settings in `.agentpond/envs/<name>.env`:

```sh
agentpond env init production
agentpond env use production
```

`agentpond env init` prompts for S3, GCS, or local object storage in an interactive terminal. Scripts should pass the store explicitly:

```sh
agentpond env init production --store s3
agentpond env init production --store gcs
agentpond env init production --store local
```

The CLI reads the selected environment file, then applies process environment variables and explicit flags. You can select an environment per command:

```sh
agentpond --env dev sync
agentpond --env production sync
agentpond --s3-bucket agentpond --s3-endpoint http://localhost:9000 sync
```

By default, AgentPond stores one DuckDB cache per environment at `./.agentpond/envs/<name>/cache.duckdb`. The dev event store lives at `./.agentpond/envs/dev/events`.

## Global Flags

```txt
--env <name>          Use a named AgentPond environment
--db <path>           Use a specific DuckDB cache path
--s3-bucket <bucket>  Use a specific S3 bucket
--s3-prefix <prefix>  Use a specific S3 key prefix
--s3-endpoint <url>   Use a custom S3 endpoint, such as MinIO
--json                Print machine-readable JSON output
```

## Environments

```sh
agentpond env current
agentpond env get dev
agentpond env list
agentpond env init staging --store s3
agentpond env use production
```

Run `agentpond env use` without a name in an interactive terminal to choose from
known environments. Scripts should keep passing an explicit name, such as
`agentpond env use production`.

Environment files are stored at `.agentpond/envs/<name>.env`. If no environment has been selected yet, AgentPond uses `dev`.

GCS environments use `AGENTPOND_GCS_BUCKET` and authenticate with Google Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`. All storage providers use `AGENTPOND_PREFIX` for an optional object key prefix.

For serverless ingestion deployments, `@agentpond/aws` exports `lambdaIngestHandler` for AWS Lambda Function URLs or API Gateway HTTP API v2, and `@agentpond/google` exports `httpIngestFunction` for Google HTTP Cloud Functions. Firebase Functions can use `createHttpIngestFunction` with `pathPrefix` to strip Firebase function URL prefixes. These handlers use the same Langfuse-compatible ingestion endpoints as `agentpond dev`.

## Dev Server

Start a local Langfuse SDK-compatible ingestion server:

```sh
agentpond dev
```

The dev server writes directly to `.agentpond/envs/dev/cache.duckdb` and does not enforce credential matching. Langfuse SDKs should still be configured with the dummy keys printed by the command because SDKs expect public and secret keys to be present.

```sh
eval "$(agentpond env get dev)"
```

## Sync

Sync scans UTC object-storage buckets for OTEL trace payloads and non-OTEL score manifests, then projects new data into the local DuckDB cache:

```sh
agentpond sync
```

Use JSON output when another tool or script needs to consume the result:

```sh
agentpond sync --json
```

## Traces

Create a manual trace. The CLI writes this as a Langfuse-compatible OTEL root span:

```sh
agentpond traces create \
  --name "manual trace" \
  --userId user_42 \
  --sessionId session_42 \
  --metadata '{"env":"local","feature":"checkout"}' \
  --input '{"question":"Why was my card declined?"}' \
  --output '{"answer":"The bank declined the authorization."}'
```

List recent traces:

```sh
agentpond traces list
agentpond traces list --limit 25
```

Read one trace by ID:

```sh
agentpond traces get <trace-id>
```

## Observations

List observations for a trace:

```sh
agentpond observations list --traceId <trace-id>
```

## Sessions

List recent sessions:

```sh
agentpond sessions list
```

Read one session by ID:

```sh
agentpond sessions get <session-id>
```

## Scores

Create a score for a trace. Scores use the same non-OTEL `score-create` event shape as the Langfuse SDK:

```sh
agentpond scores create \
  --name quality \
  --value 0.9 \
  --traceId <trace-id>
```

Create an human annotation score:

```sh
agentpond scores create \
  --name reviewed \
  --value true \
  --traceId <trace-id> \
  --source ANNOTATION \
  --comment "Looks good"
```

List scores for a trace or observation:

```sh
agentpond scores list --traceId <trace-id>
agentpond scores list --observationId <observation-id>
```

## SQL

Run custom SQL against the local DuckDB cache:

```sh
agentpond sql "select id, name, session_id from traces limit 10"
agentpond sql "select * from scores where trace_id = '<trace-id>'"
```

Use JSON output for downstream analysis:

```sh
agentpond sql "select * from traces limit 10" --json
```

## Command Summary

```sh
agentpond sync
agentpond dev
agentpond env current
agentpond env get dev
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
