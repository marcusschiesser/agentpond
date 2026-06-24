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

	async ensureSchema(): Promise<void> {
		if (this.options.accessMode === "readonly") return;
		await this.db.createSchema();
	}

	async syncFromStore(params: SyncFromStoreParams): Promise<SyncResult> {
		await this.ensureSchema();
		return new DuckDbStoreSync(this.db).syncFromStore(params);
	}

	async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
		try {
			return await this.db.all<T>(sql);
		} catch (error) {
			if (
				this.options.accessMode === "readonly" &&
				isDuckDbLockConflict(error)
			) {
				throw new Error(
					"DuckDB is currently locked by the dev server while it is writing; retry the read command.",
				);
			}
			throw error;
		}
	}

	directIngestion(): DuckDbDirectIngestion {
		return new DuckDbDirectIngestion(this.db);
	}

	async close(): Promise<void> {
		await this.db.close();
	}
}

export async function ensureDuckDbSchema(dbPath: string): Promise<void> {
	const db = new AgentPondCache(dbPath);
	try {
		await db.ensureSchema();
	} finally {
		await db.close();
	}
}

function isDuckDbLockConflict(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("Could not set lock") ||
		message.includes("Conflicting lock")
	);
}
