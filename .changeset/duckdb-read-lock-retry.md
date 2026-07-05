"@agentpond/duckdb": patch

Retry transient DuckDB read locks so CLI read commands are more resilient while the dev server is writing.
