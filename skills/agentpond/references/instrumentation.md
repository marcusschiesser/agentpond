# Langfuse-Compatible Ingestion

AgentPond accepts Langfuse-compatible ingestion from existing Langfuse SDK integrations. Use this when an application should send trace data to AgentPond instead of a hosted observability service.

## Environment

Point the SDK at the AgentPond ingestion service:

```bash
export LANGFUSE_BASE_URL=http://localhost:3030
export LANGFUSE_PUBLIC_KEY=pk-agentpond
export LANGFUSE_SECRET_KEY=sk-agentpond
```

The public and secret keys are used by the ingestion service. Do not ask users to paste real keys into chat; ask them to set environment variables or store them in an `.env` file.

## Workflow

1. Configure the application with the Langfuse SDK and AgentPond ingestion URL.
2. Run the application path that emits traces.
3. Sync AgentPond object storage into the local DuckDB cache:

```bash
npx agentpond sync
```

4. Inspect the resulting trace data:

```bash
npx agentpond traces list --limit 25
npx agentpond observations list --traceId <trace-id>
npx agentpond scores list --traceId <trace-id>
```

Use `npx agentpond sql "..."` for analysis that needs aggregation, joins, JSON inspection, or custom filtering.
