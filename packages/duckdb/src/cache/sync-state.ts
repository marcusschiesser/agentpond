import { manifestPrefix, type ObjectStore, otelPrefix } from "@agentpond/core";
import {
	bucketScanWindowFromState,
	currentBucketScanWindow,
	listKeysForUtcHourBuckets,
} from "./bucket-scan.js";
import type { DuckDbOperations } from "./db-operations.js";

export type SyncStateSource = "otel" | "manifests";

export type SyncStateStore = {
	getLastFinalized(source: SyncStateSource): Promise<Date | undefined>;
	setLastFinalized(source: SyncStateSource, bucket: Date): Promise<void>;
	advanceLastFinalized(source: SyncStateSource): Promise<void>;
	listKeysForScanWindow(source: SyncStateSource): Promise<string[]>;
};

export function createSyncStateStore(params: {
	store: ObjectStore;
	prefix: string;
	projectId: string;
	db: DuckDbOperations;
}): SyncStateStore {
	const scanWindow = currentBucketScanWindow();
	return {
		async getLastFinalized(source) {
			const key = syncStateKey(source, params.prefix, params.projectId);
			const rows = await params.db.all<{ last_finalized_bucket: string }>(
				`SELECT last_finalized_bucket FROM sync_state WHERE source = ${params.db.sql(key)} LIMIT 1`,
			);
			const raw = rows[0]?.last_finalized_bucket;
			if (!raw) return undefined;
			const date = new Date(raw);
			return Number.isNaN(date.getTime()) ? undefined : date;
		},

		async setLastFinalized(source, bucket) {
			const key = syncStateKey(source, params.prefix, params.projectId);
			await params.db.exec(
				`DELETE FROM sync_state WHERE source = ${params.db.sql(key)}`,
			);
			await params.db.exec(`
        INSERT INTO sync_state (source, last_finalized_bucket, updated_at)
        VALUES (${params.db.sql(key)}, ${params.db.sql(bucket.toISOString())}, current_timestamp)
      `);
		},

		async advanceLastFinalized(source) {
			await this.setLastFinalized(source, scanWindow.finalized);
		},

		async listKeysForScanWindow(source) {
			const lastFinalized = await this.getLastFinalized(source);
			const prefix = sourcePrefix(source, params.prefix, params.projectId);
			if (!lastFinalized) {
				return params.store.listKeys(prefix);
			}
			const window = bucketScanWindowFromState(lastFinalized, scanWindow.end);
			return listKeysForUtcHourBuckets({
				store: params.store,
				prefix,
				start: window.start,
				end: window.end,
			});
		},
	};
}

function syncStateKey(
	source: SyncStateSource,
	prefix: string,
	projectId: string,
): string {
	return `${source}:${prefix}:${projectId}`;
}

function sourcePrefix(
	source: SyncStateSource,
	prefix: string,
	projectId: string,
): string {
	return source === "otel"
		? otelPrefix(prefix, projectId)
		: manifestPrefix(prefix, projectId);
}
