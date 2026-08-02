# Setup

AgentPond supports two ways to send production traces to
[object storage](https://files-sdk.dev/docs/providers) supported by [Files SDK](https://files-sdk.dev):

1. **Direct object-store export with Files SDK:** a Node.js application
   writes spans directly to object storage. This is the setup configured by
   `npx agentpond init`.
2. **HTTP ingestion with Docker:** applications send Langfuse-compatible or
   OpenTelemetry requests to an AgentPond service, which writes them to object
   storage.

In both cases, object storage is the durable source of truth. The AgentPond CLI
syncs traces from that storage into a local DuckDB cache for analysis.

For platform-specific setup, see the [Firebase](./firebase.md),
[Supabase](./supabase.md), and [Vercel](./vercel.md) guides.

## 1. Direct object-store export with Files SDK

```text
Node.js application -> object storage -> npx agentpond sync -> local DuckDB
```

Use direct export when the application can safely hold narrowly scoped
object-store write credentials. It does not require an AgentPond HTTP service.

### Run the guided setup

From the application directory, inspect the setup path without making changes:

```sh
npx agentpond init check
npx agentpond init check --json
```

The check prints a concise verdict with the executing CLI version, detected
project, setup path, and next command. It does not write files, install
dependencies or skills, prompt, or require credentials. JSON output is intended
for automation and groups project detection, setup requirements, and concrete
package, telemetry, and configuration requirements. Unsupported results add one
structured reason and actionable next steps.

Then run the guided setup:

```sh
npx agentpond init
```

The command installs AgentPond's instrumentation and analytics skills and
prints a prompt for your coding agent. The agent then:

1. Inspects the Node.js application and its existing telemetry.
2. Proposes an OpenInference instrumentation and storage setup.
3. Adds `createFilesSpanExporterFromRuntimeEnv()` from
   `@agentpond/files-sdk/otel` after your confirmation.
4. Verifies one real trace with the dependency-free Files SDK filesystem
   adapter.
5. Helps you select and configure production object storage.

`npx agentpond init` does not itself edit application code, provision storage,
or initialize an AgentPond environment - your coding agent will do that using AgentPond's skills.

### Configure production object storage

Let the CLI prompt for a supported Files SDK provider:

```sh
npx agentpond env init production
```

For non-interactive setup, provide the adapter and its required options:

```sh
npx agentpond env init production --provider s3 --bucket agentpond
npx agentpond env init production --provider azure --container agentpond
npx agentpond env init production --provider gcs --bucket agentpond
npx agentpond env init production --provider r2 --bucket agentpond
npx agentpond env init production --provider minio --bucket agentpond --endpoint https://minio.example.com
npx agentpond env init production --provider netlify-blobs --store-name agentpond
npx agentpond env init production --provider oracle-cloud --bucket agentpond --namespace <namespace> --region eu-frankfurt-1
```

AgentPond stores the adapter configuration, `AGENTPOND_PROJECT_ID`, and optional
`AGENTPOND_PREFIX` in `.agentpond/envs/production.env`. Provider credentials
remain in the application and CLI process environments and are never written
by `env init`.

For Azure Blob Storage, install `@azure/storage-blob` next to Files SDK and set
either `AZURE_STORAGE_CONNECTION_STRING` or
`AZURE_STORAGE_ACCOUNT_NAME` with `AZURE_STORAGE_ACCOUNT_KEY` in both the
application runtime and the shell running AgentPond.

For Netlify Blobs, install `@netlify/blobs`; Netlify runtimes detect their site
and token automatically, while external runtimes use `NETLIFY_SITE_ID` and
`NETLIFY_API_TOKEN`. Oracle Cloud uses the AWS S3 client packages listed in the
direct-export guide with `OCI_ACCESS_KEY_ID` and `OCI_SECRET_ACCESS_KEY` HMAC
Customer Secret Keys.

The application and CLI must use the same Files SDK provider configuration,
project ID, prefix, and object-store credentials. The application installs the
peer client for the adapter it imports directly. After the application emits a
production trace:

```sh
npx agentpond env use production
npx agentpond sync
npx agentpond traces list --limit 25
```

See [Direct object-store export](../direct-object-store-export.md) for exporter
and instrumentation examples, and the
[Files SDK adapter catalog](https://files-sdk.dev/adapters) for
available storage adapters.

## 2. HTTP ingestion with Docker

```text
Application -> AgentPond HTTP service -> object storage -> npx agentpond sync -> local DuckDB
```

Use HTTP ingestion for non-Node applications, centralized object-store
credentials, or Langfuse-compatible operations such as score ingestion. The
application can use either Langfuse instrumentation or OpenInference with an
OTLP exporter.

### Run the local Docker stack

The repository's `docker-compose.yml` starts the AgentPond ingestion image and
a MinIO object store:

```sh
docker compose up -d
```

The ingestion service is available at `http://localhost:4318`, with these local
credentials:

```sh
export LANGFUSE_BASE_URL=http://localhost:4318
export LANGFUSE_PUBLIC_KEY=pk-agentpond
export LANGFUSE_SECRET_KEY=sk-agentpond
```

These credentials are for local testing only.

### Instrument with Langfuse

Install the Langfuse integration for the application's language and AI
framework, then configure it with the `LANGFUSE_BASE_URL`,
`LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY` values above. The SDK sends
traces and scores to AgentPond's Langfuse-compatible ingestion endpoint.

See the [basic Langfuse examples](../../examples/basic-traces/README.md) and
[LLM compliance example](../../examples/llm-compliance/README.md).

### Instrument with OpenInference

Install the OpenInference instrumentation for the application's language and AI
framework, then configure its OpenTelemetry HTTP exporter:

```sh
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/api/public/otel
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/api/public/otel/v1/traces
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic%20cGstYWdlbnRwb25kOnNrLWFnZW50cG9uZA=="
```

The authorization header contains the local Docker credentials shown above.
Use a newly generated public and secret key for a production deployment.

See the [OpenInference OpenAI examples](../../examples/openinference-openai/README.md)
for Python and TypeScript instrumentation.

### Sync traces from the Docker object store

Configure the CLI to read the MinIO bucket used by Docker Compose:

```sh
export MINIO_ACCESS_KEY_ID=minio
export MINIO_SECRET_ACCESS_KEY=minio123

npx agentpond env init docker \
  --provider minio \
  --bucket agentpond \
  --endpoint http://localhost:9000
npx agentpond env use docker
npx agentpond sync
npx agentpond traces list --limit 10
```

### Deploy the ingestion service

Deploy `ghcr.io/marcusschiesser/agentpond` to a container platform and
configure:

- `FILES_SDK_PROVIDER` and the selected adapter's bucket, container, endpoint,
  namespace, region, root, or store name
- provider credentials with permission to write trace objects
- `AGENTPOND_PROJECT_ID` and optional `AGENTPOND_PREFIX`
- unique `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` values

Expose the service through HTTPS and configure the application SDK or OTLP
exporter with its public URL. Configure a matching AgentPond CLI environment to
read the same object storage.

See the [Deployment reference](../deployment.md) for AWS, Google Cloud, and
custom container infrastructure.

## Local HTTP testing without Docker

For application instrumentation tests, `npx agentpond dev` starts a local HTTP
ingestion server that writes directly to DuckDB:

```sh
npx agentpond dev
```

In another shell, load its Langfuse and OTLP settings:

```sh
eval "$(npx agentpond env get dev)"
```

The dev server does not use object storage and is not a durable or shared
deployment.
