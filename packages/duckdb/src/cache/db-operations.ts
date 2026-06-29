import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
	type DuckDBAppender,
	type DuckDBConnection,
	DuckDBInstance,
	timestampValue as duckDbTimestampValue,
} from "@duckdb/node-api";

type ProcessedTable = "processed_manifests" | "processed_objects";

export type DuckDbAccessMode = "readwrite" | "readonly";

export type EventsRawAppendRow = {
	eventId: string;
	projectId: string;
	manifestKey: string | null;
	objectKey: string;
	eventType: string;
	eventTimestamp: string | undefined;
	entityId: string;
	bodyJson: string;
	eventJson: string;
	traceId: string | undefined;
	observationId: string | undefined;
	scoreId: string | undefined;
};

export type TraceAppendRow = {
	id: string;
	projectId: string;
	name: string | undefined;
	userId: string | undefined;
	sessionId: string | undefined;
	startTime: string | undefined;
	endTime: string | undefined;
	metadataJson: string | undefined;
	inputJson: string | undefined;
	outputJson: string | undefined;
	totalCost: number | undefined;
	updatedAt: string | undefined;
};

export type ObservationAppendRow = {
	id: string;
	projectId: string;
	traceId: string | undefined;
	parentObservationId: string | undefined;
	type: string;
	name: string | undefined;
	startTime: string | undefined;
	endTime: string | undefined;
	metadataJson: string | undefined;
	inputJson: string | undefined;
	outputJson: string | undefined;
	usageDetailsJson: string | undefined;
	costDetailsJson: string | undefined;
	totalCost: number | undefined;
	updatedAt: string | undefined;
};

export type ScoreAppendRow = {
	id: string;
	projectId: string;
	traceId: string | undefined;
	observationId: string | undefined;
	sessionId: string | undefined;
	name: string | undefined;
	value: number | null;
	stringValue: string | null;
	dataType: string;
	source: string;
	comment: string | undefined;
	metadataJson: string | undefined;
	timestamp: string | undefined;
	updatedAt: string | undefined;
};

export class DuckDbOperations {
	private instance?: DuckDBInstance;
	private connection?: DuckDBConnection;

	constructor(
		readonly dbPath: string,
		private readonly accessMode: DuckDbAccessMode = "readwrite",
	) {
		if (accessMode === "readwrite")
			mkdirSync(dirname(dbPath), { recursive: true });
	}

	async exec(sqlText: string): Promise<void> {
		await (await this.getConnection()).run(sqlText);
	}

	async all<T = Record<string, unknown>>(sqlText: string): Promise<T[]> {
		const reader = await (await this.getConnection()).runAndReadAll(sqlText);
		return reader.getRowObjectsJS() as T[];
	}

	sql(value: unknown): string {
		return sql(value);
	}

	async createSchema(): Promise<void> {
		await this.exec(`
      CREATE TABLE IF NOT EXISTS processed_manifests (
        key TEXT PRIMARY KEY,
        processed_at TIMESTAMP DEFAULT current_timestamp
      );
      CREATE TABLE IF NOT EXISTS processed_objects (
        key TEXT PRIMARY KEY,
        manifest_key TEXT,
        processed_at TIMESTAMP DEFAULT current_timestamp
      );
      CREATE TABLE IF NOT EXISTS sync_state (
        source TEXT PRIMARY KEY,
        last_finalized_bucket TEXT,
        updated_at TIMESTAMP DEFAULT current_timestamp
      );
      CREATE TABLE IF NOT EXISTS events_raw (
        event_id TEXT PRIMARY KEY,
        project_id TEXT,
        manifest_key TEXT,
        object_key TEXT,
        event_type TEXT,
        event_timestamp TIMESTAMP,
        entity_id TEXT,
        body_json TEXT,
        event_json TEXT,
        trace_id TEXT,
        observation_id TEXT,
        score_id TEXT
      );
      CREATE TABLE IF NOT EXISTS traces (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT,
        user_id TEXT,
        session_id TEXT,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        metadata_json TEXT,
        input_json TEXT,
        output_json TEXT,
        total_cost DOUBLE,
        updated_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        trace_id TEXT,
        parent_observation_id TEXT,
        type TEXT,
        name TEXT,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        metadata_json TEXT,
        input_json TEXT,
        output_json TEXT,
        usage_details_json TEXT,
        cost_details_json TEXT,
        total_cost DOUBLE,
        updated_at TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS scores (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        trace_id TEXT,
        observation_id TEXT,
        session_id TEXT,
        name TEXT,
        value DOUBLE,
        string_value TEXT,
        data_type TEXT,
        source TEXT,
        comment TEXT,
        metadata_json TEXT,
        timestamp TIMESTAMP,
        updated_at TIMESTAMP
      );
      CREATE OR REPLACE VIEW sessions AS
        SELECT
          session_id AS id,
          project_id,
          min(start_time) AS first_seen_at,
          max(coalesce(end_time, start_time)) AS last_seen_at,
          count(*) AS trace_count
        FROM traces
        WHERE session_id IS NOT NULL AND session_id <> ''
        GROUP BY session_id, project_id;
    `);
	}

