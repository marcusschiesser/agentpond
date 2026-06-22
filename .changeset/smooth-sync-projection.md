---
"@agentpond/duckdb": patch
---

Speed up DuckDB sync by batching raw event writes and timestamp-ordered projection, and rename the cache class to AgentPondCache.
