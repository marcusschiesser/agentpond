#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
	AcceptedEventWriter,
	type AgentPondConfig,
	type BatchManifest,
	configFromEnv,
	eventTypes,
	type IngestionEvent,
	loadEnvFile,
	type ObjectStore,
	S3ObjectStore,
} from "@agentpond/core";
import { AgentPondDuckDb } from "@agentpond/duckdb";

type ParsedArgs = {
	flags: Record<string, string | boolean>;
	positionals: string[];
};

export async function main(argv = process.argv): Promise<void> {
	const parsed = parseArgs(argv.slice(2));
	if (parsed.flags.env && typeof parsed.flags.env === "string") {
		loadEnvFile(parsed.flags.env);
	}

	const config = configFromEnv({
		dbPath: stringFlag(parsed, "db"),
		s3Bucket: stringFlag(parsed, "s3-bucket"),
		s3Prefix: stringFlag(parsed, "s3-prefix"),
		s3Endpoint: stringFlag(parsed, "s3-endpoint"),
	});
	const json = Boolean(parsed.flags.json);
	const [resource, action, ...rest] = parsed.positionals;

	try {
		if (!resource || parsed.flags.help || parsed.flags.h) return printHelp();
		if (resource === "sync") {
			const db = new AgentPondDuckDb(config.dbPath);
			const result = await db.syncFromStore({
				store: new S3ObjectStore(config.s3),
				projectId: config.projectId,
				prefix: config.s3.prefix,
			});
			await db.close();
			return print(result, json);
		}
		if (resource === "sql") {
			const query = rest.length > 0 ? [action, ...rest].join(" ") : action;
			if (!query) throw new CliError("Missing SQL query");
			const db = new AgentPondDuckDb(config.dbPath);
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

		const db = new AgentPondDuckDb(config.dbPath);
		const rows = await runReadCommand(db, resource, action, rest, parsed);
		await db.close();
		return print(rows, json);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exitCode = error instanceof CliError ? 2 : 1;
	}
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
		},
	};

	const store = new S3ObjectStore(config.s3);
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
	const traceId = stringFlag(parsed, "id") ?? randomUUID();
	const event: IngestionEvent = {
		id: randomUUID(),
		timestamp: now,
		type: eventTypes.TRACE_CREATE,
		body: {
			id: traceId,
			name: stringFlag(parsed, "name") ?? "manual trace",
			userId: stringFlag(parsed, "userId"),
			sessionId: stringFlag(parsed, "sessionId"),
			metadata: jsonFlag(parsed, "metadata"),
			input: jsonOrStringFlag(parsed, "input"),
			output: jsonOrStringFlag(parsed, "output"),
			startTime: now,
		},
	};

	const store = new S3ObjectStore(config.s3);
	const manifest = await writeEventsAndSyncCache(config, store, [event]);
	print({ eventId: event.id, traceId, objects: manifest.objects }, json);
}

export async function writeEventsAndSyncCache(
	config: Pick<AgentPondConfig, "dbPath" | "projectId" | "s3">,
	store: ObjectStore,
	events: IngestionEvent[],
): Promise<BatchManifest> {
	const writer = new AcceptedEventWriter({
		store,
		projectId: config.projectId,
		prefix: config.s3.prefix,
	});
	const manifest = await writer.writeAcceptedEvents(events);
	const db = new AgentPondDuckDb(config.dbPath);
	try {
		await db.syncFromStore({
			store,
			projectId: config.projectId,
			prefix: config.s3.prefix,
		});
	} finally {
		await db.close();
	}
	return manifest;
}

async function runReadCommand(
	db: AgentPondDuckDb,
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
			`SELECT * FROM observations WHERE trace_id = ${sql(traceId)} ORDER BY start_time ASC LIMIT ${limit(parsed)}`,
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

function parseArgs(args: string[]): ParsedArgs {
	const flags: ParsedArgs["flags"] = {};
	const positionals: string[] = [];
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i];
		if (!arg.startsWith("--")) {
			positionals.push(arg);
			continue;
		}
		const key = arg.slice(2);
		if (["json", "help"].includes(key)) {
			flags[key] = true;
			continue;
		}
		const value = args[i + 1];
		if (!value || value.startsWith("--"))
			throw new CliError(`Missing value for --${key}`);
		flags[key] = value;
		i += 1;
	}
	return { flags, positionals };
}

function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
	const value = parsed.flags[name];
	return typeof value === "string" ? value : undefined;
}

function requiredFlag(parsed: ParsedArgs, name: string): string {
	const value = stringFlag(parsed, name);
	if (!value) throw new CliError(`Missing --${name}`);
	return value;
}

function jsonFlag(
	parsed: ParsedArgs,
	name: string,
): Record<string, unknown> | undefined {
	const raw = stringFlag(parsed, name);
	if (!raw) return undefined;
	const value = JSON.parse(raw) as unknown;
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new CliError(`--${name} must be a JSON object`);
	}
	return value as Record<string, unknown>;
}

function jsonOrStringFlag(parsed: ParsedArgs, name: string): unknown {
	const raw = stringFlag(parsed, name);
	if (!raw) return undefined;
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return raw;
	}
}

function limit(parsed: ParsedArgs): number {
	const raw = stringFlag(parsed, "limit");
	if (!raw) return 100;
	const value = Number.parseInt(raw, 10);
	if (!Number.isFinite(value) || value < 1 || value > 10000)
		throw new CliError("--limit must be between 1 and 10000");
	return value;
}

function parseScoreValue(value: string): string | number | boolean {
	if (value === "true") return true;
	if (value === "false") return false;
	const numeric = Number(value);
	return Number.isNaN(numeric) ? value : numeric;
}

function sql(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function print(value: unknown, json: boolean): void {
	if (json) {
		console.log(
			JSON.stringify(
				value,
				(_key, item) => (typeof item === "bigint" ? item.toString() : item),
				2,
			),
		);
		return;
	}
	if (Array.isArray(value)) {
		console.table(value);
		return;
	}
	console.log(JSON.stringify(value, null, 2));
}

function printHelp(): void {
	console.log(`agentpond - local Langfuse-compatible trace analytics

Usage:
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
  --env <path>
  --db <path>
  --s3-bucket <bucket>
  --s3-prefix <prefix>
  --s3-endpoint <url>
  --json`);
}

function helpRows(resource: string): Record<string, unknown>[] {
	return [{ resource, hint: "Run agentpond --help for command usage." }];
}

class CliError extends Error {}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	await main();
}
