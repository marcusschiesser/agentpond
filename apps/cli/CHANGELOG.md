# agentpond

## 0.4.0

### Minor Changes

- cb018d2: Add Vercel Blob object storage support with `AGENTPOND_STORE=vercel`.

### Patch Changes

- 8ffc5dd: Print OpenTelemetry env vars by default and map OpenInference and Vercel AI SDK OTEL spans to AgentPond observation types.
- Updated dependencies [b81bac2]
- Updated dependencies [8ffc5dd]
- Updated dependencies [8c73e70]
- Updated dependencies [75e592d]
- Updated dependencies [cb018d2]
  - @agentpond/duckdb@0.3.3
  - @agentpond/core@0.4.0
  - @agentpond/vercel@0.4.0
  - @agentpond/aws@0.3.4
  - @agentpond/fastify-ingest@0.3.3
  - @agentpond/google@0.3.3

## 0.3.5

### Patch Changes

- e06acf4: Support Hugging Face Storage Buckets by following redirected object downloads.
- Updated dependencies [e06acf4]
  - @agentpond/aws@0.3.3

## 0.3.4

### Patch Changes

- 80d86d1: Support configuring AWS SDK S3 checksum behavior for S3-compatible storage providers such as Hugging Face Storage Buckets.
- Updated dependencies [80d86d1]
  - @agentpond/aws@0.3.2
  - @agentpond/core@0.3.2
  - @agentpond/duckdb@0.3.2
  - @agentpond/fastify-ingest@0.3.2
  - @agentpond/google@0.3.2

## 0.3.3

### Patch Changes

- Updated dependencies [113f5d6]
- Updated dependencies [3dd8d6e]
  - @agentpond/core@0.3.1
  - @agentpond/duckdb@0.3.1
  - @agentpond/aws@0.3.1
  - @agentpond/fastify-ingest@0.3.1
  - @agentpond/google@0.3.1

## 0.3.2

### Patch Changes

- Updated dependencies [faa24c2]
- Updated dependencies [faa24c2]
- Updated dependencies [faa24c2]
- Updated dependencies [faa24c2]
- Updated dependencies [faa24c2]
- Updated dependencies [faa24c2]
  - @agentpond/aws@0.3.0
  - @agentpond/google@0.3.0
  - @agentpond/fastify-ingest@0.3.0
  - @agentpond/core@0.3.0
  - @agentpond/duckdb@0.3.0

## 0.3.1

### Patch Changes

- 1100c0d: Fix the npm README image for the How it works diagram.

## 0.3.0

### Minor Changes

- 66f2583: Add Google Cloud Storage object-store support, store selection during environment initialization, split cloud SDK integrations into provider packages, and add provider serverless ingestion handlers.
- 5f6b2e0: Require Node.js 24 or newer for the AgentPond CLI.

### Patch Changes

- f75bd8c: Migrate the CLI to Commander and add interactive environment selection with Inquirer prompts.
- 336ff84: Publish production AgentPond ingestion service images to the public GitHub Container Registry on release.
- 25f4b0a: Publish reusable AgentPond libraries to npm and externalize them from app bundles.
- Updated dependencies [25f4b0a]
  - @agentpond/aws@0.2.0
  - @agentpond/core@0.2.0
  - @agentpond/duckdb@0.2.0
  - @agentpond/fastify-ingest@0.2.0
  - @agentpond/google@0.2.0

## 0.2.0

### Minor Changes

- 3202c0a: Add a local `agentpond dev` ingestion server that writes directly to the dev DuckDB cache, makes dev sync a no-op, and blocks competing dev writes.
- 3202c0a: Add named environments with per-environment DuckDB caches and environment-file based storage configuration using `agentpond env`.

### Patch Changes

- 3202c0a: Create traces for Langfuse OTEL spans marked as app roots.

## 0.1.3

### Patch Changes

- bfed524: Simplify DuckDB sync projection by using one timestamp-ordered projection path for fresh and non-empty caches.
- 7f13eb1: Reduce memory usage during large object-store syncs by committing bounded DuckDB projection batches.

## 0.1.2

### Patch Changes

- f954296: Make observation list ordering stable when observations share a start time.
- 09684a2: Default the DuckDB cache to the current repository directory instead of the user's home directory.
- 6a4681e: Speed up DuckDB sync by batching raw event writes and timestamp-ordered projection, and rename the cache class to AgentPondCache.
- 8e5de51: Use UTC time-bucket sync for OTEL payloads and non-OTEL score manifests.

## 0.1.1

### Patch Changes

- 8310a93: Add an AgentPond skill with CLI, DuckDB schema, ingestion, and trace-analysis guidance for coding agents.
- e82eeb9: Publish AgentPond under the MIT license.
- 0a10f8c: Replace the deprecated `duckdb` package with `@duckdb/node-api` to remove deprecated transitive install warnings from npm installs.

## 0.1.0

### Minor Changes

- 69c44db: Initial release of AgentPond CLI published to npm.
