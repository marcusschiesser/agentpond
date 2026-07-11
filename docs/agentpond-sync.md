# AgentPond Sync

## Goal

AgentPond stores raw OTEL payloads and Langfuse-compatible score ingestion events in remote object storage (e.g. S3) and uses DuckDB as a local query cache. Object storage is the durable source of truth; DuckDB is the materialized analysis layer. For S3-compatible providers such as Hugging Face Storage Buckets, configure `AGENTPOND_S3_ENDPOINT` and checksum settings according to the provider docs: <https://huggingface.co/docs/hub/storage-buckets-s3>.

## Write Path

OTEL ingestion validates and decodes trace export requests, then stores raw `resourceSpans` under UTC minute buckets:

```txt
<prefix>otel/<project-id>/<yyyy>/<mm>/<dd>/<hh>/<min>/<batch-id>.json
```

Non-OTEL ingestion remains for Langfuse SDK scores. Accepted non-OTEL events are grouped by entity, written under the configured project prefix, and referenced by a UTC minute-bucketed manifest:

```txt
<prefix><project-id>/score/<score-id>/<event-id>.json
<prefix><project-id>/manifests/<yyyy>/<mm>/<dd>/<hh>/<min>/<batch-id>.json
```

## Sync Flow

`npx agentpond sync` scans UTC bucket windows for both sources:

- OTEL objects are read directly from `otel/<project-id>/...` and normalized during sync.
- Non-OTEL manifests are read from `<project-id>/manifests/...`; sync then reads their referenced event objects.

Every normalized event is written to `events_raw` and projected into `traces`, `observations`, and `scores`.

The `sessions` relation is a DuckDB view derived from traces with session IDs.

## Idempotency

DuckDB tracks imported OTEL objects and non-OTEL event objects in `processed_objects`. Non-OTEL manifests are tracked in `processed_manifests`.

DuckDB also stores per-source UTC bucket watermarks. The first sync scans all current-layout source keys; later syncs rescan recent buckets for late writes and skip already processed object or manifest keys.

## Query Model

Users can query both raw and projected data with local SQL. The raw table keeps the full event payload, while projected tables provide convenient trace, observation, score, and session views for analysis.
