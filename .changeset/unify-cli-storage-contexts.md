---
"agentpond": patch
"@agentpond/core": major
"@agentpond/duckdb": patch
"@agentpond/firebase": patch
---

Unify CLI storage behavior behind environment contexts.

Breaking: `AgentPondEnvironment` no longer exposes `storeType`; storage selection is resolved separately when an object store is needed.
