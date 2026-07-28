# Deployment reference

For deployment onboarding, use automatic [Firebase](./getting-started/firebase.md), [Supabase](./getting-started/supabase.md), or [Vercel](./getting-started/vercel.md) setup, or start with [Manual deployment setup](./getting-started/manual-setup.md) for other providers.

## Write paths

### Direct object-store export

A trusted Node.js application writes spans directly to object storage with
`createFilesSpanExporterFromRuntimeEnv()` and a persistent Files SDK adapter.

```text
Node.js application -> object storage -> npx agentpond sync -> local DuckDB
```

No AgentPond HTTP service is required. See [Direct object-store export](./direct-object-store-export.md).

### HTTP ingestion

Applications send OTLP or Langfuse-compatible requests to an AgentPond service, which writes to object storage.

```text
Application -> AgentPond HTTP service -> object storage -> npx agentpond sync -> local DuckDB
```

Supported endpoints:

- `POST /api/public/ingestion`
- `POST /api/public/otel/v1/traces`

## AWS

- Object store: S3 or an S3-compatible provider
- Direct adapter: `s3` from `files-sdk/s3`
- HTTP ingestion: the AgentPond Docker image
- Container targets: ECS, EKS, App Runner, or another container runtime

Initialize the CLI configuration with:

```bash
npx agentpond env init production --provider s3 --bucket agentpond
```

Set `FILES_SDK_PROVIDER=s3` and `AGENTPOND_FILES_BUCKET=agentpond` on the
container. AWS credentials, region, and optional compatible endpoint remain
ambient AWS environment variables. There is no AgentPond AWS Lambda handler.

## Google Cloud

- Object store: Google Cloud Storage
- Direct adapter: `gcs` from `files-sdk/gcs`
- HTTP ingestion: the AgentPond Docker image
- Container targets: Cloud Run, GKE, or another container runtime

```bash
npx agentpond env init production --provider gcs --bucket agentpond
```

Set `FILES_SDK_PROVIDER=gcs` and `AGENTPOND_FILES_BUCKET=agentpond` on the
container and use Application Default Credentials or a service account. There
is no generic AgentPond Google Cloud Function handler.

## Files SDK

- Object store: a supported persistent Node-compatible Files SDK provider
- Direct exporter: `createFilesSpanExporterFromRuntimeEnv()` from `@agentpond/files-sdk/otel`
- CLI configuration: persistent provider and typed adapter configuration
- Credentials: provider-specific process environment variables

```bash
npx agentpond env init production \
  --provider r2 \
  --bucket agentpond
```

Providers that declare an endpoint, region, or root receive matching typed
flags. AgentPond discovers supported providers from Files SDK at runtime and
excludes memory, Bun-only, and adapters requiring constructor configuration
beyond bucket, endpoint, region, and root. CLI setup also excludes adapters
whose peer SDKs the executing AgentPond installation cannot resolve.

## Vercel

- Object store: private Vercel Blob
- Direct exporter: `createVercelSpanExporter()` from `@agentpond/vercel`
- Runtime: trusted Node.js Vercel Functions, routes, or server actions; not Edge, middleware, client, or static code
- Credentials: Vercel OIDC where available, otherwise `BLOB_READ_WRITE_TOKEN`
- Isolation: `agentpond/otel/<vercel-project-id>-<target>/` in a shared private store

```bash
npx agentpond init --platform vercel
npx agentpond env use staging
npx agentpond sync
```

Vercel uses direct span export and does not require or create an AgentPond ingestion route. Production is the default target.

## Supabase

- Object store: dedicated private Supabase Storage bucket named `agentpond`
- Direct exporter: `createSupabaseSpanExporter()` from `@agentpond/supabase`
- Runtime: Supabase Edge Functions or trusted Node.js backends
- Credentials: modern Supabase secret key, with temporary legacy `service_role` compatibility
- Isolation: `otel/<project-ref>/`; branches use their distinct hosted project refs

```bash
npx agentpond init --platform supabase
npx agentpond env use <project-ref>
npx agentpond sync
```

Supabase uses direct span export and does not require an AgentPond ingestion
route. Review `storage.objects` RLS policies even when the bucket is private.

## Custom container infrastructure

Run `ghcr.io/marcusschiesser/agentpond` on any container platform and configure
`FILES_SDK_PROVIDER`, `AGENTPOND_FILES_BUCKET`, optional
`FILES_SDK_ENDPOINT`/`FILES_SDK_REGION`, provider credentials, and
Langfuse-compatible ingestion authentication directly on the deployment.

`npx agentpond dev` writes directly to its local DuckDB cache and has no object
store; see [Local testing](./getting-started/manual-setup.md#local-testing).
