import type { IngestionEvent } from "@agentpond/core";
import { type DuckDbOperations, sql } from "./db-operations.js";

const INSERT_CHUNK_SIZE = 500;
const FILTER_CHUNK_SIZE = 500;

export type RawEventRow = {
	eventId: string;
	projectId: string;
	manifestKey: string | null;
	objectKey: string;
	eventType: string;
	eventTimestamp: string | undefined;
	entityId: string;
	traceId: string | undefined;
	observationId: string | undefined;
	scoreId: string | undefined;
	bodyJson: string;
	eventJson: string;
	event: IngestionEvent;
};

type ProjectionWork = {
	traceIds: Set<string>;
	costTraceIds: Set<string>;
	observationIds: Set<string>;
	scoreIds: Set<string>;
};

function createProjectionWork(): ProjectionWork {
	return {
		traceIds: new Set(),
		costTraceIds: new Set(),
		observationIds: new Set(),
		scoreIds: new Set(),
	};
}

export class BatchProjection {
	private readonly rawRows: RawEventRow[] = [];
	private readonly work = createProjectionWork();

	constructor(private readonly db: DuckDbOperations) {}

	addRawEvent(row: RawEventRow): void {
		this.rawRows.push(row);
		addProjectionWork(this.work, row);
	}

	async commit(projectId: string): Promise<void> {
		await this.upsertRawEvents();
		await this.projectRawEvents(projectId);
	}

	private async upsertRawEvents(): Promise<void> {
		for (const chunk of chunks(this.rawRows, INSERT_CHUNK_SIZE)) {
			await this.db.exec(
				`DELETE FROM events_raw WHERE event_id IN (${chunk.map((row) => sql(row.eventId)).join(", ")})`,
			);
			await this.db.exec(`
        INSERT INTO events_raw (
          event_id,
          project_id,
          manifest_key,
          object_key,
          event_type,
          event_timestamp,
          entity_id,
          body_json,
          event_json,
          trace_id,
          observation_id,
          score_id
        ) VALUES ${chunk.map(rawEventSqlValues).join(", ")}
      `);
		}
	}

	private async projectRawEvents(projectId: string): Promise<void> {
		const work = this.work;
		for (const traceId of await this.projectedObservationTraceIds(
			work.observationIds,
		)) {
			work.costTraceIds.add(traceId);
		}
		const traceRows = await this.latestRawRowsByKey(
			projectId,
			"trace_id",
			work.traceIds,
			"event_type = 'trace-create'",
		);
		const observationRows = await this.latestRawRowsByKey(
			projectId,
			"observation_id",
			work.observationIds,
			"event_type <> 'trace-create' AND event_type <> 'score-create'",
		);
		const scoreRows = await this.latestRawRowsByKey(
			projectId,
			"score_id",
			work.scoreIds,
			"event_type = 'score-create'",
		);
		for (const row of observationRows) {
			if (row.traceId) work.costTraceIds.add(row.traceId);
		}

		await this.rebuildTraces(
			projectId,
			[...work.traceIds],
			traceRows.map((row) => row.event),
		);
		await this.rebuildObservations(
			projectId,
			[...work.observationIds],
			observationRows.map((row) => row.event),
		);
		await this.rebuildScores(
			projectId,
			[...work.scoreIds],
			scoreRows.map((row) => row.event),
		);
		await this.refreshTraceTotalCosts([...work.costTraceIds]);
	}

	private async projectedObservationTraceIds(
		observationIds: Set<string>,
	): Promise<string[]> {
		const traceIds = new Set<string>();
		for (const chunk of chunks([...observationIds], FILTER_CHUNK_SIZE)) {
			if (chunk.length === 0) continue;
			const rows = await this.db.all<{ trace_id: string | null }>(
				`SELECT trace_id FROM observations WHERE id IN (${chunk.map(sql).join(", ")})`,
			);
			for (const row of rows) {
				const traceId = stringValue(row.trace_id);
				if (traceId) traceIds.add(traceId);
			}
		}
		return [...traceIds];
	}

