import { existsSync } from "node:fs";
import {
	type AgentPondStoreType,
	initAgentPondEnvironment,
	listAgentPondEnvironments,
	parseEnvFileEntries,
	readDevServerLock,
	resolveAgentPondEnvironment,
	selectAgentPondEnvironment,
} from "@agentpond/core";
import { select } from "@inquirer/prompts";
import type { Command } from "commander";
import { CliError, print } from "../cli-support.js";
import { addGlobalOptions, type GlobalOptions } from "../command-support.js";
import {
	devSdkEnvironment,
	type EnvFamily,
	type EnvVar,
	filterEnvEntries,
} from "../dev-env.js";
import { environmentContextForCommand } from "../environment-context.js";

export type SelectPrompt<T extends string> = (config: {
	message: string;
	choices: Array<{ name: string; value: T }>;
}) => Promise<T>;

export type SelectEnvironmentPrompt = SelectPrompt<string>;
export type AgentPondInitStore = AgentPondStoreType;
export type SelectStorePrompt = SelectPrompt<AgentPondInitStore>;

type EnvOptions = GlobalOptions & {
	langfuse?: boolean;
	otel?: boolean;
	store?: string;
};

export function registerEnvCommand(
	program: Command,
	options: {
		selectEnvironment?: SelectEnvironmentPrompt;
		selectStore?: SelectStorePrompt;
	} = {},
): void {
	const promptSelect = options.selectEnvironment ?? select<string>;
	const promptStore = options.selectStore ?? select<AgentPondInitStore>;
	const env = addGlobalOptions(
		program.command("env").description("manage local AgentPond environments"),
	);

	addGlobalOptions(env.command("current"))
		.description("print the selected environment")
		.action((_commandOptions: EnvOptions, command: Command) => {
			const globalOptions = command.optsWithGlobals<GlobalOptions>();
			const environment = environmentContextForCommand({
				envName: globalOptions.env,
			}).config.environment;
			if (!environment) throw new CliError("Missing environment configuration");
			if (globalOptions.json) {
				return print(environment, true);
			}
			return print([environment], false);
		});

	addGlobalOptions(env.command("get <name>"))
		.description("print shell exports for an environment")
		.option("--langfuse", "print only Langfuse-compatible SDK exports")
		.option("--otel", "print only OpenTelemetry SDK exports")
		.action((name: string, commandOptions: EnvOptions) => {
			const context = environmentContextForCommand({ envName: name });
			printEnvironmentExports(name, commandOptions, context.rootDir);
		});

	addGlobalOptions(env.command("list"))
		.description("list local environments")
		.action((_commandOptions: EnvOptions, command: Command) => {
			const globalOptions = command.optsWithGlobals<GlobalOptions>();
			const context = environmentContextForCommand({
				envName: globalOptions.env,
			});
			const cwd = context.rootDir;
			const selected = context.config.environment?.name ?? "dev";
			const names = listAgentPondEnvironments(cwd);
			const rows = (names.length > 0 ? names : [selected]).map((name) => ({
				name,
				selected: name === selected,
			}));
			return print(rows, Boolean(globalOptions.json));
		});

	addGlobalOptions(env.command("init <name>"))
		.description("initialize an environment")
		.option("--store <store>", "object store: s3, gcs, vercel, or local")
		.action(
			async (name: string, commandOptions: EnvOptions, command: Command) => {
				const context = environmentContextForCommand({ envName: name });
				if (context.kind !== "agentpond") {
					throw new CliError(
						`npx agentpond env init is not available for ${context.kind} projects; the project environment is detected automatically`,
					);
				}
				const store =
					storeFromValue(commandOptions.store) ??
					(await promptForStore(promptStore));
				const environment = initAgentPondEnvironment(name, {
					cwd: context.rootDir,
					storeType: store,
				});
				return print(
					{
						name: environment.name,
						envFile: environment.envFilePath,
						dbPath: environment.dbPath,
						store,
					},
					Boolean(command.optsWithGlobals<GlobalOptions>().json),
				);
			},
		);

	addGlobalOptions(env.command("use [name]"))
		.description("select an environment")
		.action(
			async (
				name: string | undefined,
				_commandOptions: EnvOptions,
				command: Command,
			) => {
				const context = environmentContextForCommand({ envName: name });
				const selectedName =
					name ??
					(await promptForEnvironmentName(promptSelect, context.rootDir));
				const environment = selectAgentPondEnvironment(selectedName, {
					cwd: context.rootDir,
				});
				return print(
					{ selected: environment.name },
					Boolean(command.optsWithGlobals<GlobalOptions>().json),
				);
			},
		);
}

