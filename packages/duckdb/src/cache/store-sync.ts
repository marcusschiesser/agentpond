import {
	type BatchManifest,
	type IngestionEvent,
	otelResourceSpansToEvents,
} from "@agentpond/core";
import type { DuckDbOperations } from "./db-operations.js";
import { BatchProjection, rawEventRow, stringValue } from "./projection.js";
import type { SyncStateStore } from "./sync-state.js";
import { createSyncStateStore } from "./sync-state.js";
import type {
	SyncFromStoreParams,
	SyncProgress,
	SyncResult,
} from "./sync-types.js";

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

// Keeps the 100k-trace perf fixture (~650k events) below the default V8 heap
// limit by flushing raw JSON strings and projection maps about 33 times.
const MAX_PENDING_EVENTS_PER_COMMIT = 20_000;

export class DuckDbStoreSync {
	constructor(private readonly db: DuckDbOperations) {}

	async syncFromStore(params: SyncFromStoreParams): Promise<SyncResult> {
		const result: SyncResult = {
			manifestsProcessed: 0,
			objectsProcessed: 0,
			eventsProcessed: 0,
		};
		let manifestsSeen = 0;
		let manifestsSkipped = 0;
		let objectsSkipped = 0;
		let projection = new BatchProjection(this.db);
		let processedObjects: ProcessedObject[] = [];
		let processedManifestKeys: string[] = [];
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
		): Promise<"processed" | "skipped"> => {
			const progress = {
				...object.progress,
				currentObjectKey: object.objectKey,
			};
			if (processedObjectKeys.has(object.objectKey)) {
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
			processedObjectKeys.add(object.objectKey);
			result.objectsProcessed += 1;
			emitProgress("object-processed", progress);
			return "processed";
		};
		const flushPending = async (): Promise<void> => {
			await this.commitSyncBatch({
				projectId: params.projectId,
				projection,
				processedObjects,
				processedManifestKeys,
				syncState,
				advanceSyncState: false,
			});
			projection = new BatchProjection(this.db);
			processedObjects = [];
			processedManifestKeys = [];
		};
		const flushFinal = async (): Promise<void> => {
			await this.commitSyncBatch({
				projectId: params.projectId,
				projection,
				processedObjects,
				processedManifestKeys,
				syncState,
				advanceSyncState: true,
			});
		};
		const flushIfNeeded = async (): Promise<void> => {
			if (projection.pendingEventCount < MAX_PENDING_EVENTS_PER_COMMIT) return;
			await flushPending();
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
		for (const object of otelObjects) {
			const outcome = await processObject(object);
			if (outcome === "skipped") {
				objectsSkipped += 1;
			}
			await flushIfNeeded();
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
				await flushIfNeeded();
			}
			processedManifestKeys.push(manifestKey);
			result.manifestsProcessed += 1;
			emitProgress("manifest-processed", {
				currentManifestKey: manifestKey,
			});
			await flushIfNeeded();
		}
		await flushFinal();
		emitProgress("complete");

		return result;
	}

	private async commitSyncBatch(params: {
		projectId: string;
		projection: BatchProjection;
		processedObjects: ProcessedObject[];
		processedManifestKeys: string[];
		syncState: SyncStateStore;
		advanceSyncState: boolean;
	}): Promise<void> {
		if (
			params.processedObjects.length === 0 &&
			params.processedManifestKeys.length === 0 &&
			params.projection.pendingEventCount === 0
		) {
			if (params.advanceSyncState) {
				await params.syncState.advanceLastFinalized("otel");
				await params.syncState.advanceLastFinalized("manifests");
			}
			return;
		}

		await this.db.exec("BEGIN TRANSACTION");
		try {
			await params.projection.commit(params.projectId);
			await this.db.insertProcessedObjects(params.processedObjects);
			await this.db.insertProcessedManifests(params.processedManifestKeys);
			if (params.advanceSyncState) {
				await params.syncState.advanceLastFinalized("otel");
				await params.syncState.advanceLastFinalized("manifests");
			}
			await this.db.exec("COMMIT");
		} catch (error) {
			await this.db.exec("ROLLBACK");
			throw error;
		}
	}
}