	private async latestRawRowsByKey(
		projectId: string,
		keyColumn: "trace_id" | "observation_id" | "score_id",
		keys: Set<string>,
		filter: string,
	): Promise<RawEventRow[]> {
		const latest = new Map<string, RawEventRow>();
		for (const keyChunk of chunks([...keys], FILTER_CHUNK_SIZE)) {
			if (keyChunk.length === 0) continue;
			const rows = await this.db.all<{
				event_id: string;
				project_id: string;
				manifest_key: string | null;
				object_key: string;
				event_type: string;
				event_timestamp: Date | string | null;
				entity_id: string;
				body_json: string;
				event_json: string;
				trace_id: string | null;
				observation_id: string | null;
				score_id: string | null;
			}>(`
        SELECT
          event_id,
          project_id,
          manifest_key,
          object_key,
          event_type,
          event_timestamp,
          entity_id,
          body_json,
          event_json,
          trace_id,
          observation_id,
          score_id
        FROM events_raw
        WHERE project_id = ${sql(projectId)}
          AND ${filter}
          AND ${keyColumn} IN (${keyChunk.map(sql).join(", ")})
        ORDER BY ${keyColumn} ASC, event_timestamp DESC, event_id DESC
      `);
			for (const row of rows) {
				const key = stringValue(row[keyColumn]);
				if (!key || latest.has(key)) continue;
				const event = JSON.parse(row.event_json) as IngestionEvent;
				latest.set(key, {
					eventId: row.event_id,
					projectId: row.project_id,
					manifestKey: row.manifest_key,
					objectKey: row.object_key,
					eventType: row.event_type,
					eventTimestamp: timestampValue(row.event_timestamp),
					entityId: row.entity_id,
					traceId: stringValue(row.trace_id),
					observationId: stringValue(row.observation_id),
					scoreId: stringValue(row.score_id),
					bodyJson: row.body_json,
					eventJson: row.event_json,
					event,
				});
			}
		}
		return [...latest.values()];
	}

	private async rebuildTraces(
		projectId: string,
		traceIds: string[],
		events: IngestionEvent[],
	): Promise<void> {
		await this.deleteByIds("traces", traceIds);
		const values = events
			.map((event) => traceSqlValues(projectId, event))
			.filter((value) => value !== undefined);
		for (const chunk of chunks(values, INSERT_CHUNK_SIZE)) {
			if (chunk.length === 0) continue;
			await this.db.exec(`
        INSERT INTO traces (
          id,
          project_id,
          name,
          user_id,
          session_id,
          start_time,
          end_time,
          metadata_json,
          input_json,
          output_json,
          total_cost,
          updated_at
        ) VALUES ${chunk.join(", ")}
      `);
		}
	}

	private async rebuildObservations(
		projectId: string,
		observationIds: string[],
		events: IngestionEvent[],
	): Promise<void> {
		await this.deleteByIds("observations", observationIds);
		const values = events
			.map((event) => observationSqlValues(projectId, event))
			.filter((value) => value !== undefined);
		for (const chunk of chunks(values, INSERT_CHUNK_SIZE)) {
			if (chunk.length === 0) continue;
			await this.db.exec(`
        INSERT INTO observations (
          id,
          project_id,
          trace_id,
          parent_observation_id,
          type,
          name,
          start_time,
          end_time,
          metadata_json,
          input_json,
          output_json,
          usage_details_json,
          cost_details_json,
          total_cost,
          updated_at
        ) VALUES ${chunk.join(", ")}
      `);
		}
	}

	private async rebuildScores(
		projectId: string,
		scoreIds: string[],
		events: IngestionEvent[],
	): Promise<void> {
		await this.deleteByIds("scores", scoreIds);
		const values = events.map((event) => scoreSqlValues(projectId, event));
		for (const chunk of chunks(values, INSERT_CHUNK_SIZE)) {
			if (chunk.length === 0) continue;
			await this.db.exec(`INSERT INTO scores VALUES ${chunk.join(", ")}`);
		}
	}

	private async deleteByIds(
		table: "traces" | "observations" | "scores",
		ids: string[],
	): Promise<void> {
		for (const chunk of chunks(ids, FILTER_CHUNK_SIZE)) {
			if (chunk.length === 0) continue;
			await this.db.exec(
				`DELETE FROM ${table} WHERE id IN (${chunk.map(sql).join(", ")})`,
			);
		}
	}

