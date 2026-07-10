---
"@agentpond/otel": minor
"@agentpond/core": patch
"@agentpond/firebase": minor
---

Add a Node.js OpenTelemetry exporter that writes traces directly to AgentPond object storage without an ingestion service.

For Langfuse instrumentation, pass the exporter as `new LangfuseSpanProcessor({ exporter })`. For OpenInference or other standard OpenTelemetry instrumentation, use it as the Node SDK's `traceExporter` or wrap it in an OpenTelemetry span processor. The exporter stores OTLP JSON resource spans under the existing `otel/<project-id>/...` layout, so `agentpond sync` reads them without any CLI or storage migration.

Firebase applications can use `createFirebaseSpanExporter()` to derive the project ID and storage bucket from the initialized default Firebase Admin app.
