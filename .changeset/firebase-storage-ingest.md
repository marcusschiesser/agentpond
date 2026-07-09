---
"agentpond": patch
"@agentpond/aws": patch
"@agentpond/core": patch
"@agentpond/firebase": patch
"@agentpond/google": patch
"@agentpond/ingest": patch
---

Add zero-config support for Firebase: Firebase optimized ingest function and storage (using the storage bucket assigned to the project, so no new infrastructure needed). Includes auto-detection of Firebase environments (works also for monorepos).
