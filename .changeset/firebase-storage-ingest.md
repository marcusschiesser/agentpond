---
"agentpond": patch
"@agentpond/aws": patch
"@agentpond/core": patch 
"@agentpond/duckdb": patch
"@agentpond/firebase": patch
"@agentpond/google": patch
"@agentpond/ingest": patch
---

Add zero-config Firebase ingestion and storage with monorepo detection, and unify CLI storage behavior behind environment contexts.

Breaking: `AgentPondEnvironment` no longer exposes `storeType`; storage selection is resolved separately when an object store is needed.
