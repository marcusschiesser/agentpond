import { DuckDbDirectIngestion } from "../ingestion/direct-ingestion.js";
import { type DuckDbAccessMode, DuckDbOperations } from "./db-operations.js";
import { DuckDbStoreSync } from "./store-sync.js";
import type { SyncFromStoreParams, SyncResult } from "./sync-types.js";
export type {
	SyncFromStoreParams,
	SyncProgress,
	SyncResult,
} from "./sync-types.js";

export class AgentPondCache {
	private readonly db: DuckDbOperations;

	constructor(
		readonly dbPath: string,
		private readonly options: { accessMode?: DuckDbAccessMode } = {},
	) {
		this.db = new DuckDbOperations(dbPath, options.accessMode);
	}

	async init(): Promise<void> {
		if (this.options.accessMode === "readonly") return;
		await this.db.createSchema();
	}

	async syncFromStore(params: SyncFromStoreParams): Promise<SyncResult> {
		await this.init();
		return new DuckDbStoreSync(this.db).syncFromStore(params);
	}

	async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
		await this.init();
		return this.db.all<T>(sql);
	}

	directIngestion(): DuckDbDirectIngestion {
		return new DuckDbDirectIngestion(this.db);
	}

	async close(): Promise<void> {
		await this.db.close();
	}
}
