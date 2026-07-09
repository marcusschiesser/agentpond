# CLI Usage

AgentPond ships a CLI named `agentpond` for syncing traces and scores from object storage (local, S3, GCS, Cloud Storage for Firebase, or Vercel Blob) into a local DuckDB cache, so you can analyze production agent data with SQL and focused trace commands. It can also create manual traces and scores for local testing.

## Install

Install the published package from npm:

```sh
npm install -g agentpond
```

Verify the executable is available:

```sh
agentpond --help
agentpond --version
```

In interactive terminals, AgentPond checks npm for a newer CLI version on startup and asks whether to update with `npm install -g agentpond@latest`. The check is skipped for CI, non-TTY runs, `--json`, help, and version commands. Set `AGENTPOND_NO_UPDATE_CHECK=1` or `AGENTPOND_UPDATE_CHECK=0` to disable it.

## Configure

For local development without MinIO, start the built-in dev ingestion server:

```sh
agentpond dev
```

The command selects the `dev` environment, listens on `127.0.0.1:4318`, and prints the `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY` values to use with Langfuse SDKs. If port `4318` is already in use, it automatically tries the next open port. Only one dev server can run per AgentPond directory.

While the dev server is running, you can print the same SDK environment for a shell with:

```sh
eval "$(agentpond env get dev)"
```

For shared environments, store dotenv-compatible settings in `.agentpond/envs/<name>.env`:

```sh
agentpond env init production
agentpond env use production
```

`agentpond env init` prompts for S3, GCS, Vercel Blob, or local object storage in an interactive terminal. Scripts should pass the store explicitly:

```sh
agentpond env init production --store s3
agentpond env init production --store gcs
agentpond env init production --store vercel
agentpond env init production --store local
```

The CLI reads the selected environment file, then applies process environment variables and explicit flags. You can select an environment per command:

```sh
agentpond --env dev sync
agentpond --env production sync
agentpond --s3-bucket agentpond --s3-endpoint http://localhost:9000 sync
```

By default, AgentPond stores one DuckDB cache per environment at `.agentpond/envs/<name>/cache.duckdb` in the current workspace root, falling back to the current directory outside a workspace. The dev event store lives at `.agentpond/envs/dev/events` in the same AgentPond directory.

## Global Flags

```txt
--env <name>          Use a named AgentPond environment
--db <path>           Use a specific DuckDB cache path
--s3-bucket <bucket>  Use a specific S3 bucket
--s3-prefix <prefix>  Use a specific S3 key prefix
--s3-endpoint <url>   Use a custom S3 endpoint, such as MinIO
--json                Print machine-readable JSON output
--version             Print the installed CLI version
```

## Environments

```sh
agentpond env current
agentpond env get dev
agentpond env get dev --otel
agentpond env get dev --langfuse
agentpond env list
agentpond env init staging --store s3
agentpond env init staging --store gcs
agentpond env init staging --store vercel
agentpond env init staging --store local
agentpond env use production
```

Run `agentpond env use` without a name in an interactive terminal to choose from
known environments. Scripts should keep passing an explicit name, such as
`agentpond env use production`.

Environment files are stored at `.agentpond/envs/<name>.env`. If no environment has been selected yet, AgentPond uses `dev`. For non-Firebase AgentPond environments, the built-in dev server writes directly to `.agentpond/envs/dev/cache.duckdb`, so `agentpond sync` is not needed for `dev`. Firebase projects use their Firebase ingest function and Firebase Storage for every environment, including dev.

### Local Store

Local environments use `AGENTPOND_STORE=local` and read objects from the local AgentPond directory. Run `agentpond --env <name> sync` to load local object-store data into the cache.

### S3 Store

S3 environments use `AGENTPOND_STORE=s3`, `AGENTPOND_S3_BUCKET`, AWS credentials, and optional `AGENTPOND_PREFIX`. Run `agentpond --env <name> sync` to retrieve traces from the bucket into the local DuckDB cache. S3-compatible providers can require provider-specific endpoint and checksum settings; for Hugging Face Storage Buckets, see <https://huggingface.co/docs/hub/storage-buckets-s3>.

### GCS Store

GCS environments use `AGENTPOND_STORE=gcs`, `AGENTPOND_GCS_BUCKET`, and optional `AGENTPOND_PREFIX`. Authenticate with Google Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`, then run `agentpond --env <name> sync` to retrieve traces.

### Firebase Store

Firebase projects do not need Firebase storage settings in AgentPond env files. Run `agentpond sync` inside a Firebase project directory or nested package to retrieve traces, and AgentPond detects `.firebaserc` or an ancestor `firebase.json`. It uses `.firebaserc` `projects.default` when present, otherwise it reads the project id from Firebase/Google environment (`FIREBASE_CONFIG`, `GCLOUD_PROJECT`, `GCP_PROJECT`, or `GOOGLE_CLOUD_PROJECT`). When `FIREBASE_CONFIG` includes `storageBucket`, AgentPond syncs that bucket; otherwise it checks the Firebase default `${projectId}.appspot.com` and `${projectId}.firebasestorage.app` buckets under the fixed `agentpond/` prefix. Without `--env`, the Firebase project id is also the local AgentPond cache environment name, such as `.agentpond/envs/lunaraspect-dev/cache.duckdb`.

### Vercel Blob Store

Vercel environments use `AGENTPOND_STORE=vercel`, `AGENTPOND_BLOB_ACCESS=private`, optional `AGENTPOND_PREFIX`, and Vercel Blob credentials from `BLOB_READ_WRITE_TOKEN` or OIDC (`BLOB_STORE_ID` with `VERCEL_OIDC_TOKEN`). Run `agentpond --env <name> sync` to retrieve traces from Vercel Blob.

For serverless and container ingestion deployments, see [Deployment](./deployment.md).

## Dev Server

Start a local Langfuse SDK-compatible ingestion server:

```sh
agentpond dev
```

The dev server writes directly to `.agentpond/envs/dev/cache.duckdb` in the current workspace root, or current directory outside a workspace, and does not enforce credential matching. If the requested port is already in use, it automatically tries the next open port. `agentpond env get dev` prints both standard OTLP HTTP exporter variables and Langfuse-compatible SDK variables for the running dev server in this AgentPond directory, and errors if no dev server is running. Use `--otel` for only `OTEL_EXPORTER_OTLP_*` variables or `--langfuse` for only Langfuse-compatible variables. Langfuse SDKs should still be configured with the dummy keys printed by the command because SDKs expect public and secret keys to be present.

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
agentpond --version
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
