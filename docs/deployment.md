# Deployment reference

For deployment onboarding, use automatic [Firebase](./getting-started/firebase.md), [Supabase](./getting-started/supabase.md), or [Vercel](./getting-started/vercel.md) setup, or start with [Manual deployment setup](./getting-started/manual-setup.md) for other providers.

## Write paths

### Direct object-store export

A trusted server application writes spans directly to object storage with `AgentPondSpanExporter` and a provider adapter.

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
- Direct adapter: `S3ObjectStore` from `@agentpond/aws`
- Serverless handler: `lambdaIngestHandler` or `createLambdaIngestHandler`
- Container targets: ECS, EKS, App Runner, or another container runtime

Initialize the CLI configuration with:

```bash
npx agentpond env init production --store s3
```

## Google Cloud

- Object store: Google Cloud Storage
- Direct adapter: `GcsObjectStore` from `@agentpond/google`
- Serverless handler: `httpIngestFunction` or `createHttpIngestFunction`
- Container targets: Cloud Run, GKE, or another container runtime

```bash
npx agentpond env init production --store gcs
```

## Files SDK

- Object store: any Files SDK provider whose adapter uses a bucket
- Direct exporter: `createFilesSpanExporter()` from `@agentpond/files-sdk/otel`
- CLI configuration: persistent provider and bucket selection
- Credentials: provider-specific process environment variables

```bash
npx agentpond env init production \
  --store files-sdk \
  --provider r2 \
  --bucket agentpond
```

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

Run `ghcr.io/marcusschiesser/agentpond` on any container platform and connect it to S3-compatible or GCS storage. Configure provider credentials and Langfuse-compatible ingestion authentication directly on the deployment.

Local filesystem storage and `npx agentpond dev` are testing facilities only; see [Local testing](./getting-started/manual-setup.md#local-testing).
