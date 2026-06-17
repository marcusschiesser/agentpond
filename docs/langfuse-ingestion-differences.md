# Differences From Langfuse Ingestion

## Shared Ingestion Baseline

Both AgentPond and Langfuse validate incoming events and preserve raw trace data before projecting it for analysis.

Both designs separate durable event capture from analytical querying.

## Langfuse Flow

Langfuse stores raw ingestion data, queues processing references, runs background workers, and writes analytical records to ClickHouse.

This design supports a continuously running production service with asynchronous projection into a shared OLAP database.

## Main Differences

- AgentPond uses manifest-based pull sync instead of queue-driven workers.
- AgentPond uses local DuckDB instead of requiring a hosted ClickHouse service for analysis.
- AgentPond keeps the raw event model in object storage, so the analysis layer can evolve independently.

## Why This Design

AgentPond keeps ingestion simple to operate while preserving a scalable object-storage foundation.

Local DuckDB works well for private and team analysis, even in large Enterprises. If local analysis is not enough, a shared remote analysis store can be added later without changing the raw event model.

## Operational Choice

AgentPond keeps ingestion independent from analysis. Raw events can be accepted and stored with minimal infrastructure; DuckDB projection runs separately when local analysis is needed.

This keeps the system simple now while leaving room for a shared analysis store later.
