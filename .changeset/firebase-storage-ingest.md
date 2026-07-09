---
"agentpond": patch
"@agentpond/aws": patch
"@agentpond/core": patch
"@agentpond/firebase": patch
"@agentpond/google": patch
"@agentpond/ingest": patch
---

Add zero-config support for Firebase, including Firebase CLI auto-detection from `.firebaserc` or `firebase.json` monorepos, Firebase project-id cache environments, workspace-root CLI cache resolution, a Firebase optimized ingest function, Firebase Storage Rules guidance for the `agentpond/` trace prefix, and pnpm install policy support for Firebase dependencies.
