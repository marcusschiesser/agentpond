# agentpond

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
