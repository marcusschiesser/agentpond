# @agentpond/firebase

## 0.7.0

### Minor Changes

- 4e595b6: Consolidate Vercel, Supabase, and Firebase storage on Files SDK adapters, add named `FilesObjectStore.fromFiles` construction, expose retry and timeout settings on platform exporters, and keep optional Firebase Admin loading lazy.

### Patch Changes

- Updated dependencies [2686ab9]
- Updated dependencies [4e595b6]
  - @agentpond/core@0.8.0
  - @agentpond/files-sdk@0.3.0
  - @agentpond/ingest@0.3.10
  - @agentpond/otel@0.1.6

## 0.6.1

### Patch Changes

- Updated dependencies [bf77db3]
  - @agentpond/core@0.7.0
  - @agentpond/ingest@0.3.9
  - @agentpond/otel@0.1.5

## 0.6.0

### Minor Changes

- b5a6ce0: Consolidate manual remote storage and container ingestion on Files SDK, validate adapter-required configuration for supported bucket providers, remove legacy local, S3, and GCS environment formats, keep persistent storage settings authoritative, reject accidental environment reinitialization, and keep platform-native Firebase, Supabase, and Vercel storage.

### Patch Changes

- 7c7a8c0: Use the Firebase runtime project ID for Firebase HTTP ingestion.
- Updated dependencies [b5a6ce0]
- Updated dependencies [7c7a8c0]
  - @agentpond/core@0.6.0
  - @agentpond/ingest@0.3.8
  - @agentpond/otel@0.1.4

## 0.5.1

### Patch Changes

- Updated dependencies [7874a1b]
  - @agentpond/core@0.5.1
  - @agentpond/google@0.3.7
  - @agentpond/ingest@0.3.7
  - @agentpond/otel@0.1.3

## 0.5.0

### Minor Changes

- 77afda6: Add automatic Vercel setup with target-aware direct span export to private Blob storage, SDK-managed runtime OIDC refresh, and provider-aware environment selection.

### Patch Changes

- Updated dependencies [77afda6]
  - @agentpond/core@0.5.0
  - @agentpond/google@0.3.6
  - @agentpond/ingest@0.3.6
  - @agentpond/otel@0.1.2

## 0.4.2

### Patch Changes

- 05f8478: Honor active Firebase CLI project selections even when `.firebaserc` is absent.

## 0.4.1

### Patch Changes

- Updated dependencies [710fd11]
  - @agentpond/core@0.4.2
  - @agentpond/google@0.3.5
  - @agentpond/ingest@0.3.5
  - @agentpond/otel@0.1.1

## 0.4.0

### Minor Changes

- 59084e9: Add a Node.js OpenTelemetry exporter that writes traces directly to AgentPond object storage without an ingestion service.

  For Langfuse instrumentation, pass the exporter as `new LangfuseSpanProcessor({ exporter })`. For OpenInference or other standard OpenTelemetry instrumentation, use it as the Node SDK's `traceExporter` or wrap it in an OpenTelemetry span processor. The exporter stores OTLP JSON resource spans under the existing `otel/<project-id>/...` layout, so `agentpond sync` reads them without any CLI or storage migration.

  Firebase applications can use `createFirebaseSpanExporter()` to derive the project ID and storage bucket from the initialized default Firebase Admin app.

### Patch Changes

- d00fb6a: Add zero-config support for Firebase: Firebase optimized ingest function and storage (using the storage bucket assigned to the project, so no new infrastructure needed). Includes auto-detection of Firebase environments (works also for monorepos).
- 871339c: Unify CLI storage behavior behind environment contexts.

  Breaking: `AgentPondEnvironment` no longer exposes `storeType`; storage selection is resolved separately when an object store is needed.

- Updated dependencies [59084e9]
- Updated dependencies [d00fb6a]
- Updated dependencies [871339c]
  - @agentpond/otel@0.1.0
  - @agentpond/core@0.4.1
  - @agentpond/google@0.3.4
  - @agentpond/ingest@0.3.4

## 0.3.3

### Patch Changes

- Initial Firebase Storage ingestion adapter package.
