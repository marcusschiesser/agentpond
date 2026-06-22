import {
	type BatchManifest,
	type IngestionEvent,
	type ObjectStore,
	otelResourceSpansToEvents,
} from "@agentpond/core";
import { DuckDbOperations } from "./db-operations.js";
import { BatchProjection, rawEventRow, stringValue } from "./projection.js";
import type { SyncStateStore } from "./sync-state.js";
import { createSyncStateStore } from "./sync-state.js";

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
		await this.db.createSchema();
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
		const processedObjectKeys = await this.db.processedKeys(
			"processed_objects",
			otelKeys,
		);
		const processedManifestKeysSeen = await this.db.processedKeys(
			"processed_manifests",
			manifestKeys,
		);
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
			loadedEvents?: IngestionEvent[],
		): Promise<"processed" | "skipped"> => {
			const progress = {
				...object.progress,
				currentObjectKey: object.objectKey,
			};
			if (processedObjectKeys.has(object.objectKey)) {
				emitProgress("object-skipped", progress);
				return "skipped";
			}

			const events = loadedEvents ?? (await object.loadEvents());
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
			processedObjectKeys.add(object.objectKey);
			result.objectsProcessed += 1;
			emitProgress("object-processed", progress);
			return "processed";
		};
		emitProgress("listed");

		const otelObjects: PendingObject[] = otelKeys.map((objectKey) => ({
			manifestKey: null,
			objectKey,
			loadEvents: async () =>
				otelResourceSpansToEvents(
					await params.store.getJson<unknown[]>(objectKey),
				),
			entityIdForEvent: (event) =>
				stringValue((event.body as Record<string, unknown>).id) ?? objectKey,
		}));
		const loadedOtelObjects = await Promise.all(
			otelObjects.map(async (object) => ({
				object,
				events: processedObjectKeys.has(object.objectKey)
					? undefined
					: await object.loadEvents(),
			})),
		);
		for (const loaded of loadedOtelObjects) {
			const outcome = await processObject(loaded.object, loaded.events);
			if (outcome === "skipped") {
				objectsSkipped += 1;
			}
		}

		for (const manifestKey of manifestKeys) {
			manifestsSeen += 1;
			if (processedManifestKeysSeen.has(manifestKey)) {
				manifestsSkipped += 1;
				emitProgress("manifest-skipped", {
					currentManifestKey: manifestKey,
				});
				continue;
			}
			const manifest = await params.store.getJson<BatchManifest>(manifestKey);
			const processedManifestObjectKeys = await this.db.processedKeys(
				"processed_objects",
				manifest.objects.map((object) => object.key),
			);
			for (const objectKey of processedManifestObjectKeys) {
				processedObjectKeys.add(objectKey);
			}
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
			await this.db.insertProcessedObjects(params.processedObjects);
			await this.db.insertProcessedManifests(params.processedManifestKeys);
			await params.syncState.advanceLastFinalized("otel");
			await params.syncState.advanceLastFinalized("manifests");
			await this.db.exec("COMMIT");
		} catch (error) {
			await this.db.exec("ROLLBACK");
			throw error;
		}
	}
}
