# Deployment reference

For deployment onboarding, start with [Manual deployment setup](./getting-started/manual-setup.md).

## Write paths

### Direct object-store export

A trusted Node.js application writes spans directly to object storage with `AgentPondSpanExporter` and an adapter from `@agentpond/aws`, `@agentpond/google`, or `@agentpond/vercel`.

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

## Vercel

- Object store: private Vercel Blob
- Direct adapter: `VercelBlobObjectStore` from `@agentpond/vercel`
- HTTP integration: a Node.js route using `handleIngestRequest`
- Credentials: Vercel OIDC where available, otherwise `BLOB_READ_WRITE_TOKEN`

```bash
npx agentpond env init production --store vercel
```

## Custom container infrastructure

Run `ghcr.io/marcusschiesser/agentpond` on any container platform and connect it to S3-compatible or GCS storage. Configure provider credentials and Langfuse-compatible ingestion authentication directly on the deployment.

Local filesystem storage and `npx agentpond dev` are testing facilities only; see [Local testing](./getting-started/manual-setup.md#local-testing).