	async processedKeys(
		table: ProcessedTable,
		keys: string[],
	): Promise<Set<string>> {
		if (keys.length === 0) return new Set();
		const rows = await this.all<{ key: string }>(
			`SELECT key FROM ${table} WHERE key IN (${keys.map(sql).join(", ")})`,
		);
		return new Set(rows.map((row) => row.key));
	}

	async existingRawEventIds(eventIds: string[]): Promise<Set<string>> {
		if (eventIds.length === 0) return new Set();
		const rows = await this.all<{ event_id: string }>(
			`SELECT event_id FROM events_raw WHERE event_id IN (${eventIds.map(sql).join(", ")})`,
		);
		return new Set(rows.map((row) => row.event_id));
	}

	async insertProcessedObjects(
		objects: { objectKey: string; manifestKey: string | null }[],
	): Promise<void> {
		if (objects.length === 0) return;
		await this.exec(`
      INSERT INTO processed_objects (key, manifest_key) VALUES ${objects
				.map(
					(object) =>
						`(${this.sql(object.objectKey)}, ${this.sql(object.manifestKey)})`,
				)
				.join(", ")}
    `);
	}

	async insertProcessedManifests(manifestKeys: string[]): Promise<void> {
		if (manifestKeys.length === 0) return;
		await this.exec(`
      INSERT INTO processed_manifests (key) VALUES ${manifestKeys
				.map((key) => `(${this.sql(key)})`)
				.join(", ")}
    `);
	}

	async appendEventsRaw(rows: EventsRawAppendRow[]): Promise<void> {
		if (rows.length === 0) return;
		const appender = await (await this.getConnection()).createAppender(
			"events_raw",
		);
		try {
			for (const row of rows) {
				appendVarcharOrNull(appender, row.eventId);
				appendVarcharOrNull(appender, row.projectId);
				appendVarcharOrNull(appender, row.manifestKey);
				appendVarcharOrNull(appender, row.objectKey);
				appendVarcharOrNull(appender, row.eventType);
				appendTimestampOrNull(appender, row.eventTimestamp);
				appendVarcharOrNull(appender, row.entityId);
				appendVarcharOrNull(appender, row.bodyJson);
				appendVarcharOrNull(appender, row.eventJson);
				appendVarcharOrNull(appender, row.traceId);
				appendVarcharOrNull(appender, row.observationId);
				appendVarcharOrNull(appender, row.scoreId);
				appender.endRow();
			}
			appender.closeSync();
		} catch (error) {
			appender.closeSync();
			throw error;
		}
	}

	async appendTraces(rows: TraceAppendRow[]): Promise<void> {
		await this.appendRows("traces", rows, (appender, row) => {
			appendVarcharOrNull(appender, row.id);
			appendVarcharOrNull(appender, row.projectId);
			appendVarcharOrNull(appender, row.name);
			appendVarcharOrNull(appender, row.userId);
			appendVarcharOrNull(appender, row.sessionId);
			appendTimestampOrNull(appender, row.startTime);
			appendTimestampOrNull(appender, row.endTime);
			appendVarcharOrNull(appender, row.metadataJson);
			appendVarcharOrNull(appender, row.inputJson);
			appendVarcharOrNull(appender, row.outputJson);
			appendDoubleOrNull(appender, row.totalCost);
			appendTimestampOrNull(appender, row.updatedAt);
			appender.endRow();
		});
	}

