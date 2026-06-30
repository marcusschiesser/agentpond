import { randomBytes } from "node:crypto";
import type { AgentPondConfig } from "@agentpond/core";
import {
	type AgentPondCache,
	DuckDbIngestionSink,
	ensureDuckDbSchema,
} from "@agentpond/duckdb";
import type { Command } from "commander";
import { CliError, limit, print, stringFlag } from "../cli-support.js";
import {
	addGlobalOptions,
	assertDevServerNotRunning,
	cacheForRead,
	commandContext,
	type GlobalOptions,
	isDevEnvironment,
} from "../command-support.js";
import { objectStoreForConfig } from "../object-store.js";
import { manualTraceResourceSpans } from "../otel-trace.js";
import { sql } from "../sql.js";
import { writeOtelAndSyncCache } from "../sync-write.js";

type TraceOptions = GlobalOptions & {
	id?: string;
	input?: string;
	limit?: string;
	metadata?: string;
	name?: string;
	output?: string;
	sessionId?: string;
	userId?: string;
};

export function registerTracesCommand(program: Command): void {
	const traces = addGlobalOptions(
		program.command("traces").description("create and read traces"),
	);

	addGlobalOptions(traces.command("create"))
		.description("create a manual trace")
		.option("--id <trace-id>", "trace id")
		.option("--name <name>", "trace name")
		.option("--userId <user-id>", "user id")
		.option("--sessionId <session-id>", "session id")
		.option("--metadata <json>", "trace metadata JSON object")
		.option("--input <json-or-string>", "trace input")
		.option("--output <json-or-string>", "trace output")
		.action(async (options: TraceOptions, command: Command) => {
			const { config, json } = commandContext(
				command.optsWithGlobals<GlobalOptions>(),
			);
			return createTrace(options, config, json);
		});

	addGlobalOptions(traces.command("list"))
		.description("list recent traces")
		.option("--limit <n>", "maximum row count", "100")
		.action(async (options: TraceOptions, command: Command) => {
			const { config, json } = commandContext(
				command.optsWithGlobals<GlobalOptions>(),
			);
			const db = cacheForRead(config);
			try {
				const rows = await readTraceCommand(db, "list", [], options);
				return print(rows, json);
			} finally {
				await db.close();
			}
		});

	addGlobalOptions(traces.command("get <trace-id>"))
		.description("read one trace")
		.action(
			async (
				id: string | undefined,
				_options: GlobalOptions,
				command: Command,
			) => {
				const { config, json } = commandContext(
					command.optsWithGlobals<GlobalOptions>(),
				);
				const db = cacheForRead(config);
				try {
					const rows = await readTraceCommand(db, "get", [id ?? ""], {});
					return print(rows, json);
				} finally {
					await db.close();
				}
			},
		);
}

async function readTraceCommand(
	db: AgentPondCache,
	action: string,
	rest: string[],
	options: TraceOptions,
): Promise<Record<string, unknown>[]> {
	if (action === "list") {
		return db.query(
			`SELECT * FROM traces ORDER BY start_time DESC LIMIT ${limit(options)}`,
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
	options: TraceOptions,
	config: AgentPondConfig,
	json: boolean,
): Promise<void> {
	assertDevServerNotRunning(config);
	const now = new Date().toISOString();
	const traceId = stringFlag(options, "id") ?? createOtelTraceId();
	const resourceSpans = manualTraceResourceSpans(options, traceId, now);
	if (isDevEnvironment(config)) {
		await ensureDuckDbSchema(config.dbPath);
		const result = await new DuckDbIngestionSink(
			config.dbPath,
		).writeOtelResourceSpans({
			projectId: config.projectId,
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
