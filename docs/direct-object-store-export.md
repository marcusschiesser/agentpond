# Direct OpenTelemetry Object-Store Export

Node.js applications can skip the AgentPond ingestion service and write OpenTelemetry spans directly to the same object storage read by `npx agentpond sync`.

This path does not use an AgentPond server or `npx agentpond dev`. The application writes to object storage, and the CLI later reads that storage with `npx agentpond sync`.

## Install

Install the exporter, the adapter for your object store, and your instrumentation packages. For example, with S3 and Langfuse:

```sh
npm install @agentpond/otel @agentpond/aws @langfuse/otel @langfuse/tracing @opentelemetry/sdk-node
```

## Langfuse

Create the exporter with an AgentPond object store and project id, then pass it to Langfuse's span processor:

```ts
import { S3ObjectStore } from "@agentpond/aws";
import { AgentPondSpanExporter } from "@agentpond/otel";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";

const exporter = new AgentPondSpanExporter({
  store: S3ObjectStore.fromRuntimeEnv(),
  projectId: process.env.AGENTPOND_PROJECT_ID ?? "default-project",
});
const langfuseProcessor = new LangfuseSpanProcessor({ exporter });
const sdk = new NodeSDK({ spanProcessors: [langfuseProcessor] });

sdk.start();
// Run instrumented application code.
await langfuseProcessor.forceFlush();
await sdk.shutdown();
```

## OpenInference

OpenInference and other standard OpenTelemetry instrumentations can use the same exporter directly:

```ts
import { S3ObjectStore } from "@agentpond/aws";
import { AgentPondSpanExporter } from "@agentpond/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";

const sdk = new NodeSDK({
  traceExporter: new AgentPondSpanExporter({
    store: S3ObjectStore.fromRuntimeEnv(),
    projectId: process.env.AGENTPOND_PROJECT_ID ?? "default-project",
  }),
  instrumentations: [/* OpenInference instrumentations */],
});

sdk.start();
// Run instrumented application code.
await sdk.shutdown();
```

NodeSDK wraps `traceExporter` in a `BatchSpanProcessor`. AgentPond preserves each exporter invocation as one immutable object-store object, so a batch of spans is written as one object. If you configure span processors directly, prefer `BatchSpanProcessor` for production and force-flush at the application's real lifecycle boundary.

## Object Stores

Use the matching adapter for the deployment:

- `S3ObjectStore.fromRuntimeEnv()` from `@agentpond/aws`
- `GcsObjectStore.fromRuntimeEnv()` from `@agentpond/google`
- `VercelBlobObjectStore.fromRuntimeEnv()` from `@agentpond/vercel`
- `createFirebaseSpanExporter()` from `@agentpond/firebase`
- `new FileSystemObjectStore(path)` from `@agentpond/core`

The application needs write credentials for the selected object store. Provider-specific prefix defaults and `AGENTPOND_PREFIX` continue to apply; an explicit `prefix` can be passed to the exporter where the store supports overrides.

### Firebase

Firebase users should start with `npx agentpond init`. The installed instrumentation skill owns the default-app, exporter, trusted-runtime, and Storage Rules workflow; see its [Firebase reference](../skills/agentpond-instrumentation/references/firebase.md).

After the application exports a trace, select the Firebase project, sync, and inspect it:

```sh
firebase use <alias-or-project-id>
npx agentpond sync
npx agentpond traces list --limit 25
```

## Scope

The direct exporter writes spans and traces only. Langfuse client operations such as scores still need a compatible ingestion/API endpoint, or can be created with AgentPond CLI commands.

No `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, or `LANGFUSE_SECRET_KEY` is required for span export itself.
