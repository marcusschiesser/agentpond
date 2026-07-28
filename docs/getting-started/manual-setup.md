# Manual deployment setup

Use this guide when the application is deployed on AWS, Google Cloud, or custom infrastructure. Firebase, Supabase, and Vercel projects should use `npx agentpond init` with the [Firebase](./firebase.md), [Supabase](./supabase.md), or [Vercel](./vercel.md) automatic setup guide.

## Choose the write path

AgentPond supports two production patterns:

1. **Direct object-store export:** a trusted Node.js application writes spans with `@agentpond/files-sdk/otel` and a Files SDK bucket adapter.
2. **HTTP ingestion:** applications send OTLP or Langfuse-compatible requests to the AgentPond container, which writes through Files SDK.

Direct export is simplest when the application can safely hold narrowly scoped object-store write credentials. HTTP ingestion is appropriate for non-Node applications, centralized credentials, or Langfuse-compatible operations beyond span export.

See [Direct object-store export](../direct-object-store-export.md) and [Deployment reference](../deployment.md) for implementation details.

## Configure an AgentPond environment

Create a local configuration for the deployed storage backend:

```bash
npx agentpond env init production
```

In non-interactive scripts, select the Files SDK provider and bucket explicitly:

```bash
npx agentpond env init production --provider s3 --bucket agentpond
npx agentpond env init production --provider gcs --bucket agentpond
npx agentpond env init production --provider r2 --bucket agentpond
npx agentpond env init production --provider minio --bucket agentpond --endpoint http://localhost:9000
```

AgentPond persists the provider, bucket, optional endpoint and region,
`AGENTPOND_PROJECT_ID`, and optional `AGENTPOND_PREFIX` in
`.agentpond/envs/production.env`. Provider credentials remain ambient process
environment variables and are never written by `env init`.

Select and sync the environment:

```bash
npx agentpond env use production
npx agentpond sync
```

## AWS and S3-compatible storage

Use the Files SDK `s3` adapter for direct export. For HTTP ingestion, run
`ghcr.io/marcusschiesser/agentpond` on ECS, EKS, App Runner, or another
container runtime with `FILES_SDK_PROVIDER=s3` and
`AGENTPOND_FILES_BUCKET=<bucket>`. Supply AWS credentials, region, and any
S3-compatible endpoint through the standard ambient AWS environment variables.
AgentPond no longer ships an AWS Lambda ingestion handler.

## Google Cloud

Use the Files SDK `gcs` adapter for direct export. For HTTP ingestion, run the
AgentPond container on Cloud Run or GKE with `FILES_SDK_PROVIDER=gcs` and
`AGENTPOND_FILES_BUCKET=<bucket>`. Authenticate with Application Default
Credentials or a narrowly scoped service account. AgentPond no longer ships a
generic Google Cloud Function handler.

## Files SDK bucket providers

Use `createFilesSpanExporter()` from `@agentpond/files-sdk/otel` with a
supported Node-compatible, bucket-backed Files SDK adapter. Manual environments
persist bucket, endpoint, and region configuration; adapters that require other
constructor-only fields are rejected. The application and CLI must use the
same provider, bucket, `AGENTPOND_PROJECT_ID`, and `AGENTPOND_PREFIX`. Keep
provider credentials in the process environment rather than the AgentPond
environment file.

## Containers and custom infrastructure

Run `ghcr.io/marcusschiesser/agentpond` on any container platform and select a
Node-compatible, bucket-backed Files SDK provider. Configure its ambient
credentials plus Langfuse-compatible authentication on the deployed service,
then point application SDKs at its HTTP endpoint.

## Instrument the application

Install the OpenInference or Langfuse instrumentation matching the application's language, AI SDK, and framework. For Node.js direct export, inject the provider-specific AgentPond exporter into the existing OpenTelemetry provider. For HTTP ingestion, use the deployed OTLP or Langfuse-compatible endpoint.

The [OpenInference example](../../examples/openinference-openai/README.md) and [Langfuse compliance example](../../examples/llm-compliance/README.md) show both styles.

## Local testing

`npx agentpond dev` is for tests, examples, and smoke checks only. It writes
directly to `.agentpond/envs/dev/cache.duckdb`; it does not create an object
store and is not a durable shared or production deployment.

Start the local HTTP ingestion server:

```bash
npx agentpond dev
```

In another shell, load its test SDK values:

```bash
eval "$(npx agentpond env get dev)"
```

## Analyze deployed traces

```bash
npx agentpond sync
npx agentpond traces list --limit 25
npx agentpond sql "select id, name, session_id, total_cost from traces order by start_time desc limit 10"
```
