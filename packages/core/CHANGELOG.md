# @agentpond/core

## 0.4.0

### Minor Changes

- cb018d2: Add Vercel Blob object storage support with `AGENTPOND_STORE=vercel`.

### Patch Changes

- 8ffc5dd: Print OpenTelemetry env vars by default and map OpenInference and Vercel AI SDK OTEL spans to AgentPond observation types.

## 0.3.2

### Patch Changes

- 80d86d1: Support configuring AWS SDK S3 checksum behavior for S3-compatible storage providers such as Hugging Face Storage Buckets.

## 0.3.1

### Patch Changes

- 113f5d6: Allow environment path resolution and DuckDB ingestion sinks to use detected workspace roots from nested packages.

## 0.3.0

### Minor Changes

- faa24c2: Simplify ingestion adapters with auth options and sink-owned object-store prefixes.
- faa24c2: Align ingestion APIs around sinks and add object-store sink factories.

### Patch Changes

- faa24c2: Update dependency constraints to remove vulnerable OpenTelemetry and UUID versions.

## 0.2.0

### Minor Changes

- 25f4b0a: Publish reusable AgentPond libraries to npm and externalize them from app bundles.
