# @agentpond/files-sdk

## 0.3.2

### Patch Changes

- Updated dependencies [3248cf3]
- Updated dependencies [df67ad9]
  - @agentpond/otel@0.1.8
  - @agentpond/core@0.8.2

## 0.3.1

### Patch Changes

- Updated dependencies [ad333ea]
  - @agentpond/core@0.8.1
  - @agentpond/otel@0.1.7

## 0.3.0

### Minor Changes

- 2686ab9: Add Netlify Blobs and Oracle Cloud Object Storage support to Files SDK environments, the CLI, and the ingestion service.
- 4e595b6: Consolidate Vercel, Supabase, and Firebase storage on Files SDK adapters, add named `FilesObjectStore.fromFiles` construction, expose retry and timeout settings on platform exporters, and keep optional Firebase Admin loading lazy.

### Patch Changes

- Updated dependencies [2686ab9]
  - @agentpond/core@0.8.0
  - @agentpond/otel@0.1.6

## 0.2.0

### Minor Changes

- bf77db3: Add Azure Blob Storage support to Files SDK environments and the AgentPond CLI.

### Patch Changes

- Updated dependencies [bf77db3]
  - @agentpond/core@0.7.0
  - @agentpond/otel@0.1.5

## 0.1.0

### Minor Changes

- b5a6ce0: Consolidate manual remote storage and container ingestion on Files SDK, validate adapter-required configuration for supported bucket providers, remove legacy local, S3, and GCS environment formats, keep persistent storage settings authoritative, reject accidental environment reinitialization, and keep platform-native Firebase, Supabase, and Vercel storage.
- 7c7a8c0: Support Files SDK projects in `agentpond init`, add dependency-free filesystem environments for real trace verification, and provide an environment-driven Files SDK span exporter.

### Patch Changes

- Updated dependencies [b5a6ce0]
- Updated dependencies [7c7a8c0]
  - @agentpond/core@0.6.0
  - @agentpond/otel@0.1.4
