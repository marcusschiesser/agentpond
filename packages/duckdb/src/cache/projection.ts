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

	get pendingEventCount(): number {
		return this.rawRows.length;
	}

	addRawEvent(row: RawEventRow): void {
		this.rawRows.push(row);
		addProjectionWork(this.work, row);
	}

	async commit(projectId: string): Promise<void> {
		const existingKeys = await this.upsertRawEvents(projectId);
		await this.projectRawEvents(projectId, existingKeys);
	}

	private async upsertRawEvents(projectId: string): Promise<ProjectionWork> {
		if (this.rawRows.length === 0) {
			return createProjectionWork();
		}
		const existingKeys = await this.existingProjectionKeys(projectId);
		await this.db.appendEventsRaw(this.rawRows.map(eventsRawAppendRow));
		return existingKeys;
	}

	private async projectRawEvents(
		projectId: string,
		existingKeys: ProjectionWork,
	): Promise<void> {
		const work = this.work;
		for (const traceId of existingKeys.costTraceIds) {
			work.costTraceIds.add(traceId);
		}
		const traceRows = await this.rawRowsByKey(
				projectId,
				"trace_id",
			work.traceIds,
				"event_type = 'trace-create'",
		);
		const observationRows = await this.rawRowsByKey(
				projectId,
				"observation_id",
			work.observationIds,
				"event_type <> 'trace-create' AND event_type <> 'score-create'",
		);
		const scoreRows = await this.rawRowsByKey(
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

	private async existingProjectionKeys(
		projectId: string,
	): Promise<ProjectionWork> {
		const work = createProjectionWork();
		for (const row of await this.existingProjectedRows<{ id: string | null }>({
			projectId,
			table: "traces",
			keys: this.work.traceIds,
			columns: ["id"],
		})) {
			const id = stringValue(row.id);
			if (id) work.traceIds.add(id);
		}
		for (const row of await this.existingProjectedRows<{
			id: string | null;
			trace_id: string | null;
		}>({
			projectId,
			table: "observations",
			keys: this.work.observationIds,
			columns: ["id", "trace_id"],
		})) {
			const id = stringValue(row.id);
			const traceId = stringValue(row.trace_id);
			if (id) work.observationIds.add(id);
			if (traceId) work.costTraceIds.add(traceId);
		}
		for (const row of await this.existingProjectedRows<{ id: string | null }>({
			projectId,
			table: "scores",
			keys: this.work.scoreIds,
			columns: ["id"],
		})) {
			const id = stringValue(row.id);
			if (id) work.scoreIds.add(id);
		}
		return work;
	}

	private async existingProjectedRows<
		T extends Record<string, unknown>,
	>(params: {
		projectId: string;
		table: "traces" | "observations" | "scores";
		keys: Set<string>;
		columns: string[];
	}): Promise<T[]> {
		const rows: T[] = [];
		const columns = params.columns.join(", ");
		for (const keyChunk of chunks([...params.keys], FILTER_CHUNK_SIZE)) {
			if (keyChunk.length === 0) continue;
			rows.push(
				...(await this.db.all<T>(`
        SELECT ${columns}
        FROM ${params.table}
        WHERE project_id = ${sql(params.projectId)}
          AND id IN (${keyChunk.map(sql).join(", ")})
      `)),
			);
		}
		return rows;
	}

	private async rawRowsByKey(
		projectId: string,
		keyColumn: "trace_id" | "observation_id" | "score_id",
		keys: Set<string>,
		filter: string,
	): Promise<RawEventRow[]> {
		const result: RawEventRow[] = [];
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
	        ORDER BY ${keyColumn} ASC, event_timestamp ASC, event_id ASC
	      `);
			for (const row of rows) {
				const event = JSON.parse(row.event_json) as IngestionEvent;
				result.push({
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
		return result;
	}

	private async rebuildTraces(
		projectId: string,
		traceIds: string[],
		rawRows: RawEventRow[],
	): Promise<void> {
		await this.deleteByIds("traces", traceIds);
		const rows = groupedRowsByKey(rawRows, "traceId")
			.map((rows) => buildMergedTraceAppendRow(projectId, rows))
			.filter((row) => row !== undefined);
		await this.db.appendTraces(rows);
	}

	private async rebuildObservations(
		projectId: string,
		observationIds: string[],
		rawRows: RawEventRow[],
	): Promise<void> {
		await this.deleteByIds("observations", observationIds);
		const rows = groupedRowsByKey(rawRows, "observationId")
			.map((rows) => buildMergedObservationAppendRow(projectId, rows))
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
			groupedRowsByKey(rawRows, "scoreId").map((rows) =>
				buildMergedScoreAppendRow(projectId, rows),
			),
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

function groupedRowsByKey(
	rows: RawEventRow[],
	key: "traceId" | "observationId" | "scoreId",
): RawEventRow[][] {
	const groups = new Map<string, RawEventRow[]>();
	for (const row of rows) {
		const value = row[key];
		if (!value) continue;
		const group = groups.get(value);
		if (group) {
			group.push(row);
		} else {
			groups.set(value, [row]);
		}
	}
	return [...groups.values()].map((group) => group.sort(compareRawRows));
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

function buildMergedTraceAppendRow(
	projectId: string,
	rows: RawEventRow[],
): TraceAppendRow | undefined {
	const first = rows[0];
	const id = first?.traceId;
	if (!id) return undefined;
	const merged: TraceAppendRow = {
		id,
		projectId,
		name: undefined,
		userId: undefined,
		sessionId: undefined,
		startTime: undefined,
		endTime: undefined,
		metadataJson: undefined,
		inputJson: undefined,
		outputJson: undefined,
		totalCost: undefined,
		updatedAt: undefined,
	};
	for (const row of rows) {
		const appendRow = buildTraceAppendRow(projectId, row.event);
		if (!appendRow) continue;
		mergeDefinedFields(merged, appendRow, ["id", "projectId", "totalCost"]);
	}
	mergeLatestIo(merged, rows);
	return merged;
}

function buildTraceAppendRow(
	projectId: string,
	event: IngestionEvent,
): TraceAppendRow | undefined {
	const body = event.body as Record<string, unknown>;
	const id = stringValue(body.id ?? body.traceId);
	if (!id) return undefined;
	return mergeUndefinedValues({
		id,
		projectId,
		userId: stringValue(body.userId),
		sessionId: stringValue(body.sessionId),
		...appendRowBodyFields(body, event),
		totalCost: undefined,
	});
}

function buildMergedObservationAppendRow(
	projectId: string,
	rows: RawEventRow[],
): ObservationAppendRow | undefined {
	const first = rows[0];
	const id = first?.observationId;
	if (!id) return undefined;
	const merged: ObservationAppendRow = {
		id,
		projectId,
		traceId: undefined,
		parentObservationId: undefined,
		type: first.eventType,
		name: undefined,
		startTime: undefined,
		endTime: undefined,
		metadataJson: undefined,
		inputJson: undefined,
		outputJson: undefined,
		usageDetailsJson: undefined,
		costDetailsJson: undefined,
		totalCost: undefined,
		updatedAt: undefined,
	};
	for (const row of rows) {
		const appendRow = buildObservationAppendRow(projectId, row.event);
		if (!appendRow) continue;
		mergeDefinedFields(merged, appendRow, ["id", "projectId"]);
	}
	mergeLatestIo(merged, rows);
	return merged;
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
	return mergeUndefinedValues({
		id,
		projectId,
		traceId: stringValue(body.traceId),
		parentObservationId: stringValue(body.parentObservationId),
		type: event.type,
		...appendRowBodyFields(body, event),
		usageDetailsJson: jsonString(body.usageDetails),
		costDetailsJson: jsonString(costDetails),
		totalCost,
	});
}

function appendRowBodyFields(
	body: Record<string, unknown>,
	event: IngestionEvent,
): Pick<
	TraceAppendRow,
	| "name"
	| "startTime"
	| "endTime"
	| "metadataJson"
	| "inputJson"
	| "outputJson"
	| "updatedAt"
> {
	return {
		name: stringValue(body.name),
		startTime: timestampValue(
			body.startTime ?? body.createdAt ?? event.timestamp,
		),
		endTime: timestampValue(body.endTime),
		metadataJson: jsonString(body.metadata),
		inputJson: jsonString(body.input),
		outputJson: jsonString(body.output),
		updatedAt: timestampValue(event.timestamp),
	};
}

function buildMergedScoreAppendRow(
	projectId: string,
	rows: RawEventRow[],
): ScoreAppendRow {
	const first = rows[0];
	const merged = buildScoreAppendRow(
		projectId,
		first?.event ?? {
			id: "",
			timestamp: new Date(0).toISOString(),
			type: "score-create",
			body: {},
		},
	);
	for (const row of rows.slice(1)) {
		mergeDefinedFields(merged, buildScoreAppendRow(projectId, row.event), [
			"id",
			"projectId",
			"timestamp",
		]);
	}
	if (merged.source === undefined) merged.source = "API";
	return merged;
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
	return mergeUndefinedValues({
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
	});
}

function mergeDefinedFields<T extends Record<string, unknown>>(
	target: T,
	source: T,
	immutableKeys: Array<keyof T>,
): void {
	for (const key of Object.keys(source) as Array<keyof T>) {
		if (immutableKeys.includes(key)) continue;
		const value = source[key];
		if (value === undefined || isEmptyObjectJson(value)) continue;
		if (key === "metadataJson") {
			target[key] = mergeMetadataJson(target[key], value) as T[typeof key];
			continue;
		}
		target[key] = value;
	}
		}

function mergeLatestIo(
	target: Pick<TraceAppendRow, "inputJson" | "outputJson">,
	rows: RawEventRow[],
): void {
	for (const row of rows) {
		const body = row.event.body as Record<string, unknown>;
		const inputJson = jsonString(body.input);
		if (inputJson !== undefined) target.inputJson = inputJson;
		const outputJson = jsonString(body.output);
		if (outputJson !== undefined) target.outputJson = outputJson;
	}
}

function mergeMetadataJson(left: unknown, right: unknown): string | undefined {
	const leftObject = objectFromJsonString(left);
	const rightObject = objectFromJsonString(right);
	if (!leftObject) return stringValue(right);
	if (!rightObject) return stringValue(left);
	return JSON.stringify({ ...leftObject, ...rightObject });
}

function objectFromJsonString(
	value: unknown,
): Record<string, unknown> | undefined {
	const raw = stringValue(value);
	if (!raw) return undefined;
	try {
		return objectValue(JSON.parse(raw));
	} catch {
		return undefined;
	}
}

function isEmptyObjectJson(value: unknown): boolean {
	const object = objectFromJsonString(value);
	return object !== undefined && Object.keys(object).length === 0;
}

function mergeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
	for (const key of Object.keys(value)) {
		if (value[key] === undefined) delete value[key];
	}
	return value;
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

function scoreSource(body: Record<string, unknown>): string | undefined {
	const explicit = stringValue(body.source);
	if (isScoreSource(explicit)) return explicit;
	const metadata = body.metadata;
	if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
		const metadataSource = stringValue(
			(metadata as Record<string, unknown>).source,
		);
		if (isScoreSource(metadataSource)) return metadataSource;
	}
	return undefined;
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
	numberValue: number | null | undefined;
	stringValue: string | null | undefined;
	dataType: string | undefined;
} {
	if (value === undefined || value === null)
		return {
			numberValue: undefined,
			stringValue: undefined,
			dataType: declaredDataType,
		};
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
