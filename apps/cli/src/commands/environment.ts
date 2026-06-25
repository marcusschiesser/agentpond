import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type configFromEnv,
	DEV_SERVER_RUNNING_MESSAGE,
	initAgentPondEnvironment,
	isDevServerRunning,
	listAgentPondEnvironments,
	parseEnvFileEntries,
	resolveAgentPondEnvironment,
	selectAgentPondEnvironment,
} from "@agentpond/core";
import { AgentPondCache } from "@agentpond/duckdb";
import {
	CliError,
	type ParsedArgs,
	parsePort,
	print,
	stringFlag,
} from "../cli-support.js";
import { devSdkEnvironment } from "../dev-env.js";

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
		const environment = resolveAgentPondEnvironment({
			name: stringFlag(parsed, "env"),
		});
		if (parsed.flags.json) return print(environment, true);
		return print([environment], false);
	}
	if (action === "get") {
		const name = rest[0];
		if (!name) throw new CliError("Missing environment name");
		return printEnvironmentExports(name, parsed);
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
			},
			Boolean(parsed.flags.json),
		);
	}
	throw new CliError(`Unknown command: env ${action}`);
}

function printEnvironmentExports(name: string, parsed: ParsedArgs): void {
	const entries =
		name === "dev"
			? devSdkEnvironment(
					stringFlag(parsed, "host") ?? "127.0.0.1",
					parsePort(stringFlag(parsed, "port") ?? "4318"),
				)
			: readEnvironmentFileExports(name);
	for (const entry of entries) {
		console.log(`export ${entry.key}=${shellValue(entry.value)}`);
	}
}

function readEnvironmentFileExports(name: string): EnvVar[] {
	const environment = resolveAgentPondEnvironment({ name });
	if (!existsSync(environment.envFilePath)) {
		throw new CliError(
			`Environment "${environment.name}" is not initialized; run agentpond env init ${environment.name}`,
		);
	}
	return parseEnvFileEntries(environment.envFilePath);
}

function shellValue(value: string): string {
	if (/^[A-Za-z0-9_@%+=:,./-]*$/.test(value)) return value;
	return `'${value.replaceAll("'", "'\\''")}'`;
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
		resolve(config.dbPath) ===
			resolve(join(config.environment.envDir, "cache.duckdb")) &&
		isDevServerRunning(config.environment)
	);
}

function printEnvironmentHelp(): void {
	console.log(`agentpond env - manage local AgentPond environments

Usage:
  agentpond env current [--json]
  agentpond env get <name> [--host <host>] [--port <port>]
  agentpond env list [--json]
  agentpond env init <name> [--json]
  agentpond env use <name> [--json]

Environments are stored under .agentpond/envs/<name>.env and use separate
DuckDB caches under .agentpond/envs/<name>/cache.duckdb.`);
}
