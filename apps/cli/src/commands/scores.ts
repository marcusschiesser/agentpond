import { randomUUID } from "node:crypto";
import {
	type configFromEnv,
	eventTypes,
	type IngestionEvent,
} from "@agentpond/core";
import {
	type AgentPondCache,
	DuckDbIngestionSink,
	ensureDuckDbSchema,
} from "@agentpond/duckdb";
import {
	CliError,
	limit,
	type ParsedArgs,
	print,
	requiredFlag,
	stringFlag,
} from "../cli-support.js";
import { objectStoreForConfig } from "../object-store.js";
import { sql } from "../sql.js";
import { writeEventsAndSyncCache } from "../sync-write.js";
import {
	assertDevServerNotRunning,
	cacheForRead,
	isDevEnvironment,
} from "./environment.js";

export async function handleScoreCommand(
	action: string | undefined,
	parsed: ParsedArgs,
	config: ReturnType<typeof configFromEnv>,
	json: boolean,
): Promise<void> {
	if (action === "create") return createScore(parsed, config, json);
	if (action === "--help" || !action) return print(helpRows("scores"), json);
	const db = cacheForRead(config);
	try {
		const rows = await readScoreCommand(db, action, parsed);
		return print(rows, json);
	} finally {
		await db.close();
	}
}

async function readScoreCommand(
	db: AgentPondCache,
	action: string,
	parsed: ParsedArgs,
): Promise<Record<string, unknown>[]> {
	if (action === "list") {
		const traceId = stringFlag(parsed, "traceId");
		const observationId = stringFlag(parsed, "observationId");
		if (!traceId && !observationId)
			throw new CliError("scores list requires --traceId or --observationId");
		const filters = [
			traceId ? `trace_id = ${sql(traceId)}` : undefined,
			observationId ? `observation_id = ${sql(observationId)}` : undefined,
		].filter(Boolean);
		return db.query(
			`SELECT * FROM scores WHERE ${filters.join(" AND ")} ORDER BY timestamp DESC LIMIT ${limit(parsed)}`,
		);
	}
	throw new CliError(`Unknown command: scores ${action}`);
}

export async function createScore(
	parsed: ParsedArgs,
	config: ReturnType<typeof configFromEnv>,
	json: boolean,
): Promise<void> {
	assertDevServerNotRunning(config);
	const name = requiredFlag(parsed, "name");
	const value = requiredFlag(parsed, "value");
	const source = stringFlag(parsed, "source") ?? "API";
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
			id: stringFlag(parsed, "id") ?? randomUUID(),
			traceId: stringFlag(parsed, "traceId"),
			observationId: stringFlag(parsed, "observationId"),
			sessionId: stringFlag(parsed, "sessionId"),
			name,
			value: parseScoreValue(value),
			dataType: stringFlag(parsed, "dataType") as
				| "NUMERIC"
				| "CATEGORICAL"
				| "BOOLEAN"
				| "CORRECTION"
				| "TEXT"
				| undefined,
			source,
			comment: stringFlag(parsed, "comment"),
			createdAt: now,
			environment: "default",
		},
	};

	if (isDevEnvironment(config)) {
		await ensureDuckDbSchema(config.dbPath);
		const result = await new DuckDbIngestionSink(config.dbPath).writeEvents({
			projectId: config.projectId,
			prefix: config.s3.prefix,
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

function helpRows(resource: string): Record<string, unknown>[] {
	return [{ resource, hint: "Run agentpond --help for command usage." }];
}
