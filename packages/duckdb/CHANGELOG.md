# @agentpond/duckdb

## 0.3.6

### Patch Changes

- Updated dependencies [710fd11]
  - @agentpond/core@0.4.2

## 0.3.5

### Patch Changes

- 871339c: Unify CLI storage behavior behind environment contexts.

  Breaking: `AgentPondEnvironment` no longer exposes `storeType`; storage selection is resolved separately when an object store is needed.

- Updated dependencies [59084e9]
- Updated dependencies [d00fb6a]
- Updated dependencies [871339c]
  - @agentpond/core@0.4.1

## 0.3.4

### Patch Changes

- ce9373a: Retry transient DuckDB read locks so CLI read commands are more resilient while the dev server is writing.

## 0.3.3

### Patch Changes

- b81bac2: Merge projected trace, observation, and score fields across partial Langfuse events.
- 8c73e70: Reduce DuckDB sync write amplification by storing raw event bodies once and exposing compatible raw event JSON through a view.
- 75e592d: Match Langfuse recursive metadata merge semantics for projected traces and observations.
- Updated dependencies [8ffc5dd]
- Updated dependencies [cb018d2]
  - @agentpond/core@0.4.0

## 0.3.2

### Patch Changes

- Updated dependencies [80d86d1]
  - @agentpond/core@0.3.2

## 0.3.1

### Patch Changes

- 113f5d6: Allow environment path resolution and DuckDB ingestion sinks to use detected workspace roots from nested packages.
- 3dd8d6e: Serialize local DuckDB writes and retry transient lock conflicts during ingestion.
- Updated dependencies [113f5d6]
  - @agentpond/core@0.3.1

## 0.3.0

### Minor Changes

- faa24c2: Simplify ingestion adapters with auth options and sink-owned object-store prefixes.

### Patch Changes

- Updated dependencies [faa24c2]
- Updated dependencies [faa24c2]
- Updated dependencies [faa24c2]
  - @agentpond/core@0.3.0

## 0.2.0

### Minor Changes

- 25f4b0a: Publish reusable AgentPond libraries to npm and externalize them from app bundles.

### Patch Changes

- Updated dependencies [25f4b0a]
  - @agentpond/core@0.2.0
