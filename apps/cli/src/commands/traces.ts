import { randomBytes } from "node:crypto";
import { configFromEnv } from "@agentpond/core";
import {
	AgentPondCache,
	DuckDbIngestionSink,
	ensureDuckDbSchema,
} from "@agentpond/duckdb";
import {
	CliError,
	limit,
	type ParsedArgs,
	print,
	stringFlag,
} from "../cli-support.js";
import {
	assertDevServerNotRunning,
	cacheForRead,
	isDevEnvironment,
} from "./environment.js";
import { objectStoreForConfig } from "../object-store.js";
import { manualTraceResourceSpans } from "../otel-trace.js";
import { sql } from "../sql.js";
import { writeOtelAndSyncCache } from "../sync-write.js";

export async function handleTraceCommand(
	action: string | undefined,
	rest: string[],
	parsed: ParsedArgs,
	config: ReturnType<typeof configFromEnv>,
	json: boolean,
): Promise<void> {
	if (action === "create") return createTrace(parsed, config, json);
	if (action === "--help" || !action) return print(helpRows("traces"), json);
	const db = cacheForRead(config);
	try {
		const rows = await readTraceCommand(db, action, rest, parsed);
		return print(rows, json);
	} finally {
		await db.close();
	}
}

async function readTraceCommand(
	db: AgentPondCache,
	action: string,
	rest: string[],
	parsed: ParsedArgs,
): Promise<Record<string, unknown>[]> {
	if (action === "list") {
		return db.query(
			`SELECT * FROM traces ORDER BY start_time DESC LIMIT ${limit(parsed)}`,
		);
	}
	if (action === "get") {
		const id = rest[0];
		if (!id) throw new CliError("Missing trace id");
		return db.query(`SELECT * FROM traces WHERE id = ${sql(id)} LIMIT 1`);
	}
	throw new CliError(`Unknown command: traces ${action}`);
}

export async function createTrace(
	parsed: ParsedArgs,
	config: ReturnType<typeof configFromEnv>,
	json: boolean,
): Promise<void> {
	assertDevServerNotRunning(config);
	const now = new Date().toISOString();
	const traceId = stringFlag(parsed, "id") ?? createOtelTraceId();
	const resourceSpans = manualTraceResourceSpans(parsed, traceId, now);
	if (isDevEnvironment(config)) {
		await ensureDuckDbSchema(config.dbPath);
		const result = await new DuckDbIngestionSink(
			config.dbPath,
		).writeOtelResourceSpans({
			projectId: config.projectId,
			prefix: config.s3.prefix,
			resourceSpans,
			source: "cli-dev-trace",
		});
		print({ traceId, ...result }, json);
		return;
	}
	const store = objectStoreForConfig(config);
	const object = await writeOtelAndSyncCache(config, store, resourceSpans);
	print({ traceId, object }, json);
}

export function createOtelTraceId(): string {
	return randomBytes(16).toString("hex");
}

function helpRows(resource: string): Record<string, unknown>[] {
	return [{ resource, hint: "Run agentpond --help for command usage." }];
}
