---
"@agentpond/files-sdk": minor
"@agentpond/firebase": minor
"@agentpond/supabase": minor
"@agentpond/vercel": minor
"@agentpond/ingest-service": minor
"agentpond": patch
---

Upgrade shared storage to Files SDK 3.1 and support Google Cloud Storage 8 without a peer dependency allowance. Storage integrations now require Node.js 22 or later; applications supplying their own Files client must upgrade to Files SDK 3.1 or later in the 3.x line. Existing AgentPond storage configuration and stored traces remain compatible.
