import type { IngestionEvent } from "@agentpond/core";
import {
	type DuckDbOperations,
	type EventsRawAppendRow,
	type ObservationAppendRow,
	type ScoreAppendRow,
	sql,
	type TraceAppendRow,
} from "./db-operations.js";

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
		const rawWasEmpty = await this.upsertRawEvents();
		await this.projectRawEvents(projectId, rawWasEmpty);
	}

	private async upsertRawEvents(): Promise<boolean> {
		if (this.rawRows.length === 0) return false;
		const rawWasEmpty = !(await this.db.tableHasRows("events_raw"));
		if (!rawWasEmpty) {
			for (const chunk of chunks(this.rawRows, FILTER_CHUNK_SIZE)) {
				await this.db.exec(
					`DELETE FROM events_raw WHERE event_id IN (${chunk.map((row) => sql(row.eventId)).join(", ")})`,
				);
			}
		}
		await this.db.appendEventsRaw(this.rawRows.map(eventsRawAppendRow));
		return rawWasEmpty;
	}

	private async projectRawEvents(
		projectId: string,
		rawWasEmpty: boolean,
	): Promise<void> {
		const work = this.work;
		if (!rawWasEmpty) {
			for (const traceId of await this.projectedObservationTraceIds(
				work.observationIds,
			)) {
				work.costTraceIds.add(traceId);
			}
		}
		const traceRows = rawWasEmpty
			? latestBatchRowsByKey(
					this.rawRows,
					"traceId",
					work.traceIds,
					(row) => row.eventType === "trace-create",
				)
			: await this.latestRawRowsByKey(
					projectId,
					"trace_id",
					work.traceIds,
					"event_type = 'trace-create'",
				);
		const observationRows = rawWasEmpty
			? latestBatchRowsByKey(
					this.rawRows,
					"observationId",
					work.observationIds,
					(row) =>
						row.eventType !== "trace-create" &&
						row.eventType !== "score-create",
				)
			: await this.latestRawRowsByKey(
					projectId,
					"observation_id",
					work.observationIds,
					"event_type <> 'trace-create' AND event_type <> 'score-create'",
				);
		const scoreRows = rawWasEmpty
			? latestBatchRowsByKey(
					this.rawRows,
					"scoreId",
					work.scoreIds,
					(row) => row.eventType === "score-create",
				)
			: await this.latestRawRowsByKey(
					projectId,
					"score_id",
					work.scoreIds,
					"event_type = 'score-create'",
				);
		for (const row of observationRows) {
			if (row.traceId) work.costTraceIds.add(row.traceId);
		}
		await this.rebuildTraces(projectId, [...work.traceIds], traceRows);
		await this.rebuildObservations(
			projectId,
			[...work.observationIds],
			observationRows,
		);
		await this.rebuildScores(projectId, [...work.scoreIds], scoreRows);
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
		rawRows: RawEventRow[],
	): Promise<void> {
		await this.deleteByIds("traces", traceIds);
		const rows = rawRows
			.map((row) => buildTraceAppendRow(projectId, row.event))
			.filter((row) => row !== undefined);
		await this.db.appendTraces(rows);
	}

	private async rebuildObservations(
		projectId: string,
		observationIds: string[],
		rawRows: RawEventRow[],
	): Promise<void> {
		await this.deleteByIds("observations", observationIds);
		const rows = rawRows
			.map((row) => buildObservationAppendRow(projectId, row.event))
			.filter((row) => row !== undefined);
		await this.db.appendObservations(rows);
	}

	private async rebuildScores(
		projectId: string,
		scoreIds: string[],
		rawRows: RawEventRow[],
	): Promise<void> {
		await this.deleteByIds("scores", scoreIds);
		await this.db.appendScores(
			rawRows.map((row) => buildScoreAppendRow(projectId, row.event)),
		);
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
	const bodyJson = JSON.stringify(params.event.body);
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
		bodyJson,
		eventJson: ingestionEventJson(params.event, bodyJson),
		event: params.event,
	};
}

