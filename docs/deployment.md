# Deployment

Deploy the AgentPond ingestion service together with an object store of your choice (e.g. AWS S3) in your infrastructure. 

All deployment targets expose the same Langfuse-compatible ingestion endpoints:

- `POST /api/public/ingestion` accepts non-OTEL Langfuse-compatible ingestion 
- `POST /api/public/otel/v1/traces` accepts OTLP trace export payloads as JSON, gzip JSON, or protobuf.

non-OTEL is just used for sending scores, traces are send via the OLTP endpoint.

The URL of the deployed ingestion service becomes the `LANGFUSE_BASE_URL` used by the Langfuse SDK in your application. The access will be authenticated by the `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` values that you configure in your deployment.

## AWS

AWS deployments use S3 as the native object store. Run `agentpond env init <name> --store s3` to write a `.agentpond/envs/<name>.env` file for S3 and configure it with the `AGENTPOND_S3_BUCKET`, region and credential environment variables of your S3 bucket.

### Container Ingestion

Run the published `ghcr.io/marcusschiesser/agentpond` Docker image on ECS, EKS, App Runner, or another AWS container runtime. Point the container at S3 with the same environment variables `.agentpond/envs/<name>.env`.

### Lambda Ingestion

Use `lambdaIngestHandler` or `createLambdaIngestHandler` from `@agentpond/aws` for AWS Lambda Function URLs or API Gateway HTTP API v2.

```ts
import { lambdaIngestHandler } from "@agentpond/aws";

export const handler = lambdaIngestHandler;
```

The default handler writes to S3 by calling `S3ObjectStore.fromRuntimeEnv().toSink()` using the same environment variables as in the `.agentpond/envs/<name>.env` file.

## Google Cloud

Google Cloud deployments use Google Cloud Storage as the native object store. Run `agentpond env init <name> --store gcs` to write a `.agentpond/envs/<name>.env` file for GCS. 
Point the `AGENTPOND_GCS_BUCKET` variable to your GCS bucket and authenticate with Google Application Default Credentials or set the `GOOGLE_APPLICATION_CREDENTIALS` variable.

### Container Ingestion

Run the published `ghcr.io/marcusschiesser/agentpond` image on Cloud Run, GKE, or another Google Cloud container runtime. Point the container at GCS with the same environment variables from `.agentpond/envs/<name>.env`.

### Cloud Functions Ingestion

Use `httpIngestFunction` or `createHttpIngestFunction` from `@agentpond/google` for Google HTTP Cloud Functions.

```ts
import { httpIngestFunction } from "@agentpond/google";

export const agentPondIngest = httpIngestFunction;
```

The default function writes to Google Cloud Storage with `GcsObjectStore.fromRuntimeEnv().toSink()`.

Firebase Functions can use `createHttpIngestFunction` with `pathPrefix` and `GcsObjectStore.fromRuntimeEnv().toSink()` to strip Firebase function URL prefixes before routing ingestion requests.

## Vercel

Vercel deployments use Vercel Blob as the object store. Run `agentpond env init <name> --store vercel` to write a `.agentpond/envs/<name>.env` file for Vercel Blob.
Configure `AGENTPOND_BLOB_ACCESS=private` and credentials from `BLOB_READ_WRITE_TOKEN` or Vercel OIDC (`BLOB_STORE_ID` with `VERCEL_OIDC_TOKEN`). Use `AGENTPOND_BLOB_ACCESS=public` only for a Blob store intentionally created for public access.

In a Next.js App Router project, add a catch-all route at `app/api/public/[...agentpond]/route.ts` so both ingestion endpoints route through AgentPond:

```ts
import { handleIngestRequest } from "@agentpond/ingest";
import { VercelBlobObjectStore } from "@agentpond/vercel";

const sink = VercelBlobObjectStore.fromRuntimeEnv().toSink();

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
	return handleIngestRequest(request, { sink });
}
```

Deploy the Next.js app with the same environment variables from `.agentpond/envs/<name>.env`. The route above accepts `POST /api/public/ingestion` and `POST /api/public/otel/v1/traces`.

## Other

Use the published `ghcr.io/marcusschiesser/agentpond` image on any container platform. Pair it with an object store supported by the selected environment, then use the same environment variables for that container that `agentpond env init <name>` writes into `.agentpond/envs/<name>.env`.

For a local deployment template, see [docker-compose.yml](../docker-compose.yml).

Docker images of the ingestion service are published to `ghcr.io/marcusschiesser/agentpond`.
