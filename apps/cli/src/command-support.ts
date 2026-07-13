import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type AgentPondConfig,
	type AgentPondEnvironmentContext,
	DEV_SERVER_RUNNING_MESSAGE,
	isDevServerRunning,
} from "@agentpond/core";
import { AgentPondCache } from "@agentpond/duckdb";
import type { Command } from "commander";
import { CliError } from "./cli-support.js";
import { environmentContextForCommand } from "./environment-context.js";

export type GlobalOptions = {
	env?: string;
	json?: boolean;
};

export type CommandContext = {
	context: AgentPondEnvironmentContext;
	json: boolean;
};

export function addGlobalOptions(command: Command): Command {
	return command
		.option("--env <name>", "use an environment for this command")
		.option("--json", "print machine-readable JSON output");
}

export function commandContext(options: GlobalOptions): CommandContext {
	const context = environmentContextForCommand({ envName: options.env });
	const json = Boolean(options.json);
	logImplicitEnvironment(options, context.config, json);
	return { context, json };
}

export function configForCommand(options: GlobalOptions): AgentPondConfig {
	return environmentContextForCommand({ envName: options.env }).config;
}

export function cacheForRead(config: AgentPondConfig): AgentPondCache {
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

export function assertDevServerNotRunning(config: AgentPondConfig): void {
	if (usesRunningDevCache(config)) {
		throw new CliError(DEV_SERVER_RUNNING_MESSAGE);
	}
}

function logImplicitEnvironment(
	options: GlobalOptions,
	config: AgentPondConfig,
	json: boolean,
): void {
	if (json || options.env || !config.environment) return;
	console.error(`Using environment: ${config.environment.name}`);
}

function usesRunningDevCache(config: AgentPondConfig): boolean {
	return (
		config.environment !== undefined &&
		resolve(config.dbPath) ===
			resolve(join(config.environment.envDir, "cache.duckdb")) &&
		isDevServerRunning(config.environment)
	);
}
