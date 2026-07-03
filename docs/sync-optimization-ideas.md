# Sync Optimization Ideas

This note tracks follow-up ideas for reducing DuckDB sync latency after the
Langfuse-style merge projection work.

## Current Cost Shape

The 10k trace benchmark is now below 6 seconds for initial sync, but the largest
remaining costs are still outside simple DuckDB appends:

- Loading objects from storage and converting OTEL resource spans to events.
- Building raw rows and projected rows from intermediate `IngestionEvent`
  objects.
- Merging trace and observation projection rows, especially metadata and IO
  fields.

Current 10k trace sync timings:

| Run | Initial Sync | No-Op Sync |
| --- | ---: | ---: |
| Final optimized merge projection | 5.80-5.88s | ~22-23ms |

Current representative profiled cost shape:

| Phase | Time |
| --- | ---: |
| Object load + OTEL conversion | 2.86-2.90s |
| Raw row normalization | 0.28-0.30s |
| Projection total | ~1.70s |
| Bookkeeping | ~0.002s |

Current representative projection subphase profile:

| Projection Subphase | Time |
| --- | ---: |
| Trace projection | ~0.24s |
| Observation projection | ~0.62s |
| Raw append | ~0.47s |
| Cost rollup | ~0.11s |

## Optimization Ideas

### Pipeline Object Loading and Projection

Sync currently spends time loading/converting objects and then projecting the
resulting event batch. A bounded pipeline could overlap these phases:

1. List pending object keys.
2. Load and convert objects concurrently with a small worker pool.
3. Feed converted batches into a projection/write queue.
4. Keep DuckDB writes serialized, but keep storage reads and OTEL conversion
   ahead of the writer.

This targets the largest remaining wall-clock cost without changing projection
semantics.

### Parse OTEL Directly Into Raw Rows

The current sync path converts:

```text
OTEL resourceSpans -> IngestionEvent[] -> RawEventRow[]
```

For OTEL object sync, we can skip the intermediate `IngestionEvent[]` allocation
and produce `RawEventRow` records directly from spans. The existing
`IngestionEvent` path can remain for non-OTEL ingestion and compatibility tests.

Expected benefits:

- Fewer allocations.
- Less repeated field extraction.
- Less JSON serialization during sync.

### Build Projection Rows During OTEL Conversion

OTEL conversion already parses trace IDs, span IDs, timestamps, Langfuse
attributes, usage, costs, metadata, input, and output. Instead of later
normalizing those event bodies again in projection, the converter could emit a
sync-specific batch structure:

```ts
type SyncBatchRows = {
  rawRows: RawEventRow[];
  traceRows: TraceProjectionDelta[];
  observationRows: ObservationProjectionDelta[];
  scoreRows: ScoreProjectionDelta[];
};
```

Projection would then merge pre-normalized deltas instead of rebuilding append
rows from event bodies.

### Use Vectorized Bulk Loading

DuckDB row appenders are simple and reliable, but large sync batches may benefit
from vectorized inserts via Arrow or a temporary relation.

Candidate targets:

- Raw event storage appends.
- Observation appends, which are wider and more numerous than traces.

This should be benchmarked carefully because conversion into Arrow vectors can
itself become overhead for smaller batches.

### Remove In-Memory `eventJson`

Raw storage now physically stores `body_json` once and exposes compatible
`event_json` through a view. The in-memory `RawEventRow` still carries
`eventJson`.

If no hot path needs that field, remove it from `RawEventRow` and generate full
event JSON only at compatibility boundaries.

### Add an Empty Projection Fast Path

For a fresh cache, projection tables are empty. In that case sync can skip:

- Existing projected row probes.
- Delete calls for traces, observations, and scores.
- Historical raw row replay checks.

Some of this is already avoided by projecting new IDs from memory, but an
explicit empty-cache branch would make the first-sync path simpler and cheaper.

## Suggested Order

1. Pipeline object loading and conversion with serialized DuckDB commits.
2. Add OTEL-to-`RawEventRow` conversion to skip `IngestionEvent[]` for sync.
3. Emit pre-normalized projection deltas from OTEL conversion.
4. Benchmark vectorized DuckDB bulk loading for raw and observation rows.
5. Remove in-memory `eventJson` if no compatibility path depends on it.
