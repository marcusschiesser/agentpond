import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import duckdb from "duckdb";
import {
  manifestPrefix,
  type BatchManifest,
  type IngestionEvent,
  type ObjectStore,
} from "@agentpond/core";

type DuckConnection = {
  run(sql: string, callback: (err: Error | null) => void): void;
  all<T = Record<string, unknown>>(sql: string, callback: (err: Error | null, rows: T[]) => void): void;
  close(callback: (err: Error | null) => void): void;
};

export type SyncResult = {
  manifestsProcessed: number;
  objectsProcessed: number;
  eventsProcessed: number;
};

export class AgentPondDuckDb {
  private readonly db: duckdb.Database;
  private connection?: DuckConnection;

  constructor(readonly dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new duckdb.Database(dbPath);
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
  }): Promise<SyncResult> {
    await this.init();
    const result: SyncResult = { manifestsProcessed: 0, objectsProcessed: 0, eventsProcessed: 0 };
    const manifestKeys = await params.store.listKeys(manifestPrefix(params.prefix, params.projectId));

    for (const manifestKey of manifestKeys) {
      if (await this.exists("processed_manifests", manifestKey)) continue;
      const manifest = await params.store.getJson<BatchManifest>(manifestKey);
      for (const object of manifest.objects) {
        if (await this.exists("processed_objects", object.key)) continue;
        const events = await params.store.getJson<IngestionEvent[]>(object.key);
        for (const event of events) {
          await this.upsertRawEvent({
            projectId: manifest.projectId,
            manifestKey,
            objectKey: object.key,
            entityId: object.entityId,
            event,
          });
          await this.projectEvent(manifest.projectId, event);
          result.eventsProcessed += 1;
        }
        await this.insertKey("processed_objects", object.key, manifestKey);
        result.objectsProcessed += 1;
      }
      await this.insertKey("processed_manifests", manifestKey);
      result.manifestsProcessed += 1;
    }

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
      await new Promise<void>((resolve, reject) => {
        connection.close((err) => (err && !isAlreadyClosedConnectionError(err) ? reject(err) : resolve()));
      });
    }
    await new Promise<void>((resolve, reject) => {
      this.db.close((err) => (err && !isAlreadyClosedConnectionError(err) ? reject(err) : resolve()));
    });
  }

  private async projectEvent(projectId: string, event: IngestionEvent): Promise<void> {
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
      const { numberValue, stringValue: scoreStringValue, dataType } = scoreValue(body.value, stringValue(body.dataType));
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
    const totalCost = numericValue(body.totalCost) ?? costDetailsTotal(costDetails);
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
    manifestKey: string;
    objectKey: string;
    entityId: string;
    event: IngestionEvent;
  }): Promise<void> {
    await this.exec(`DELETE FROM events_raw WHERE event_id = ${sql(params.event.id)}`);
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

  private async exists(table: "processed_manifests" | "processed_objects", key: string): Promise<boolean> {
    const rows = await this.all(`SELECT key FROM ${table} WHERE key = ${sql(key)} LIMIT 1`);
    return rows.length > 0;
  }

  private async insertKey(table: "processed_manifests" | "processed_objects", key: string, manifestKey?: string): Promise<void> {
    if (table === "processed_objects") {
      await this.exec(`INSERT INTO processed_objects (key, manifest_key) VALUES (${sql(key)}, ${sql(manifestKey)})`);
      return;
    }
    await this.exec(`INSERT INTO processed_manifests (key) VALUES (${sql(key)})`);
  }

  private getConnection(): DuckConnection {
    if (!this.connection) this.connection = this.db.connect() as unknown as DuckConnection;
    return this.connection;
  }

  private async exec(sqlText: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.getConnection().run(sqlText, (err) => (err ? reject(err) : resolve()));
    });
  }

  private async all<T = Record<string, unknown>>(sqlText: string): Promise<T[]> {
    return new Promise<T[]>((resolve, reject) => {
      this.getConnection().all<T>(sqlText, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
  }
}

function sql(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
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
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function costDetailsTotal(costDetails: Record<string, unknown> | undefined): number | undefined {
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
    const metadataSource = stringValue((metadata as Record<string, unknown>).source);
    if (isScoreSource(metadataSource)) return metadataSource;
  }
  return "API";
}

function isScoreSource(value: string | undefined): value is "API" | "EVAL" | "ANNOTATION" {
  return value === "API" || value === "EVAL" || value === "ANNOTATION";
}

function isAlreadyClosedConnectionError(error: Error): boolean {
  return error.message.includes("Connection was never established or has been closed already");
}

function scoreValue(value: unknown, declaredDataType: string | undefined): {
  numberValue: number | null;
  stringValue: string | null;
  dataType: string;
} {
  if (typeof value === "number") return { numberValue: value, stringValue: null, dataType: declaredDataType ?? "NUMERIC" };
  if (typeof value === "boolean") return { numberValue: value ? 1 : 0, stringValue: String(value), dataType: declaredDataType ?? "BOOLEAN" };
  if (typeof value === "string") {
    const numeric = Number(value);
    if ((declaredDataType ?? "") === "NUMERIC" && !Number.isNaN(numeric)) {
      return { numberValue: numeric, stringValue: value, dataType: "NUMERIC" };
    }
    return { numberValue: null, stringValue: value, dataType: declaredDataType ?? "CATEGORICAL" };
  }
  return { numberValue: null, stringValue: null, dataType: declaredDataType ?? "NUMERIC" };
}
