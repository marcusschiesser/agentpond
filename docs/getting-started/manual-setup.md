# Manual deployment setup

Use this guide when the application is deployed on AWS, Google Cloud, or custom infrastructure. Firebase and Vercel projects should use `npx agentpond init` with the [Firebase](./firebase.md) or [Vercel](./vercel.md) automatic setup guide.

## Choose the write path

AgentPond supports two production patterns:

1. **Direct object-store export:** a trusted Node.js application writes spans directly with `@agentpond/otel` and the provider adapter.
2. **HTTP ingestion:** applications send OTLP or Langfuse-compatible requests to an AgentPond container or serverless function, which writes to object storage.

Direct export is simplest when the application can safely hold narrowly scoped object-store write credentials. HTTP ingestion is appropriate for non-Node applications, centralized credentials, or Langfuse-compatible operations beyond span export.

See [Direct object-store export](../direct-object-store-export.md) and [Deployment reference](../deployment.md) for implementation details.

## Configure an AgentPond environment

Create a local configuration for the deployed storage backend:

```bash
npx agentpond env init production
```

In non-interactive scripts, select it explicitly:

```bash
npx agentpond env init production --store s3
npx agentpond env init production --store gcs
```

Edit `.agentpond/envs/production.env` with the deployed bucket, prefix, endpoint, and credential-chain settings. Do not commit secrets.

Select and sync the environment:

```bash
npx agentpond env use production
npx agentpond sync
```

## AWS and S3-compatible storage

Use `@agentpond/aws` for direct export or Lambda ingestion, or run the published AgentPond container on ECS, EKS, App Runner, or another runtime. Configure an S3 bucket, region, optional compatible endpoint, and credentials with only the required bucket permissions.

## Google Cloud

Use `@agentpond/google` for direct GCS export or HTTP Cloud Functions, or run the AgentPond container on Cloud Run or GKE. Authenticate with Application Default Credentials or a narrowly scoped service account.

## Containers and custom infrastructure

Run `ghcr.io/marcusschiesser/agentpond` on any container platform and connect it to S3-compatible or GCS storage. Configure Langfuse-compatible authentication on the deployed service and point application SDKs at its HTTP endpoint.

## Instrument the application

Install the OpenInference or Langfuse instrumentation matching the application's language, AI SDK, and framework. For Node.js direct export, inject the provider-specific AgentPond exporter into the existing OpenTelemetry provider. For HTTP ingestion, use the deployed OTLP or Langfuse-compatible endpoint.

The [OpenInference example](../../examples/openinference-openai/README.md) and [Langfuse compliance example](../../examples/llm-compliance/README.md) show both styles.

## Local testing

Local storage and `npx agentpond dev` are for tests, examples, and smoke checks only. They are not durable shared or production deployments.

Start the local HTTP ingestion server:

```bash
npx agentpond dev
```

In another shell, load its test SDK values:

```bash
eval "$(npx agentpond env get dev)"
```

Use `npx agentpond env init <name> --store local` only for explicit filesystem-backed test fixtures.

## Analyze deployed traces

```bash
npx agentpond sync
npx agentpond traces list --limit 25
npx agentpond sql "select id, name, session_id, total_cost from traces order by start_time desc limit 10"
```
