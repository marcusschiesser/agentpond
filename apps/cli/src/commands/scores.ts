import { randomUUID } from "node:crypto";
import {
	type AgentPondConfig,
	eventTypes,
	type IngestionEvent,
} from "@agentpond/core";
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
import { sql } from "../sql.js";
import { writeEventsAndSyncCache } from "../sync-write.js";

type ScoreOptions = GlobalOptions & {
	comment?: string;
	dataType?: string;
	id?: string;
	limit?: string;
	name?: string;
	observationId?: string;
	sessionId?: string;
	source?: string;
	traceId?: string;
	value?: string;
};

type ScoreCreateOptions = ScoreOptions & {
	name: string;
	value: string;
};

export function registerScoresCommand(program: Command): void {
	const scores = addGlobalOptions(
		program.command("scores").description("create and read scores"),
	);

	addGlobalOptions(scores.command("create"))
		.description("create a score")
		.requiredOption("--name <name>", "score name")
		.requiredOption("--value <value>", "score value")
		.option("--id <score-id>", "score id")
		.option("--traceId <trace-id>", "trace id")
		.option("--observationId <observation-id>", "observation id")
		.option("--sessionId <session-id>", "session id")
		.option("--dataType <type>", "score data type")
		.option("--source <source>", "score source", "API")
		.option("--comment <comment>", "score comment")
		.action(async (options: ScoreCreateOptions, command: Command) => {
			const { config, json } = commandContext(
				command.optsWithGlobals<GlobalOptions>(),
			);
			return createScore(options, config, json);
		});

	addGlobalOptions(scores.command("list"))
		.description("list scores")
		.option("--traceId <trace-id>", "trace id")
		.option("--observationId <observation-id>", "observation id")
		.option("--limit <n>", "maximum row count", "100")
		.action(async (options: ScoreOptions, command: Command) => {
			const { config, json } = commandContext(
				command.optsWithGlobals<GlobalOptions>(),
			);
			const db = cacheForRead(config);
			try {
				const rows = await readScoreCommand(db, "list", options);
				return print(rows, json);
			} finally {
				await db.close();
			}
		});
}

async function readScoreCommand(
	db: AgentPondCache,
	action: string,
	options: ScoreOptions,
): Promise<Record<string, unknown>[]> {
	if (action === "list") {
		const traceId = stringFlag(options, "traceId");
		const observationId = stringFlag(options, "observationId");
		if (!traceId && !observationId)
			throw new CliError("scores list requires --traceId or --observationId");
		const filters = [
			traceId ? `trace_id = ${sql(traceId)}` : undefined,
			observationId ? `observation_id = ${sql(observationId)}` : undefined,
		].filter(Boolean);
		return db.query(
			`SELECT * FROM scores WHERE ${filters.join(" AND ")} ORDER BY timestamp DESC LIMIT ${limit(options)}`,
		);
	}
	throw new CliError(`Unknown command: scores ${action}`);
}

export async function createScore(
	options: ScoreCreateOptions,
	config: AgentPondConfig,
	json: boolean,
): Promise<void> {
	assertDevServerNotRunning(config);
	const source = stringFlag(options, "source") ?? "API";
	if (source === "EVAL") {
		throw new CliError(
			"scores create only allows source=API or source=ANNOTATION",
		);
	}
	if (source !== "API" && source !== "ANNOTATION") {
		throw new CliError("source must be API or ANNOTATION");
	}
	const now = new Date().toISOString();
	const event: IngestionEvent = {
		id: randomUUID(),
		timestamp: now,
		type: eventTypes.SCORE_CREATE,
		body: {
			id: stringFlag(options, "id") ?? randomUUID(),
			traceId: stringFlag(options, "traceId"),
			observationId: stringFlag(options, "observationId"),
			sessionId: stringFlag(options, "sessionId"),
			name: options.name,
			value: parseScoreValue(options.value),
			dataType: stringFlag(options, "dataType") as
				| "NUMERIC"
				| "CATEGORICAL"
				| "BOOLEAN"
				| "CORRECTION"
				| "TEXT"
				| undefined,
			source,
			comment: stringFlag(options, "comment"),
			createdAt: now,
			environment: "default",
		},
	};

	if (isDevEnvironment(config)) {
		await ensureDuckDbSchema(config.dbPath);
		const result = await new DuckDbIngestionSink(config.dbPath).writeEvents({
			projectId: config.projectId,
			prefix: config.prefix,
			events: [event],
			source: "cli-dev-score",
		});
		print({ eventId: event.id, scoreId: event.body.id, ...result }, json);
		return;
	}
	const store = objectStoreForConfig(config);
	const manifest = await writeEventsAndSyncCache(config, store, [event]);
	print(
		{ eventId: event.id, scoreId: event.body.id, objects: manifest.objects },
		json,
	);
}

function parseScoreValue(value: string): string | number | boolean {
	if (value === "true") return true;
	if (value === "false") return false;
	const numeric = Number(value);
	return Number.isNaN(numeric) ? value : numeric;
}
