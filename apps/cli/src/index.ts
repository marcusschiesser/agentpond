#!/usr/bin/env node
import { randomBytes, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	configFromEnv,
	eventTypes,
	type IngestionEvent,
} from "@agentpond/core";
import { AgentPondCache } from "@agentpond/duckdb";
import {
	CliError,
	limit,
	type ParsedArgs,
	parseArgs,
	print,
	requiredFlag,
	stringFlag,
} from "./cli-support.js";
import { startDevServer } from "./commands/dev.js";
import { handleEnvironmentCommand } from "./commands/environment.js";
import { objectStoreForConfig } from "./object-store.js";
import { manualTraceResourceSpans } from "./otel-trace.js";
import {
	writeEventsAndSyncCache,
	writeOtelAndSyncCache,
} from "./sync-write.js";

export async function main(argv = process.argv): Promise<void> {
	const parsed = parseArgs(argv.slice(2));

	try {
		const [resource, action, ...rest] = parsed.positionals;
		if (!resource) return printHelp();
		if (resource === "env")
			return handleEnvironmentCommand(action, rest, parsed);
		if (parsed.flags.help || parsed.flags.h) return printHelp();
		if (resource === "dev") {
			return startDevServer(parsed);
		}
		const config = configFromEnv({
			envName: stringFlag(parsed, "env"),
			dbPath: stringFlag(parsed, "db"),
			eventStorePath: stringFlag(parsed, "event-store"),
			s3Bucket: stringFlag(parsed, "s3-bucket"),
			s3Prefix: stringFlag(parsed, "s3-prefix"),
			s3Endpoint: stringFlag(parsed, "s3-endpoint"),
		});
		const json = Boolean(parsed.flags.json);
		logImplicitEnvironment(parsed, config, json);
		if (resource === "sync") {
			const db = new AgentPondCache(config.dbPath);
			const result = await db.syncFromStore({
				store: objectStoreForConfig(config),
				projectId: config.projectId,
				prefix: config.s3.prefix,
			});
			await db.close();
			return print(result, json);
		}
		if (resource === "sql") {
			const query = rest.length > 0 ? [action, ...rest].join(" ") : action;
			if (!query) throw new CliError("Missing SQL query");
			const db = new AgentPondCache(config.dbPath);
			const rows = await db.query(query);
			await db.close();
			return print(rows, json);
		}
		if (resource === "scores" && action === "create") {
			return createScore(parsed, config, json);
		}
		if (resource === "traces" && action === "create") {
			return createTrace(parsed, config, json);
		}

		const db = new AgentPondCache(config.dbPath);
		const rows = await runReadCommand(db, resource, action, rest, parsed);
		await db.close();
		return print(rows, json);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exitCode = error instanceof CliError ? 2 : 1;
	}
}

function logImplicitEnvironment(
	parsed: ParsedArgs,
	config: ReturnType<typeof configFromEnv>,
	json: boolean,
): void {
	if (json || stringFlag(parsed, "env") || !config.environment) return;
	console.error(`Using AgentPond environment: ${config.environment.name}`);
}

async function createScore(
	parsed: ParsedArgs,
	config: ReturnType<typeof configFromEnv>,
	json: boolean,
): Promise<void> {
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

	const store = objectStoreForConfig(config);
	const manifest = await writeEventsAndSyncCache(config, store, [event]);
	print(
		{ eventId: event.id, scoreId: event.body.id, objects: manifest.objects },
		json,
	);
}

async function createTrace(
	parsed: ParsedArgs,
	config: ReturnType<typeof configFromEnv>,
	json: boolean,
): Promise<void> {
	const now = new Date().toISOString();
	const traceId = stringFlag(parsed, "id") ?? createOtelTraceId();
	const store = objectStoreForConfig(config);
	const object = await writeOtelAndSyncCache(
		config,
		store,
		manualTraceResourceSpans(parsed, traceId, now),
	);
	print({ traceId, object }, json);
}

async function runReadCommand(
	db: AgentPondCache,
	resource: string,
	action: string | undefined,
	rest: string[],
	parsed: ParsedArgs,
): Promise<Record<string, unknown>[]> {
	if (action === "--help" || !action) return helpRows(resource);

	if (resource === "traces" && action === "list") {
		return db.query(
			`SELECT * FROM traces ORDER BY start_time DESC LIMIT ${limit(parsed)}`,
		);
	}
	if (resource === "traces" && action === "get") {
		const id = rest[0];
		if (!id) throw new CliError("Missing trace id");
		return db.query(`SELECT * FROM traces WHERE id = ${sql(id)} LIMIT 1`);
	}
	if (resource === "observations" && action === "list") {
		const traceId = requiredFlag(parsed, "traceId");
		return db.query(
			// Keep this query chronological and cheap. A full parent-before-child tree
			// order is nicer for same-timestamp edge cases, but requires recursive
			// sorting for every list call.
			`SELECT * FROM observations WHERE trace_id = ${sql(traceId)} ORDER BY start_time ASC, id ASC LIMIT ${limit(parsed)}`,
		);
	}
	if (resource === "sessions" && action === "list") {
		return db.query(
			`SELECT * FROM sessions ORDER BY last_seen_at DESC LIMIT ${limit(parsed)}`,
		);
	}
	if (resource === "sessions" && action === "get") {
		const id = rest[0];
		if (!id) throw new CliError("Missing session id");
		return db.query(`SELECT * FROM sessions WHERE id = ${sql(id)} LIMIT 1`);
	}
	if (resource === "scores" && action === "list") {
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

	throw new CliError(`Unknown command: ${resource} ${action}`);
}

function parseScoreValue(value: string): string | number | boolean {
	if (value === "true") return true;
	if (value === "false") return false;
	const numeric = Number(value);
	return Number.isNaN(numeric) ? value : numeric;
}

export function createOtelTraceId(): string {
	return randomBytes(16).toString("hex");
}

function sql(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function printHelp(): void {
	console.log(`agentpond - local Langfuse-compatible trace analytics

Usage:
  agentpond dev [--host <host>] [--port <port>]
  agentpond env current [--json]
  agentpond env list [--json]
  agentpond env init <name> [--json]
  agentpond env use <name> [--json]
  agentpond sync [--json]
  agentpond traces create [--id <trace-id>] [--name <name>] [--userId <user-id>] [--sessionId <session-id>]
  agentpond traces list [--limit n] [--json]
  agentpond traces get <trace-id> [--json]
  agentpond observations list --traceId <trace-id> [--json]
  agentpond sessions list [--json]
  agentpond sessions get <session-id> [--json]
  agentpond scores create --name <name> --value <value> --traceId <trace-id>
  agentpond scores list --traceId <trace-id> [--json]
  agentpond scores list --observationId <observation-id> [--json]
  agentpond sql "select ..." [--json]

Global flags:
  --env <name>
  --db <path>
  --event-store <path>
  --s3-bucket <bucket>
  --s3-prefix <prefix>
  --s3-endpoint <url>
  --json`);
}

function helpRows(resource: string): Record<string, unknown>[] {
	return [{ resource, hint: "Run agentpond --help for command usage." }];
}

function isCliEntryPoint(): boolean {
	if (!process.argv[1]) return false;
	try {
		return (
			realpathSync(fileURLToPath(import.meta.url)) ===
			realpathSync(process.argv[1])
		);
	} catch {
		return import.meta.url === pathToFileURL(process.argv[1]).href;
	}
}

if (isCliEntryPoint()) {
	await main();
}
