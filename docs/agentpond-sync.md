# AgentPond Sync

## Goal

AgentPond stores raw OTEL payloads and Langfuse-compatible score ingestion
events in persistent object storage and uses DuckDB as a local query cache.
Manual environments resolve their storage through Files SDK; Firebase,
Supabase, and Vercel retain their platform-native storage adapters. Object
storage is the durable source of truth, and DuckDB is the materialized analysis
layer.

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

`sync` reads the persistent environment selected by
`npx agentpond env use <name>`. It has no storage-selection flags. The
environment contains `FILES_SDK_PROVIDER`, the selected adapter's typed bucket,
endpoint, region, or root configuration, the project ID, and the key prefix;
provider credentials remain ambient.

## Idempotency

DuckDB tracks imported OTEL objects and non-OTEL event objects in `processed_objects`. Non-OTEL manifests are tracked in `processed_manifests`.

DuckDB also stores per-source UTC bucket watermarks. The first sync scans all current-layout source keys; later syncs rescan recent buckets for late writes and skip already processed object or manifest keys.

### Recreate the cache after projection changes

Projected rows are not recalculated for objects that the local cache has already
marked as processed. After upgrading to a release that changes projection
semantics, including the trace start-time fix, users must recreate each
object-storage-backed analytical cache before syncing again.

First stop any AgentPond process using the selected environment, then inspect the
cache path:

```bash
npx agentpond env current --json
```

Delete only the reported `dbPath` (normally
`.agentpond/envs/<name>/cache.duckdb`) and rebuild it from durable object storage:

```bash
rm .agentpond/envs/<name>/cache.duckdb
npx agentpond sync
```

Do not delete the environment configuration or any object-storage data. The
`dev` environment has no object-storage source of truth, so deleting its cache
discards its local-only traces instead of rebuilding them.

## Query Model

Users can query both raw and projected data with local SQL. The raw table keeps the full event payload, while projected tables provide convenient trace, observation, score, and session views for analysis.
