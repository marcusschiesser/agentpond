# @agentpond/aws

## 0.3.6

### Patch Changes

- Updated dependencies [710fd11]
  - @agentpond/core@0.4.2
  - @agentpond/ingest@0.3.5

## 0.3.5

### Patch Changes

- d00fb6a: Add zero-config support for Firebase: Firebase optimized ingest function and storage (using the storage bucket assigned to the project, so no new infrastructure needed). Includes auto-detection of Firebase environments (works also for monorepos).
- Updated dependencies [59084e9]
- Updated dependencies [d00fb6a]
- Updated dependencies [871339c]
  - @agentpond/core@0.4.1
  - @agentpond/ingest@0.3.4

## 0.3.4

### Patch Changes

- Updated dependencies [da32a31]
- Updated dependencies [8ffc5dd]
- Updated dependencies [cb018d2]
  - @agentpond/ingest@0.3.3
  - @agentpond/core@0.4.0

## 0.3.3

### Patch Changes

- e06acf4: Support Hugging Face Storage Buckets by following redirected object downloads.

## 0.3.2

### Patch Changes

- 80d86d1: Support configuring AWS SDK S3 checksum behavior for S3-compatible storage providers such as Hugging Face Storage Buckets.
- Updated dependencies [80d86d1]
  - @agentpond/core@0.3.2
  - @agentpond/ingest@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies [113f5d6]
  - @agentpond/core@0.3.1
  - @agentpond/ingest@0.3.1

## 0.3.0

### Minor Changes

- faa24c2: Add explicit object-store config constructors for Google Cloud Storage and S3.
- faa24c2: Simplify ingestion adapters with auth options and sink-owned object-store prefixes.
- faa24c2: Align ingestion APIs around sinks and add object-store sink factories.

### Patch Changes

- Updated dependencies [faa24c2]
- Updated dependencies [faa24c2]
- Updated dependencies [faa24c2]
  - @agentpond/ingest@0.3.0
  - @agentpond/core@0.3.0

## 0.2.0

### Minor Changes

- 25f4b0a: Publish reusable AgentPond libraries to npm and externalize them from app bundles.

### Patch Changes

- Updated dependencies [25f4b0a]
  - @agentpond/core@0.2.0
  - @agentpond/ingest@0.2.0