function ingestionEventJson(event: IngestionEvent, bodyJson: string): string {
	return `{"id":${JSON.stringify(event.id)},"timestamp":${JSON.stringify(event.timestamp)},"type":${JSON.stringify(event.type)},"body":${bodyJson}}`;
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

function latestBatchRowsByKey(
	rows: RawEventRow[],
	key: "traceId" | "observationId" | "scoreId",
	keys: Set<string>,
	filter: (row: RawEventRow) => boolean,
): RawEventRow[] {
	const latest = new Map<string, RawEventRow>();
	for (const row of rows) {
		const value = row[key];
		if (!value || !keys.has(value) || !filter(row)) continue;
		const current = latest.get(value);
		if (!current || compareRawRows(row, current) > 0) {
			latest.set(value, row);
		}
	}
	return [...latest.values()];
}

function compareRawRows(left: RawEventRow, right: RawEventRow): number {
	const leftTimestamp = left.eventTimestamp ?? "";
	const rightTimestamp = right.eventTimestamp ?? "";
	if (leftTimestamp > rightTimestamp) return 1;
	if (leftTimestamp < rightTimestamp) return -1;
	if (left.eventId > right.eventId) return 1;
	if (left.eventId < right.eventId) return -1;
	return 0;
}

function eventsRawAppendRow(row: RawEventRow): EventsRawAppendRow {
	return {
		eventId: row.eventId,
		projectId: row.projectId,
		manifestKey: row.manifestKey,
		objectKey: row.objectKey,
		eventType: row.eventType,
		eventTimestamp: row.eventTimestamp,
		entityId: row.entityId,
		bodyJson: row.bodyJson,
		eventJson: row.eventJson,
		traceId: row.traceId,
		observationId: row.observationId,
		scoreId: row.scoreId,
	};
}

function buildTraceAppendRow(
	projectId: string,
	event: IngestionEvent,
): TraceAppendRow | undefined {
	const body = event.body as Record<string, unknown>;
	const id = stringValue(body.id ?? body.traceId);
	if (!id) return undefined;
	return {
		id,
		projectId,
		name: stringValue(body.name),
		userId: stringValue(body.userId),
		sessionId: stringValue(body.sessionId),
		startTime: timestampValue(
			body.startTime ?? body.createdAt ?? event.timestamp,
		),
		endTime: timestampValue(body.endTime),
		metadataJson: jsonString(body.metadata),
		inputJson: jsonString(body.input),
		outputJson: jsonString(body.output),
		totalCost: undefined,
		updatedAt: timestampValue(event.timestamp),
	};
}

function buildObservationAppendRow(
	projectId: string,
	event: IngestionEvent,
): ObservationAppendRow | undefined {
	const body = event.body as Record<string, unknown>;
	const id = stringValue(body.id) ?? event.id;
	const costDetails = objectValue(body.costDetails);
	const totalCost =
		numericValue(body.totalCost) ?? costDetailsTotal(costDetails);
	return {
		id,
		projectId,
		traceId: stringValue(body.traceId),
		parentObservationId: stringValue(body.parentObservationId),
		type: event.type,
		name: stringValue(body.name),
		startTime: timestampValue(
			body.startTime ?? body.createdAt ?? event.timestamp,
		),
		endTime: timestampValue(body.endTime),
		metadataJson: jsonString(body.metadata),
		inputJson: jsonString(body.input),
		outputJson: jsonString(body.output),
		usageDetailsJson: jsonString(body.usageDetails),
		costDetailsJson: jsonString(costDetails),
		totalCost,
		updatedAt: timestampValue(event.timestamp),
	};
}

function buildScoreAppendRow(
	projectId: string,
	event: IngestionEvent,
): ScoreAppendRow {
	const body = event.body as Record<string, unknown>;
	const id = stringValue(body.id) ?? event.id;
	const {
		numberValue,
		stringValue: scoreStringValue,
		dataType,
	} = scoreValue(body.value, stringValue(body.dataType));
	return {
		id,
		projectId,
		traceId: stringValue(body.traceId),
		observationId: stringValue(body.observationId),
		sessionId: stringValue(body.sessionId),
		name: stringValue(body.name),
		value: numberValue,
		stringValue: scoreStringValue,
		dataType,
		source: scoreSource(body),
		comment: stringValue(body.comment),
		metadataJson: jsonString(body.metadata),
		timestamp: timestampValue(body.createdAt ?? event.timestamp),
		updatedAt: timestampValue(event.timestamp),
	};
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
