import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

type ProcessedTable = "processed_manifests" | "processed_objects";

export class DuckDbOperations {
	private instance?: DuckDBInstance;
	private connection?: DuckDBConnection;

	constructor(readonly dbPath: string) {
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

	async processedKeyExists(
		table: ProcessedTable,
		key: string,
	): Promise<boolean> {
		const rows = await this.all(
			`SELECT key FROM ${table} WHERE key = ${this.sql(key)} LIMIT 1`,
		);
		return rows.length > 0;
	}

	async insertProcessedKey(
		table: ProcessedTable,
		key: string,
		manifestKey?: string,
	): Promise<void> {
		if (table === "processed_objects") {
			await this.exec(
				`INSERT INTO processed_objects (key, manifest_key) VALUES (${this.sql(key)}, ${this.sql(manifestKey)})`,
			);
			return;
		}
		await this.exec(
			`INSERT INTO processed_manifests (key) VALUES (${this.sql(key)})`,
		);
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
			this.instance = await DuckDBInstance.create(this.dbPath);
			this.connection = await this.instance.connect();
		}
		return this.connection;
	}
}

export function sql(value: unknown): string {
	if (value === null || value === undefined) return "NULL";
	return `'${String(value).replaceAll("'", "''")}'`;
}
