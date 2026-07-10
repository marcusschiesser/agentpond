# AgentPond CLI

Use `npx agentpond` for AgentPond data access unless the user has installed the package globally.

Print the installed CLI version with:

```bash
npx agentpond --version
```

In interactive terminals, AgentPond checks npm for a newer CLI version on startup and asks whether to update with `npm install -g agentpond@latest`. The update check is skipped for CI, non-TTY runs, `--json`, help, and version commands. Set `AGENTPOND_NO_UPDATE_CHECK=1` or `AGENTPOND_UPDATE_CHECK=0` to disable it.

## Configuration

AgentPond reads object storage settings from the selected environment file under `.agentpond/envs/<name>.env`, then process environment variables, then flags. For non-Firebase AgentPond environments, the built-in dev server writes directly to `.agentpond/envs/dev/cache.duckdb`, so do not run `npx agentpond sync` for `dev`. Firebase projects use their Firebase ingest function and Firebase Storage for every environment, including dev.

### Local Store

Use `local` for filesystem-backed object storage, usually for tests or simple local workflows:

```bash
export AGENTPOND_STORE=local
export AGENTPOND_PROJECT_ID=default-project
export AGENTPOND_PREFIX=
```

Run `npx agentpond --env <name> sync` to load local object-store data into the cache.

### S3 Store

Use `s3` for AWS S3 or S3-compatible storage:

```bash
export AGENTPOND_PROJECT_ID=default-project
export AGENTPOND_PREFIX=
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/api/public/otel
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export LANGFUSE_BASE_URL=http://localhost:4318
export LANGFUSE_PUBLIC_KEY=pk-agentpond
export LANGFUSE_SECRET_KEY=sk-agentpond
export AGENTPOND_STORE=s3
export AGENTPOND_S3_BUCKET=agentpond
export AGENTPOND_S3_ENDPOINT=http://localhost:9000
export AGENTPOND_S3_FORCE_PATH_STYLE=true
export AWS_ACCESS_KEY_ID=minio
export AWS_SECRET_ACCESS_KEY=minio123
export AWS_REGION=us-east-1
```

For Hugging Face Storage Buckets, follow the S3-compatible endpoint and checksum guidance in <https://huggingface.co/docs/hub/storage-buckets-s3>.

Run `npx agentpond --env <name> sync` to retrieve traces from the S3 bucket into the local DuckDB cache.

### GCS Store

Use `gcs` for Google Cloud Storage:

```bash
export AGENTPOND_STORE=gcs
export AGENTPOND_GCS_BUCKET=agentpond
export AGENTPOND_PREFIX=
```

Authenticate GCS with Google Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS`; do not ask users to paste service-account JSON into chat. Run `npx agentpond --env <name> sync` to retrieve traces.

### Firebase Store

Firebase projects do not use AgentPond env files for bucket or prefix configuration. Run AgentPond inside the Firebase project directory to retrieve traces:

```bash
firebase login
firebase use <project>
npx agentpond sync
```

AgentPond detects `.firebaserc` or an ancestor `firebase.json`, so this also works from nested packages in Firebase monorepos. It uses `.firebaserc` `projects.default` from `firebase use` when present; if only `firebase.json` is present, set `FIREBASE_CONFIG`, `GCLOUD_PROJECT`, `GCP_PROJECT`, or `GOOGLE_CLOUD_PROJECT` with the Firebase project id. It resolves `firebase-admin` from a Functions `source` declared in `firebase.json`, so that Functions package must declare `firebase-admin`; otherwise add it to the workspace's dev dependencies. When `FIREBASE_CONFIG` includes `storageBucket`, AgentPond syncs that bucket; otherwise it checks the Firebase default `${projectId}.appspot.com` and `${projectId}.firebasestorage.app` buckets. It always uses the `agentpond/` prefix. Without `--env`, the Firebase project id is the local cache environment name, for example `.agentpond/envs/lunaraspect-dev/cache.duckdb`. Do not add Firebase bucket or prefix settings to AgentPond env files.

### Vercel Blob Store

Use `vercel` for Vercel Blob:

```bash
export AGENTPOND_STORE=vercel
export AGENTPOND_BLOB_ACCESS=private
export AGENTPOND_PREFIX=
export BLOB_READ_WRITE_TOKEN=
# Or use Vercel OIDC with BLOB_STORE_ID and VERCEL_OIDC_TOKEN.
```

Run `npx agentpond --env <name> sync` to retrieve traces from Vercel Blob.

Provider package serverless ingestion exports:

```ts
import { lambdaIngestHandler, S3ObjectStore } from "@agentpond/aws";
import { createFirebaseIngestFunction } from "@agentpond/firebase";
import {
	createHttpIngestFunction,
	GcsObjectStore,
	httpIngestFunction,
} from "@agentpond/google";
import { VercelBlobObjectStore } from "@agentpond/vercel";
```

Use `lambdaIngestHandler` for AWS Lambda Function URLs or API Gateway HTTP API v2 and `httpIngestFunction` for Google HTTP Cloud Functions. Firebase Functions should use `createFirebaseIngestFunction()`; the Firebase store writes to the default Cloud Storage for Firebase bucket under `agentpond/`, and local sync detects `.firebaserc` or an ancestor `firebase.json`.

If no environment is selected, AgentPond uses `dev`. DuckDB caches are stored at `.agentpond/envs/<name>/cache.duckdb` in the current workspace root, or current directory outside a workspace.

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
npx agentpond env init staging --store vercel
npx agentpond env init staging --store local
```

For local development, `npx agentpond env get dev` prints both OpenTelemetry and Langfuse-compatible SDK variables for the running dev server in this AgentPond directory, and fails if no dev server is running. Use `--otel` for only `OTEL_EXPORTER_OTLP_*` variables and `--langfuse` for only Langfuse-compatible variables.

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
