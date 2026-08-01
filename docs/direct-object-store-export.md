# Direct OpenTelemetry Object-Store Export

Node.js applications can write OpenTelemetry spans directly to the same object storage read by `npx agentpond sync`.

The application writes to object storage, and the CLI later reads that storage with `npx agentpond sync`.

## Install

Install the AgentPond Files SDK integration, Files SDK, the selected provider's
peer SDKs, and your instrumentation packages:

```sh
npm install @agentpond/files-sdk @agentpond/otel files-sdk @opentelemetry/sdk-node

# R2, S3, MinIO, and Oracle Cloud
npm install @aws-sdk/client-s3 @aws-sdk/s3-presigned-post @aws-sdk/s3-request-presigner

# Google Cloud Storage
npm install @google-cloud/storage

# Azure Blob Storage
npm install @azure/storage-blob

# Netlify Blobs
npm install @netlify/blobs
```

Install only the provider peer SDKs for the adapter used by the application.
The [Files SDK adapter catalog](https://files-sdk.dev/adapters) lists
the install command for every other provider. The dependency-free `fs` adapter
is available for local development and trace verification. The executing
AgentPond CLI must also be able to resolve the selected peer SDK.

## Langfuse

Create Files SDK normally, pass it to the AgentPond exporter, and give the
exporter to Langfuse's span processor:

```ts
import { Files } from "files-sdk";
import { r2 } from "files-sdk/r2";
import { createFilesSpanExporter } from "@agentpond/files-sdk/otel";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";

const exporter = createFilesSpanExporter({
  files: new Files({
    adapter: r2({
      bucket: "agentpond",
    }),
    retries: 3,
    timeout: 10_000,
  }),
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
import { Files } from "files-sdk";
import { gcs } from "files-sdk/gcs";
import { createFilesSpanExporter } from "@agentpond/files-sdk/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";

const sdk = new NodeSDK({
  traceExporter: createFilesSpanExporter({
    files: new Files({
      adapter: gcs({ bucket: "agentpond" }),
      retries: 3,
      timeout: 10_000,
    }),
  }),
  instrumentations: [/* OpenInference instrumentations */],
});

sdk.start();
// Run instrumented application code.
await sdk.shutdown();
```

NodeSDK wraps `traceExporter` in a `BatchSpanProcessor`. AgentPond preserves each exporter invocation as one immutable object-store object, so a batch of spans is written as one object. If you configure span processors directly, prefer `BatchSpanProcessor` for production and force-flush at the application's real lifecycle boundary.

## Storage adapters

Use the matching adapter for the deployment:

- `createFilesSpanExporterFromRuntimeEnv()` from
  `@agentpond/files-sdk/otel` for environment-driven Files SDK setup
- `createFilesSpanExporter()` from `@agentpond/files-sdk/otel` when the
  application already constructs a Files SDK client
- `createVercelSpanExporter()` from `@agentpond/vercel`
- `createFirebaseSpanExporter()` from `@agentpond/firebase`
- `createSupabaseSpanExporter()` from `@agentpond/supabase`

All of these paths converge on one `AgentPondSpanExporter` implementation. The
platform factories remain the recommended API when the application runs on
Vercel, Firebase, or Supabase: they preserve each platform's project,
credentials, bucket checks, and prefix rules.

Platform factories accept Files SDK `retries` and `timeout` options. They
default to three retries and a 10-second timeout.

The application needs write credentials for the selected object store.
`AGENTPOND_PROJECT_ID` defaults to `default-project`, and
`AGENTPOND_PREFIX` defaults to empty. An explicit `projectId` or `prefix` may
be passed to the exporter.

### Files SDK

For environment-driven setup, keep the adapter choice outside application code:

```ts
import { createFilesSpanExporterFromRuntimeEnv } from "@agentpond/files-sdk/otel";

const exporter = createFilesSpanExporterFromRuntimeEnv();
```

The helper reads `FILES_SDK_PROVIDER` and the selected adapter's typed
configuration from runtime environment variables. This allows the same
instrumentation code to use `fs` locally and a cloud adapter in production.
For Azure Blob Storage, configure:

```sh
FILES_SDK_PROVIDER=azure
AGENTPOND_FILES_CONTAINER=agentpond
AZURE_STORAGE_CONNECTION_STRING=<connection-string>
```

Files SDK also supports Azure account-name and account-key credentials; keep
those credential variables out of AgentPond environment files.

Other adapter-specific configuration uses the same runtime variables written by
`env init`:

- Netlify Blobs uses `AGENTPOND_FILES_STORE_NAME`.
- Oracle Cloud uses `AGENTPOND_FILES_BUCKET`,
  `AGENTPOND_FILES_NAMESPACE`, and `FILES_SDK_REGION`.

Netlify runtimes detect their site and token automatically; external runtimes
use `NETLIFY_SITE_ID` and `NETLIFY_API_TOKEN`. Oracle Cloud uses
`OCI_ACCESS_KEY_ID` and `OCI_SECRET_ACCESS_KEY` HMAC Customer Secret Keys.
Credentials remain in the provider variables documented by Files SDK.

Create Files SDK normally and pass the client to AgentPond:

```ts
import { Files } from "files-sdk";
import { r2 } from "files-sdk/r2";
import { createFilesSpanExporter } from "@agentpond/files-sdk/otel";

const exporter = createFilesSpanExporter({
  files: new Files({
    adapter: r2({
      bucket: "agentpond",
    }),
    retries: 3,
    timeout: 10_000,
  }),
});
```

The factory reads `AGENTPOND_PROJECT_ID` and `AGENTPOND_PREFIX`, defaulting the
project ID to `default-project`. Do not set the Files SDK `prefix` option for
this client; use `AGENTPOND_PREFIX` so the exporter and CLI resolve the same
keys.

Create and persist the matching CLI environment:

```sh
npx agentpond env init production \
  --provider r2 \
  --bucket agentpond
npx agentpond env use production
npx agentpond sync
```

AgentPond exposes `--bucket`, `--container`, `--endpoint`, `--namespace`,
`--region`, `--root`, and `--store-name` when required by the selected adapter.
It persists those values with the provider. Provider credentials remain ambient
in both the application runtime and the shell invoking AgentPond; AgentPond does
not write secrets into its environment file. `npx agentpond sync` always reads
the selected persistent environment and takes no storage flags.

### Firebase

Firebase users should start with `npx agentpond init`. The installed instrumentation skill owns the default-app, exporter, trusted-runtime, and Storage Rules workflow; see its [Firebase reference](../skills/agentpond-instrumentation/references/firebase.md).

After the application exports a trace, select the Firebase project, sync, and inspect it:

```sh
npx agentpond env use <alias-or-project-id>
npx agentpond sync
npx agentpond traces list --limit 25
```

### Vercel

Vercel users should start with `npx agentpond init --platform vercel`. The installed instrumentation skill links and provisions only after confirmation, then uses `createVercelSpanExporter()` in trusted Node.js server code. It never adds an ingestion route.

The helper derives the linked project and exact deployment target from Vercel system variables and writes below `agentpond/otel/<vercel-project-id>-<target>/`. Production is the CLI default; persist another target with `env use` or override it per command:

```sh
npx agentpond env use staging
npx agentpond sync
npx agentpond traces list --limit 25
```

### Supabase

Supabase users should start with `npx agentpond init --platform supabase`. The
installed instrumentation skill creates or reuses a dedicated private
`agentpond` bucket after confirmation, reviews Storage RLS, and uses
`createSupabaseSpanExporter()` in a Supabase Edge Function or trusted Node.js
backend. It never adds an ingestion route.

The helper derives the hosted project ref from `SUPABASE_URL` and writes below
`otel/<project-ref>/`. Persist a linked project or query another branch ref
without changing the link:

```sh
npx agentpond env use <project-ref>
npx agentpond --env <branch-project-ref> sync
npx agentpond traces list --limit 25
```

## Scope

The direct exporter writes spans and traces only. Langfuse client operations such as scores still need a compatible ingestion/API endpoint, or can be created with AgentPond CLI commands.

No `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, or `LANGFUSE_SECRET_KEY` is required for span export itself.
