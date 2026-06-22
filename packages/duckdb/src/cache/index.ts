import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
	type BatchManifest,
	type IngestionEvent,
	type ObjectStore,
	otelResourceSpansToEvents,
} from "@agentpond/core";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { createSyncStateStore, SYNC_STATE_SCHEMA_SQL } from "./sync-state.js";

export type SyncResult = {
	manifestsProcessed: number;
	objectsProcessed: number;
	eventsProcessed: number;
};

export type SyncProgress = SyncResult & {
	manifestsTotal: number;
	manifestsSeen: number;
	manifestsSkipped: number;
	objectsSkipped: number;
	phase:
		| "listed"
		| "manifest-skipped"
		| "manifest-processed"
		| "object-skipped"
		| "object-processed"
		| "events-processed"
		| "complete";
	currentManifestKey?: string;
	currentObjectKey?: string;
};

export class AgentPondDuckDb {
	private instance?: DuckDBInstance;
	private connection?: DuckDBConnection;

	constructor(readonly dbPath: string) {
		mkdirSync(dirname(dbPath), { recursive: true });
	}

	async init(): Promise<void> {
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
      ${SYNC_STATE_SCHEMA_SQL}
      CREATE TABLE IF NOT EXISTS events_raw (
        event_id TEXT PRIMARY KEY,
        project_id TEXT,
        manifest_key TEXT,
        object_key TEXT,
        event_type TEXT,
        event_timestamp TIMESTAMP,
        entity_id TEXT,
        body_json TEXT,
        event_json TEXT
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
		await this.exec(`
      ALTER TABLE traces ADD COLUMN IF NOT EXISTS total_cost DOUBLE;
      ALTER TABLE observations ADD COLUMN IF NOT EXISTS usage_details_json TEXT;
      ALTER TABLE observations ADD COLUMN IF NOT EXISTS cost_details_json TEXT;
      ALTER TABLE observations ADD COLUMN IF NOT EXISTS total_cost DOUBLE;
    `);
	}

	async syncFromStore(params: {
		store: ObjectStore;
		projectId: string;
		prefix: string;
		onProgress?: (progress: SyncProgress) => void;
	}): Promise<SyncResult> {
		await this.init();
		const result: SyncResult = {
			manifestsProcessed: 0,
			objectsProcessed: 0,
			eventsProcessed: 0,
		};
		let manifestsSeen = 0;
		let manifestsSkipped = 0;
		let objectsSkipped = 0;
		const syncState = createSyncStateStore({
			store: params.store,
			prefix: params.prefix,
			projectId: params.projectId,
			all: this.all.bind(this),
			exec: this.exec.bind(this),
			sql,
		});
		const otelKeys = await syncState.listKeysForScanWindow("otel");
		const manifestKeys = await syncState.listKeysForScanWindow("manifests");
		const emitProgress = (
			phase: SyncProgress["phase"],
			current?: Pick<SyncProgress, "currentManifestKey" | "currentObjectKey">,
		) => {
			params.onProgress?.({
				...result,
				manifestsTotal: manifestKeys.length,
				manifestsSeen,
				manifestsSkipped,
				objectsSkipped,
				phase,
				...current,
			});
		};
		const processObject = async (object: {
			manifestKey: string | null;
			objectKey: string;
			progress?: Pick<SyncProgress, "currentManifestKey">;
			loadEvents: () => Promise<IngestionEvent[]>;
			entityIdForEvent: (event: IngestionEvent) => string;
		}): Promise<"processed" | "skipped"> => {
			const progress = {
				...object.progress,
				currentObjectKey: object.objectKey,
			};
			if (await this.exists("processed_objects", object.objectKey)) {
				emitProgress("object-skipped", progress);
				return "skipped";
			}

			const events = await object.loadEvents();
			for (const event of events) {
				await this.upsertRawEvent({
					projectId: params.projectId,
					manifestKey: object.manifestKey,
					objectKey: object.objectKey,
					entityId: object.entityIdForEvent(event),
					event,
				});
				await this.projectEvent(params.projectId, event);
				result.eventsProcessed += 1;
				if (result.eventsProcessed % 1000 === 0) {
					emitProgress("events-processed", progress);
				}
			}

			await this.insertKey(
				"processed_objects",
				object.objectKey,
				object.manifestKey ?? undefined,
			);
			result.objectsProcessed += 1;
			emitProgress("object-processed", progress);
			return "processed";
		};
		emitProgress("listed");

		for (const objectKey of otelKeys) {
			const outcome = await processObject({
				manifestKey: null,
				objectKey,
				loadEvents: async () =>
					otelResourceSpansToEvents(
						await params.store.getJson<unknown[]>(objectKey),
					),
				entityIdForEvent: (event) =>
					stringValue((event.body as Record<string, unknown>).id) ?? objectKey,
			});
			if (outcome === "skipped") {
				objectsSkipped += 1;
			}
		}

		for (const manifestKey of manifestKeys) {
			manifestsSeen += 1;
			if (await this.exists("processed_manifests", manifestKey)) {
				manifestsSkipped += 1;
				emitProgress("manifest-skipped", {
					currentManifestKey: manifestKey,
				});
				continue;
			}
			const manifest = await params.store.getJson<BatchManifest>(manifestKey);
			for (const object of manifest.objects) {
				const outcome = await processObject({
					manifestKey,
					objectKey: object.key,
					progress: { currentManifestKey: manifestKey },
					loadEvents: async () =>
						params.store.getJson<IngestionEvent[]>(object.key),
					entityIdForEvent: () => object.entityId,
				});
				if (outcome === "skipped") {
					objectsSkipped += 1;
				}
			}
			await this.insertKey("processed_manifests", manifestKey);
			result.manifestsProcessed += 1;
			emitProgress("manifest-processed", {
				currentManifestKey: manifestKey,
			});
		}
		await syncState.advanceLastFinalized("otel");
		await syncState.advanceLastFinalized("manifests");
		emitProgress("complete");

		return result;
	}

	async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
		await this.init();
		return this.all<T>(sql);
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

	private async projectEvent(
		projectId: string,
		event: IngestionEvent,
	): Promise<void> {
		const body = event.body as Record<string, unknown>;
		if (event.type === "trace-create") {
			const id = stringValue(body.id ?? body.traceId);
			if (!id) return;
			await this.exec(`DELETE FROM traces WHERE id = ${sql(id)}`);
			await this.exec(`
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
        ) VALUES (
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
        )
      `);
			await this.refreshTraceTotalCost(id);
			return;
		}

		if (event.type === "score-create") {
			const id = stringValue(body.id) ?? event.id;
			const {
				numberValue,
				stringValue: scoreStringValue,
				dataType,
			} = scoreValue(body.value, stringValue(body.dataType));
			await this.exec(`DELETE FROM scores WHERE id = ${sql(id)}`);
			await this.exec(`
        INSERT INTO scores VALUES (
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
        )
      `);
			return;
		}

		const id = stringValue(body.id) ?? event.id;
		const traceId = stringValue(body.traceId);
		const costDetails = objectValue(body.costDetails);
		const totalCost =
			numericValue(body.totalCost) ?? costDetailsTotal(costDetails);
		await this.exec(`DELETE FROM observations WHERE id = ${sql(id)}`);
		await this.exec(`
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
      ) VALUES (
        ${sql(id)},
        ${sql(projectId)},
        ${sql(traceId)},
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
      )
    `);
		if (traceId) await this.refreshTraceTotalCost(traceId);
	}

	private async refreshTraceTotalCost(traceId: string): Promise<void> {
		await this.exec(`
      UPDATE traces
      SET total_cost = (
        SELECT CASE WHEN count(total_cost) = 0 THEN NULL ELSE sum(total_cost) END
        FROM observations
        WHERE trace_id = ${sql(traceId)}
      )
      WHERE id = ${sql(traceId)}
    `);
	}

	private async upsertRawEvent(params: {
		projectId: string;
		manifestKey: string | null;
		objectKey: string;
		entityId: string;
		event: IngestionEvent;
	}): Promise<void> {
		await this.exec(
			`DELETE FROM events_raw WHERE event_id = ${sql(params.event.id)}`,
		);
		await this.exec(`
      INSERT INTO events_raw VALUES (
        ${sql(params.event.id)},
        ${sql(params.projectId)},
        ${sql(params.manifestKey)},
        ${sql(params.objectKey)},
        ${sql(params.event.type)},
        ${sql(timestampValue(params.event.timestamp))},
        ${sql(params.entityId)},
        ${sql(JSON.stringify(params.event.body))},
        ${sql(JSON.stringify(params.event))}
      )
    `);
	}

	private async exists(
		table: "processed_manifests" | "processed_objects",
		key: string,
	): Promise<boolean> {
		const rows = await this.all(
			`SELECT key FROM ${table} WHERE key = ${sql(key)} LIMIT 1`,
		);
		return rows.length > 0;
	}

	private async insertKey(
		table: "processed_manifests" | "processed_objects",
		key: string,
		manifestKey?: string,
	): Promise<void> {
		if (table === "processed_objects") {
			await this.exec(
				`INSERT INTO processed_objects (key, manifest_key) VALUES (${sql(key)}, ${sql(manifestKey)})`,
			);
			return;
		}
		await this.exec(
			`INSERT INTO processed_manifests (key) VALUES (${sql(key)})`,
		);
	}

	private async getConnection(): Promise<DuckDBConnection> {
		if (!this.connection) {
			this.instance = await DuckDBInstance.create(this.dbPath);
			this.connection = await this.instance.connect();
		}
		return this.connection;
	}

	private async exec(sqlText: string): Promise<void> {
		await (await this.getConnection()).run(sqlText);
	}

	private async all<T = Record<string, unknown>>(
		sqlText: string,
	): Promise<T[]> {
		const reader = await (await this.getConnection()).runAndReadAll(sqlText);
		return reader.getRowObjectsJS() as T[];
	}
}

function sql(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	return `'${String(value).replaceAll("'", "''")}'`;
}

function stringValue(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	return undefined;
}

function timestampValue(value: unknown): string | undefined {
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
