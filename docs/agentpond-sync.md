# AgentPond Sync

## Goal

AgentPond stores raw ingestion events in a remote object storage (e.g. S3) and uses DuckDB as a local query cache. Object storage is the durable source of truth; DuckDB is the materialized analysis layer.

## Write Path

Ingestion validates incoming events before accepting them. Accepted events are grouped by entity, such as trace, observation, score, or event.

Each group is written as a JSON object under the configured object-store prefix and project ID. With `AGENTPOND_S3_PREFIX=archive/` and `AGENTPOND_PROJECT_ID=project-a`, trace objects are written under paths like `archive/project-a/trace/<trace-id>/<event-id>.json`.

A batch manifest is then written under the same prefix and project ID, in `archive/project-a/manifests/...`, and references all entity objects in the accepted batch.

## Sync Flow

`agentpond sync` lists manifests for the configured object-store prefix and project ID.

For each new manifest, sync reads the referenced event objects, writes every event to `events_raw` table in DuckDB, and projects typed rows into `traces`, `observations`, and `scores` tables.

The `sessions` relation is a DuckDB view derived from traces with session IDs.

## Idempotency

DuckDB tracks imported manifests in `processed_manifests` and imported event objects in `processed_objects`.

Running sync repeatedly is safe: already processed manifests and objects are skipped.

## Query Model

Users can query both raw and projected data with local SQL. The raw table keeps the full event payload, while projected tables provide convenient trace, observation, score, and session views for analysis.
