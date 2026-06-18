# CLI Usage

AgentPond ships a CLI named `agentpond` for syncing traces and scores from remote object storage into a local DuckDB cache, so you can analyze production agent data with SQL and focused trace commands. It can also create manual traces and scores for local testing.

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

For a local MinIO setup started with `docker compose up --build`, configure the CLI with:

```sh
export AGENTPOND_S3_ENDPOINT=http://localhost:9000
export AGENTPOND_S3_BUCKET=agentpond
export AWS_ACCESS_KEY_ID=minio
export AWS_SECRET_ACCESS_KEY=minio123
```

The CLI reads the same configuration variables as the ingestion service. You can also pass common settings as flags:

```sh
agentpond --env .env sync
agentpond --db ~/.agentpond/cache.duckdb sync
agentpond --s3-bucket agentpond --s3-endpoint http://localhost:9000 sync
```

## Global Flags

```txt
--env <path>          Load environment variables from a file
--db <path>           Use a specific DuckDB cache path
--s3-bucket <bucket>  Use a specific S3 bucket
--s3-prefix <prefix>  Use a specific S3 key prefix
--s3-endpoint <url>   Use a custom S3 endpoint, such as MinIO
--json                Print machine-readable JSON output
```

## Sync

Sync reads accepted event manifests from object storage and projects them into the local DuckDB cache:

```sh
agentpond sync
```

Use JSON output when another tool or script needs to consume the result:

```sh
agentpond sync --json
```

## Traces

Create a manual trace:

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

Create a score for a trace:

```sh
agentpond scores create \
  --name quality \
  --value 0.9 \
  --traceId <trace-id>
```

Create an annotation score:

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
