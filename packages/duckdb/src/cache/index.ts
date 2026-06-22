import {
	type BatchManifest,
	type IngestionEvent,
	type ObjectStore,
	otelResourceSpansToEvents,
} from "@agentpond/core";
import { DuckDbOperations } from "./db-operations.js";
import { BatchProjection, rawEventRow, stringValue } from "./projection.js";
import type { SyncStateStore } from "./sync-state.js";
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

type PendingObject = {
	manifestKey: string | null;
	objectKey: string;
	progress?: Pick<SyncProgress, "currentManifestKey">;
	loadEvents: () => Promise<IngestionEvent[]>;
	entityIdForEvent: (event: IngestionEvent) => string;
};

type ProcessedObject = {
	objectKey: string;
	manifestKey: string | null;
};

export class AgentPondCache {
	private readonly db: DuckDbOperations;

	constructor(readonly dbPath: string) {
		this.db = new DuckDbOperations(dbPath);
	}

	async init(): Promise<void> {
		await this.createSchema();
	}

	private async createSchema(): Promise<void> {
		await this.db.exec(`
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
		const projection = new BatchProjection(this.db);
		const processedObjects: ProcessedObject[] = [];
		const processedManifestKeys: string[] = [];
		const syncState = createSyncStateStore({
			store: params.store,
			prefix: params.prefix,
			projectId: params.projectId,
			db: this.db,
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
		const processObject = async (
			object: PendingObject,
		): Promise<"processed" | "skipped"> => {
			const progress = {
				...object.progress,
				currentObjectKey: object.objectKey,
			};
			if (
				await this.db.processedKeyExists("processed_objects", object.objectKey)
			) {
				emitProgress("object-skipped", progress);
				return "skipped";
			}

			const events = await object.loadEvents();
			for (const event of events) {
				const row = rawEventRow({
					projectId: params.projectId,
					manifestKey: object.manifestKey,
					objectKey: object.objectKey,
					entityId: object.entityIdForEvent(event),
					event,
				});
				projection.addRawEvent(row);
				result.eventsProcessed += 1;
				if (result.eventsProcessed % 1000 === 0) {
					emitProgress("events-processed", progress);
				}
			}

			processedObjects.push({
				objectKey: object.objectKey,
				manifestKey: object.manifestKey,
			});
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
			if (
				await this.db.processedKeyExists("processed_manifests", manifestKey)
			) {
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
			processedManifestKeys.push(manifestKey);
			result.manifestsProcessed += 1;
			emitProgress("manifest-processed", {
				currentManifestKey: manifestKey,
			});
		}
		await this.commitSyncBatch({
			projectId: params.projectId,
			projection,
			processedObjects,
			processedManifestKeys,
			syncState,
		});
		emitProgress("complete");

		return result;
	}

	async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
		await this.init();
		return this.db.all<T>(sql);
	}

	async close(): Promise<void> {
		await this.db.close();
	}

	private async commitSyncBatch(params: {
		projectId: string;
		projection: BatchProjection;
		processedObjects: ProcessedObject[];
		processedManifestKeys: string[];
		syncState: SyncStateStore;
	}): Promise<void> {
		if (
			params.processedObjects.length === 0 &&
			params.processedManifestKeys.length === 0
		) {
			await params.syncState.advanceLastFinalized("otel");
			await params.syncState.advanceLastFinalized("manifests");
			return;
		}

		await this.db.exec("BEGIN TRANSACTION");
		try {
			await params.projection.commit(params.projectId);
			for (const object of params.processedObjects) {
				await this.db.insertProcessedKey(
					"processed_objects",
					object.objectKey,
					object.manifestKey ?? undefined,
				);
			}
			for (const manifestKey of params.processedManifestKeys) {
				await this.db.insertProcessedKey("processed_manifests", manifestKey);
			}
			await params.syncState.advanceLastFinalized("otel");
			await params.syncState.advanceLastFinalized("manifests");
			await this.db.exec("COMMIT");
		} catch (error) {
			await this.db.exec("ROLLBACK");
			throw error;
		}
	}
}
