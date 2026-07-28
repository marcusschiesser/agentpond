# Manual deployment setup

Start with `npx agentpond init`. When no Firebase, Supabase, or Vercel project
is detected, AgentPond installs a
[Files SDK](https://files-sdk.dev/docs/providers) instrumentation workflow that
verifies one real trace locally before asking you to choose production storage.

## Choose the write path

AgentPond supports two production patterns:

1. **Direct object-store export:** a trusted Node.js application writes spans with `@agentpond/files-sdk/otel` and a persistent Files SDK adapter.
2. **HTTP ingestion:** applications send OTLP or Langfuse-compatible requests to the AgentPond container, which writes through Files SDK.

Direct export is simplest when the application can safely hold narrowly scoped object-store write credentials. HTTP ingestion is appropriate for non-Node applications, centralized credentials, or Langfuse-compatible operations beyond span export.

See [Direct object-store export](../direct-object-store-export.md) and [Deployment reference](../deployment.md) for implementation details.

## Configure an AgentPond environment

For dependency-free local verification, use the filesystem adapter with an
absolute root:

```bash
npx agentpond env init local \
  --provider fs \
  --root /absolute/project/.agentpond/envs/local/objects
```

The `fs` adapter is for development and verification only. Keep `.agentpond/`
out of version control.

Create a local configuration for the deployed storage backend:

```bash
npx agentpond env init production
```

In non-interactive scripts, select the Files SDK provider and its required
typed options explicitly:

```bash
npx agentpond env init production --provider s3 --bucket agentpond
npx agentpond env init production --provider gcs --bucket agentpond
npx agentpond env init production --provider r2 --bucket agentpond
npx agentpond env init production --provider minio --bucket agentpond --endpoint http://localhost:9000
```

AgentPond persists the provider and its typed bucket, endpoint, region, or root,
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

## Files SDK providers

Use `createFilesSpanExporterFromRuntimeEnv()` from
`@agentpond/files-sdk/otel` with a supported persistent Node-compatible Files
SDK adapter. The application and CLI must use the same provider configuration,
`AGENTPOND_PROJECT_ID`, and `AGENTPOND_PREFIX`. Keep provider credentials in
the process environment rather than the AgentPond environment file. See the
[Files SDK provider catalog](https://files-sdk.dev/docs/providers) when choosing
production storage. If the current CLI does not offer a compatible adapter,
install `agentpond` locally alongside its peer SDK so `npx` uses the
project-local CLI.

## Containers and custom infrastructure

Run `ghcr.io/marcusschiesser/agentpond` on any container platform and select a
supported Node-compatible Files SDK provider. Configure its ambient
credentials plus Langfuse-compatible authentication on the deployed service,
then point application SDKs at its HTTP endpoint.

## Instrument the application

Install the OpenInference or Langfuse instrumentation matching the application's language, AI SDK, and framework. For Node.js direct export, inject the provider-specific AgentPond exporter into the existing OpenTelemetry provider. For HTTP ingestion, use the deployed OTLP or Langfuse-compatible endpoint.

The [OpenInference example](../../examples/openinference-openai/README.md) and [Langfuse compliance example](../../examples/llm-compliance/README.md) show both styles.

## Local testing

The Files SDK `fs` environment verifies the direct-export path across separate
application and CLI processes:

```bash
eval "$(npx agentpond env get local)"
# Start the application in this shell and exercise one real request.
npx agentpond env use local
npx agentpond sync
npx agentpond traces list --limit 10
```

`npx agentpond dev` is the separate local HTTP-ingestion facility. It writes
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
