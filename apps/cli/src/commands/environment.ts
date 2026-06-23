import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	configFromEnv,
	DEV_SERVER_RUNNING_MESSAGE,
	initAgentPondEnvironment,
	isDevServerRunning,
	listAgentPondEnvironments,
	resolveAgentPondEnvironment,
	selectAgentPondEnvironment,
} from "@agentpond/core";
import { AgentPondCache } from "@agentpond/duckdb";
import {
	CliError,
	type ParsedArgs,
	print,
	stringFlag,
} from "../cli-support.js";

export async function handleEnvironmentCommand(
	action: string | undefined,
	rest: string[],
	parsed: ParsedArgs,
): Promise<void> {
	if (!action || parsed.flags.help || parsed.flags.h)
		return printEnvironmentHelp();
	if (action === "list") {
		const selected = resolveAgentPondEnvironment({
			name: stringFlag(parsed, "env"),
		}).name;
		const names = listAgentPondEnvironments();
		const rows = (names.length > 0 ? names : [selected]).map((name) => ({
			name,
			selected: name === selected,
		}));
		return print(rows, Boolean(parsed.flags.json));
	}
	if (action === "current") {
		return print(
			resolveAgentPondEnvironment({ name: stringFlag(parsed, "env") }),
			Boolean(parsed.flags.json),
		);
	}
	if (action === "use") {
		const name = rest[0];
		if (!name) throw new CliError("Missing environment name");
		const environment = selectAgentPondEnvironment(name);
		return print({ selected: environment.name }, Boolean(parsed.flags.json));
	}
	if (action === "init") {
		const name = rest[0];
		if (!name) throw new CliError("Missing environment name");
		const environment = initAgentPondEnvironment(name);
		return print(
			{
				name: environment.name,
				envFile: environment.envFilePath,
				dbPath: environment.dbPath,
				eventStorePath: environment.eventStorePath,
			},
			Boolean(parsed.flags.json),
		);
	}
	throw new CliError(`Unknown command: env ${action}`);
}

export function isDevEnvironment(
	config: ReturnType<typeof configFromEnv>,
): boolean {
	return config.environment?.name === "dev";
}

export function cacheForRead(
	config: ReturnType<typeof configFromEnv>,
): AgentPondCache {
	if (usesRunningDevCache(config)) {
		if (!existsSync(config.dbPath)) {
			throw new CliError(
				"dev cache is not initialized yet; ingest a trace or stop the dev server",
			);
		}
		return new AgentPondCache(config.dbPath, { accessMode: "readonly" });
	}
	return new AgentPondCache(config.dbPath);
}

export function assertDevServerNotRunning(
	config: ReturnType<typeof configFromEnv>,
): void {
	if (usesRunningDevCache(config)) {
		throw new CliError(DEV_SERVER_RUNNING_MESSAGE);
	}
}

function usesRunningDevCache(
	config: ReturnType<typeof configFromEnv>,
): boolean {
	return (
		config.environment !== undefined &&
		resolve(config.dbPath) === resolve(config.environment.dbPath) &&
		isDevServerRunning(config.environment)
	);
}

function printEnvironmentHelp(): void {
	console.log(`agentpond env - manage local AgentPond environments

Usage:
  agentpond env current [--json]
  agentpond env list [--json]
  agentpond env init <name> [--json]
  agentpond env use <name> [--json]

Environments are stored under .agentpond/envs/<name>.env and use separate
DuckDB caches under .agentpond/envs/<name>/cache.duckdb.`);
}
