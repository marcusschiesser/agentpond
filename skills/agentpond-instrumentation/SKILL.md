---
name: agentpond-instrumentation
description: Add OpenInference tracing to trusted Firebase or Vercel Node.js applications and export spans directly to AgentPond storage. Use when instrumenting an untraced AI server, adding a missing OpenInference integration, or adapting existing OpenTelemetry setup for Firebase Storage or Vercel Blob.
---

# AgentPond Instrumentation

Instrument trusted Node.js AI applications without changing business behavior. Analyze the target service first, reuse existing tracing infrastructure, and keep storage credentials and trace export strictly server-side.

Read only the references relevant to the detected provider:

- Firebase exporter and Storage Rules: [references/firebase.md](references/firebase.md)
- Vercel exporter, Blob setup, targets, and lifecycle: [references/vercel.md](references/vercel.md)
- OpenInference routing, custom spans, sessions, and verification: [references/openinference.md](references/openinference.md)

## Core principles

- Inspect before editing. Confirm the service, runtime, package manager, AI SDK, framework, provider, and existing telemetry.
- Instrument only trusted Node.js server code. Never put AgentPond storage exporters in browser, client, middleware, Edge, or static bundles.
- Prefer framework or provider auto-instrumentation. Add manual spans only for application logic, chains, tools, or gaps.
- Reuse the existing provider SDK and global OpenTelemetry provider. Do not register a competing provider.
- Initialize tracing before importing or constructing instrumented AI clients.
- Export directly to the provider's object store. Do not add an ingestion HTTP route.
- Keep tracing additive and follow the repository's conventions.
- Never add credentials to source code or ask the user to paste secrets into chat.

## Phase 0: preflight

1. Detect Firebase or Vercel project markers. If both exist, ask which platform owns the deployed service; do not persist that choice.
2. Confirm which trusted Node.js service is in scope. In a monorepo, do not assume every server package should be instrumented.
3. Identify the build, typecheck, start, emulator or deployment, and real-request commands needed for verification.
4. Stop if the target is only client, middleware, Edge, or static code and ask whether the user wants to add a trusted Node.js function or server.
5. Read the matching provider reference before proposing changes.

## Phase 1: read-only analysis

Do not write files, install packages, link projects, or provision storage during this phase.

1. Inspect provider configuration, package manifests, lockfiles, server entrypoints, and existing storage connections.
2. Scan imports to identify AI providers, agent frameworks, existing OpenInference or OpenTelemetry setup, provider SDK initialization, and request, conversation, and tool boundaries.
3. Review provider-specific privacy and credential requirements from its reference.
4. Prefer a framework-native OpenInference integration when it captures model and tool spans. Add a provider instrumentor only for a documented gap.
5. Return a concise proposal containing the target service, runtime, package manager, AI SDKs, packages, provider resources, existing initialization to reuse, files, and verification commands.

Stop after presenting the proposal and ask for explicit confirmation before installing packages, editing files, linking a Vercel project, provisioning Blob, or changing Firebase Storage Rules.

## Phase 2: implementation

1. Read current official integration documentation for the detected framework or AI client.
2. Install the provider package (`@agentpond/firebase` or `@agentpond/vercel`), required OpenTelemetry packages, and the matching `@arizeai/openinference-*` package.
3. Create or update one centralized server instrumentation module.
4. Reuse existing provider and OpenTelemetry initialization, following the matching provider reference.
5. Create the provider's direct span exporter and attach it to the existing provider. When none exists, prefer NodeSDK's batched `traceExporter` configuration or an explicit `BatchSpanProcessor` supported by the installed version.
6. Register OpenInference instrumentation before AI clients are created.
7. Add manual CHAIN and TOOL spans only where auto-instrumentation leaves important behavior invisible.
8. Preserve one `session.id` across all turns in the same conversation.
9. Apply the provider-specific privacy, target, and flush requirements before declaring completion.

## Verification

Treat the work as complete only when the project builds or typechecks, the Node.js service loads without duplicate-provider errors, one real AI request exports OpenInference spans, and the trace appears after the provider-specific sync command in its reference.

Inspect the trace and confirm applicable model, CHAIN, TOOL, input/output, parent-child, and session attributes. For short-lived processes, force-flush before exit. Do not shut down a reusable module-level provider after every request.

## Attribution

This workflow is adapted from Arize AI's MIT-licensed [arize-instrumentation skill](https://github.com/Arize-ai/arize-skills/tree/main/skills/arize-instrumentation). It replaces Arize-specific export and verification with AgentPond direct export to Firebase Storage or Vercel Blob while retaining the analyze-then-implement workflow.