	private async refreshTraceTotalCosts(traceIds: string[]): Promise<void> {
		for (const chunk of chunks(traceIds, FILTER_CHUNK_SIZE)) {
			if (chunk.length === 0) continue;
			const ids = chunk.map(sql).join(", ");
			await this.db.exec(`
        UPDATE traces
        SET total_cost = NULL
        WHERE id IN (${ids})
      `);
			await this.db.exec(`
        UPDATE traces
        SET total_cost = costs.total_cost
        FROM (
          SELECT trace_id, sum(total_cost) AS total_cost
          FROM observations
          WHERE trace_id IN (${ids}) AND total_cost IS NOT NULL
          GROUP BY trace_id
        ) AS costs
        WHERE traces.id = costs.trace_id
      `);
		}
	}
}

export function rawEventRow(params: {
	projectId: string;
	manifestKey: string | null;
	objectKey: string;
	entityId: string;
	event: IngestionEvent;
}): RawEventRow {
	const keys = projectionKeys(params.event);
	return {
		eventId: params.event.id,
		projectId: params.projectId,
		manifestKey: params.manifestKey,
		objectKey: params.objectKey,
		eventType: params.event.type,
		eventTimestamp: timestampValue(params.event.timestamp),
		entityId: params.entityId,
		traceId: keys.traceId,
		observationId: keys.observationId,
		scoreId: keys.scoreId,
		bodyJson: JSON.stringify(params.event.body),
		eventJson: JSON.stringify(params.event),
		event: params.event,
	};
}

function projectionKeys(event: IngestionEvent): {
	traceId: string | undefined;
	observationId: string | undefined;
	scoreId: string | undefined;
} {
	const body = event.body as Record<string, unknown>;
	if (event.type === "trace-create") {
		return {
			traceId: stringValue(body.id ?? body.traceId),
			observationId: undefined,
			scoreId: undefined,
		};
	}
	if (event.type === "score-create") {
		return {
			traceId: stringValue(body.traceId),
			observationId: stringValue(body.observationId),
			scoreId: stringValue(body.id) ?? event.id,
		};
	}
	return {
		traceId: stringValue(body.traceId),
		observationId: stringValue(body.id) ?? event.id,
		scoreId: undefined,
	};
}

function addProjectionWork(work: ProjectionWork, row: RawEventRow): void {
	if (row.traceId) work.costTraceIds.add(row.traceId);
	if (row.eventType === "trace-create") {
		if (row.traceId) work.traceIds.add(row.traceId);
		return;
	}
	if (row.eventType === "score-create") {
		if (row.scoreId) work.scoreIds.add(row.scoreId);
		return;
	}
	if (row.observationId) work.observationIds.add(row.observationId);
}

function rawEventSqlValues(row: RawEventRow): string {
	return `(
    ${sql(row.eventId)},
    ${sql(row.projectId)},
    ${sql(row.manifestKey)},
    ${sql(row.objectKey)},
    ${sql(row.eventType)},
    ${sql(row.eventTimestamp)},
    ${sql(row.entityId)},
    ${sql(row.bodyJson)},
    ${sql(row.eventJson)},
    ${sql(row.traceId)},
    ${sql(row.observationId)},
    ${sql(row.scoreId)}
  )`;
}

function traceSqlValues(
	projectId: string,
	event: IngestionEvent,
): string | undefined {
	const body = event.body as Record<string, unknown>;
	const id = stringValue(body.id ?? body.traceId);
	if (!id) return undefined;
	return `(
    ${sql(id)},
    ${sql(projectId)},
    ${sql(stringValue(body.name))},
    ${sql(stringValue(body.userId))},
    ${sql(stringValue(body.sessionId))},
    ${sql(timestampValue(body.startTime ?? body.createdAt ?? event.timestamp))},
    ${sql(timestampValue(body.endTime))},
    ${sql(jsonString(body.metadata))},
    ${sql(jsonString(body.input))},
    ${sql(jsonString(body.output))},
    NULL,
    ${sql(timestampValue(event.timestamp))}
  )`;
}