function storeFromValue(
	value: string | undefined,
): AgentPondInitStore | undefined {
	if (value === undefined) return undefined;
	if (
		value === "s3" ||
		value === "gcs" ||
		value === "vercel" ||
		value === "local"
	) {
		return value;
	}
	throw new CliError(
		`--store must be s3, gcs, vercel, or local, got "${value}"`,
	);
}

async function promptForStore(
	promptSelect: SelectStorePrompt,
): Promise<AgentPondInitStore> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new CliError("Missing --store");
	}
	return promptSelect({
		message: "Select AgentPond object store",
		choices: [
			{ name: "AWS S3 (or compatible)", value: "s3" },
			{ name: "Google Cloud Storage (GCS)", value: "gcs" },
			{ name: "Vercel Blob", value: "vercel" },
			{ name: "Local filesystem", value: "local" },
		],
	});
}

async function promptForEnvironmentName(
	promptSelect: SelectEnvironmentPrompt,
	cwd: string,
): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new CliError("Missing environment name");
	}
	const current = resolveAgentPondEnvironment({ cwd });
	const names = listAgentPondEnvironments(cwd);
	const choices = (names.length > 0 ? names : [current.name]).map((name) => ({
		name,
		value: name,
	}));
	return promptSelect({
		message: "Select AgentPond environment",
		choices,
	});
}

function printEnvironmentExports(
	name: string,
	options: EnvOptions,
	cwd: string,
): void {
	const family = envFamilyFromOptions(options);
	const entries =
		name === "dev"
			? devSdkEnvironmentForCurrentServer(family, cwd)
			: filterEnvEntries(readEnvironmentFileExports(name, cwd), family);
	for (const entry of entries) {
		console.log(`export ${entry.key}=${shellValue(entry.value)}`);
	}
}

function devSdkEnvironmentForCurrentServer(
	family: EnvFamily,
	cwd: string,
): EnvVar[] {
	const environment = resolveAgentPondEnvironment({
		cwd,
		name: "dev",
	});
	const lock = readDevServerLock(environment);
	if (!lock?.host || !lock.port) {
		throw new CliError(
			"dev server is not running; start it with npx agentpond dev",
		);
	}
	return devSdkEnvironment(lock.host, lock.port, family);
}

function envFamilyFromOptions(options: EnvOptions): EnvFamily {
	if (options.langfuse && options.otel) {
		throw new CliError("--langfuse and --otel cannot be used together");
	}
	if (options.langfuse) return "langfuse";
	if (options.otel) return "otel";
	return "all";
}

function readEnvironmentFileExports(name: string, cwd: string): EnvVar[] {
	const environment = resolveAgentPondEnvironment({
		cwd,
		name,
	});
	if (!existsSync(environment.envFilePath)) {
		throw new CliError(
			`Environment "${environment.name}" is not initialized; run npx agentpond env init ${environment.name}`,
		);
	}
	return parseEnvFileEntries(environment.envFilePath);
}

function shellValue(value: string): string {
	if (/^[A-Za-z0-9_@%+=:,./-]*$/.test(value)) return value;
	return `'${value.replaceAll("'", "'\\''")}'`;
}