	async appendObservations(rows: ObservationAppendRow[]): Promise<void> {
		await this.appendRows("observations", rows, (appender, row) => {
			appendVarcharOrNull(appender, row.id);
			appendVarcharOrNull(appender, row.projectId);
			appendVarcharOrNull(appender, row.traceId);
			appendVarcharOrNull(appender, row.parentObservationId);
			appendVarcharOrNull(appender, row.type);
			appendVarcharOrNull(appender, row.name);
			appendTimestampOrNull(appender, row.startTime);
			appendTimestampOrNull(appender, row.endTime);
			appendVarcharOrNull(appender, row.metadataJson);
			appendVarcharOrNull(appender, row.inputJson);
			appendVarcharOrNull(appender, row.outputJson);
			appendVarcharOrNull(appender, row.usageDetailsJson);
			appendVarcharOrNull(appender, row.costDetailsJson);
			appendDoubleOrNull(appender, row.totalCost);
			appendTimestampOrNull(appender, row.updatedAt);
			appender.endRow();
		});
	}

	private async appendRows<T>(
		table: string,
		rows: T[],
		appendRow: (appender: DuckDBAppender, row: T) => void,
	): Promise<void> {
		if (rows.length === 0) return;
		const appender = await (await this.getConnection()).createAppender(table);
		try {
			for (const row of rows) appendRow(appender, row);
			appender.closeSync();
		} catch (error) {
			appender.closeSync();
			throw error;
		}
	}

	async appendScores(rows: ScoreAppendRow[]): Promise<void> {
		if (rows.length === 0) return;
		const appender = await (await this.getConnection()).createAppender(
			"scores",
		);
		try {
			for (const row of rows) {
				appendVarcharOrNull(appender, row.id);
				appendVarcharOrNull(appender, row.projectId);
				appendVarcharOrNull(appender, row.traceId);
				appendVarcharOrNull(appender, row.observationId);
				appendVarcharOrNull(appender, row.sessionId);
				appendVarcharOrNull(appender, row.name);
				appendDoubleOrNull(appender, row.value);
				appendVarcharOrNull(appender, row.stringValue);
				appendVarcharOrNull(appender, row.dataType);
				appendVarcharOrNull(appender, row.source);
				appendVarcharOrNull(appender, row.comment);
				appendVarcharOrNull(appender, row.metadataJson);
				appendTimestampOrNull(appender, row.timestamp);
				appendTimestampOrNull(appender, row.updatedAt);
				appender.endRow();
			}
			appender.closeSync();
		} catch (error) {
			appender.closeSync();
			throw error;
		}
	}

	async close(): Promise<void> {
		if (this.connection) {
			const connection = this.connection;
			this.connection = undefined;
			connection.closeSync();
		}
		if (this.instance) {
			const instance = this.instance;
			this.instance = undefined;
			instance.closeSync();
		}
	}

	private async getConnection(): Promise<DuckDBConnection> {
		if (!this.connection) {
			this.instance = await DuckDBInstance.create(
				this.dbPath,
				this.accessMode === "readonly"
					? { access_mode: "READ_ONLY" }
					: undefined,
			);
			this.connection = await this.instance.connect();
		}
		return this.connection;
	}
}

export function sql(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	return `'${String(value).replaceAll("'", "''")}'`;
}

function appendVarcharOrNull(
	appender: Awaited<ReturnType<DuckDBConnection["createAppender"]>>,
	value: string | null | undefined,
): void {
	if (value === null || value === undefined) {
		appender.appendNull();
		return;
	}
	appender.appendVarchar(value);
}

function appendTimestampOrNull(
	appender: Awaited<ReturnType<DuckDBConnection["createAppender"]>>,
	value: string | undefined,
): void {
	if (!value) {
		appender.appendNull();
		return;
	}
	const millis = Date.parse(value);
	if (Number.isNaN(millis)) {
		appender.appendNull();
		return;
	}
	appender.appendTimestamp(duckDbTimestampValue(BigInt(millis) * 1000n));
}

function appendDoubleOrNull(
	appender: Awaited<ReturnType<DuckDBConnection["createAppender"]>>,
	value: number | null | undefined,
): void {
	if (value === null || value === undefined) {
		appender.appendNull();
		return;
	}
	appender.appendDouble(value);
}
