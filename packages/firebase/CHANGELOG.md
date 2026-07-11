# @agentpond/firebase

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
