# SDK Trace Export

AgentPond accepts Langfuse-compatible ingestion from existing Langfuse SDK integrations. Use this when an application should send trace data to AgentPond instead of a hosted observability service.

Node.js applications may alternatively write OpenTelemetry spans directly to AgentPond object storage with `@agentpond/otel`, avoiding an ingestion service.

## Environment

Point the SDK at the AgentPond ingestion service:

```bash
export LANGFUSE_BASE_URL=http://localhost:3030
export LANGFUSE_PUBLIC_KEY=pk-agentpond
export LANGFUSE_SECRET_KEY=sk-agentpond
```

The public and secret keys are used by the ingestion service. Do not ask users to paste real keys into chat; ask them to set environment variables or store them in an `.env` file.

## Direct Object-Store Export for Node.js

Use direct export when the application can safely hold write credentials for the same object store configured in its AgentPond environment.

```ts
import { S3ObjectStore } from "@agentpond/aws";
import { AgentPondSpanExporter } from "@agentpond/otel";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";

const exporter = new AgentPondSpanExporter({
  store: S3ObjectStore.fromRuntimeEnv(),
  projectId: process.env.AGENTPOND_PROJECT_ID ?? "default-project",
});
const processor = new LangfuseSpanProcessor({ exporter });
const sdk = new NodeSDK({ spanProcessors: [processor] });

sdk.start();
// Run instrumented application code.
await processor.forceFlush();
await sdk.shutdown();
```

For OpenInference, provide the same exporter as the OpenTelemetry Node SDK's `traceExporter` or wrap it in the desired span processor. Use the provider adapter matching the deployment: `S3ObjectStore`, `GcsObjectStore`, `VercelBlobObjectStore`, `FirebaseStorageObjectStore`, or `FileSystemObjectStore`.

The exporter uses the store's existing prefix behavior and accepts an explicit `prefix` where overrides are supported. Configure the CLI with the same project id, bucket, and prefix. No Langfuse URL or ingestion keys are required for spans, but scores and other Langfuse client operations still require a compatible API endpoint or AgentPond CLI commands.

## Workflow

1. Configure the application with either the AgentPond ingestion URL or the direct object-store exporter.
2. Run the application path that emits traces.
3. Sync AgentPond object storage into the local DuckDB cache:

```bash
npx agentpond sync
```

4. Inspect the resulting trace data:

```bash
npx agentpond traces list --limit 25
npx agentpond observations list --traceId <trace-id>
npx agentpond scores list --traceId <trace-id>
```

Use `npx agentpond sql "..."` for analysis that needs aggregation, joins, JSON inspection, or custom filtering.
