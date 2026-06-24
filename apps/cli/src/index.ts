#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configFromEnv } from "@agentpond/core";
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
import {
	cacheForRead,
	handleEnvironmentCommand,
	isDevEnvironment,
} from "./commands/environment.js";
import { handleScoreCommand } from "./commands/scores.js";
import { handleTraceCommand } from "./commands/traces.js";
import { objectStoreForConfig } from "./object-store.js";
import { sql } from "./sql.js";

export { createOtelTraceId } from "./commands/traces.js";

export async function main(argv = process.argv): Promise<void> {
	const parsed = parseArgs(argv.slice(2));

	try {
		const [resource, action, ...rest] = parsed.positionals;
		if (!resource) return printHelp();
		if (resource === "env")
			return handleEnvironmentCommand(action, rest, parsed);
		if (parsed.flags.help || parsed.flags.h) return printHelp();
		if (resource === "dev") {
			return await startDevServer(parsed);
		}
		const config = configFromEnv({
			envName: stringFlag(parsed, "env"),
			dbPath: stringFlag(parsed, "db"),
			s3Bucket: stringFlag(parsed, "s3-bucket"),
			s3Prefix: stringFlag(parsed, "s3-prefix"),
			s3Endpoint: stringFlag(parsed, "s3-endpoint"),
		});
		const json = Boolean(parsed.flags.json);
		logImplicitEnvironment(parsed, config, json);
		if (resource === "sync") {
			if (isDevEnvironment(config)) {
				return print(
					{
						skipped: true,
						reason: "dev environment is written directly by agentpond dev",
					},
					json,
				);
			}
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
			const db = cacheForRead(config);
			const rows = await db.query(query);
			await db.close();
			return print(rows, json);
		}
		if (resource === "traces") {
			return await handleTraceCommand(action, rest, parsed, config, json);
		}
		if (resource === "scores") {
			return await handleScoreCommand(action, parsed, config, json);
		}

		const db = cacheForRead(config);
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

async function runReadCommand(
	db: AgentPondCache,
	resource: string,
	action: string | undefined,
	rest: string[],
	parsed: ParsedArgs,
): Promise<Record<string, unknown>[]> {
	if (action === "--help" || !action) return helpRows(resource);

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
	throw new CliError(`Unknown command: ${resource} ${action}`);
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
