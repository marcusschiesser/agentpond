# @agentpond/files-sdk

## 0.1.0

### Minor Changes

- b5a6ce0: Consolidate manual remote storage and container ingestion on Files SDK, validate adapter-required configuration for supported bucket providers, remove legacy local, S3, and GCS environment formats, keep persistent storage settings authoritative, reject accidental environment reinitialization, and keep platform-native Firebase, Supabase, and Vercel storage.
- 7c7a8c0: Support Files SDK projects in `agentpond init`, add dependency-free filesystem environments for real trace verification, and provide an environment-driven Files SDK span exporter.

### Patch Changes

- Updated dependencies [b5a6ce0]
- Updated dependencies [7c7a8c0]
  - @agentpond/core@0.6.0
  - @agentpond/otel@0.1.4