function observationSqlValues(
	projectId: string,
	event: IngestionEvent,
): string | undefined {
	const body = event.body as Record<string, unknown>;
	const id = stringValue(body.id) ?? event.id;
	const costDetails = objectValue(body.costDetails);
	const totalCost =
		numericValue(body.totalCost) ?? costDetailsTotal(costDetails);
	return `(
    ${sql(id)},
    ${sql(projectId)},
    ${sql(stringValue(body.traceId))},
    ${sql(stringValue(body.parentObservationId))},
    ${sql(event.type)},
    ${sql(stringValue(body.name))},
    ${sql(timestampValue(body.startTime ?? body.createdAt ?? event.timestamp))},
    ${sql(timestampValue(body.endTime))},
    ${sql(jsonString(body.metadata))},
    ${sql(jsonString(body.input))},
    ${sql(jsonString(body.output))},
    ${sql(jsonString(body.usageDetails))},
    ${sql(jsonString(costDetails))},
    ${totalCost === undefined ? "NULL" : String(totalCost)},
    ${sql(timestampValue(event.timestamp))}
  )`;
}

function scoreSqlValues(projectId: string, event: IngestionEvent): string {
	const body = event.body as Record<string, unknown>;
	const id = stringValue(body.id) ?? event.id;
	const {
		numberValue,
		stringValue: scoreStringValue,
		dataType,
	} = scoreValue(body.value, stringValue(body.dataType));
	return `(
    ${sql(id)},
    ${sql(projectId)},
    ${sql(stringValue(body.traceId))},
    ${sql(stringValue(body.observationId))},
    ${sql(stringValue(body.sessionId))},
    ${sql(stringValue(body.name))},
    ${numberValue === null ? "NULL" : String(numberValue)},
    ${sql(scoreStringValue)},
    ${sql(dataType)},
    ${sql(scoreSource(body))},
    ${sql(stringValue(body.comment))},
    ${sql(jsonString(body.metadata))},
    ${sql(timestampValue(body.createdAt ?? event.timestamp))},
    ${sql(timestampValue(event.timestamp))}
  )`;
}

function chunks<T>(values: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		result.push(values.slice(index, index + size));
	}
	return result;
}

export function stringValue(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	return undefined;
}

function timestampValue(value: unknown): string | undefined {
	if (value instanceof Date) return value.toISOString();
	const raw = stringValue(value);
	if (!raw) return undefined;
	const date = new Date(raw);
	if (Number.isNaN(date.getTime())) return undefined;
	return date.toISOString();
}

function jsonString(value: unknown): string | undefined {
	if (value === null || value === undefined) return undefined;
	return JSON.stringify(value);
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	return value as Record<string, unknown>;
}

function numericValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "string") return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function costDetailsTotal(
	costDetails: Record<string, unknown> | undefined,
): number | undefined {
	if (!costDetails) return undefined;
	const explicitTotal = numericValue(costDetails.total);
	if (explicitTotal !== undefined) return explicitTotal;

	let total = 0;
	let hasCost = false;
	for (const [key, value] of Object.entries(costDetails)) {
		if (key === "total") continue;
		const numeric = numericValue(value);
		if (numeric === undefined) continue;
		total += numeric;
		hasCost = true;
	}
	return hasCost ? total : undefined;
}

function scoreSource(body: Record<string, unknown>): string {
	const explicit = stringValue(body.source);
	if (isScoreSource(explicit)) return explicit;
	const metadata = body.metadata;
	if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
		const metadataSource = stringValue(
			(metadata as Record<string, unknown>).source,
		);
		if (isScoreSource(metadataSource)) return metadataSource;
	}
	return "API";
}

function isScoreSource(
	value: string | undefined,
): value is "API" | "EVAL" | "ANNOTATION" {
	return value === "API" || value === "EVAL" || value === "ANNOTATION";
}

function scoreValue(
	value: unknown,
	declaredDataType: string | undefined,
): {
	numberValue: number | null;
	stringValue: string | null;
	dataType: string;
} {
	if (typeof value === "number")
		return {
			numberValue: value,
			stringValue: null,
			dataType: declaredDataType ?? "NUMERIC",
		};
	if (typeof value === "boolean")
		return {
			numberValue: value ? 1 : 0,
			stringValue: String(value),
			dataType: declaredDataType ?? "BOOLEAN",
		};
	if (typeof value === "string") {
		const numeric = Number(value);
		if ((declaredDataType ?? "") === "NUMERIC" && !Number.isNaN(numeric)) {
			return { numberValue: numeric, stringValue: value, dataType: "NUMERIC" };
		}
		return {
			numberValue: null,
			stringValue: value,
			dataType: declaredDataType ?? "CATEGORICAL",
		};
	}
	return {
		numberValue: null,
		stringValue: null,
		dataType: declaredDataType ?? "NUMERIC",
	};
}
