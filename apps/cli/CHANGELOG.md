# agentpond

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
