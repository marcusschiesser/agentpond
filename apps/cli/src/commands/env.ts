import { existsSync } from "node:fs";
import {
	type AgentPondStoreType,
	initAgentPondEnvironment,
	listAgentPondEnvironments,
	parseEnvFileEntries,
	resolveAgentPondEnvironment,
	selectAgentPondEnvironment,
} from "@agentpond/core";
import { select } from "@inquirer/prompts";
import type { Command } from "commander";
import { CliError, parsePort, print } from "../cli-support.js";
import { addGlobalOptions, type GlobalOptions } from "../command-support.js";
import {
	devSdkEnvironment,
	type EnvFamily,
	type EnvVar,
	filterEnvEntries,
} from "../dev-env.js";

export type SelectPrompt<T extends string> = (config: {
	message: string;
	choices: Array<{ name: string; value: T }>;
}) => Promise<T>;

export type SelectEnvironmentPrompt = SelectPrompt<string>;
export type AgentPondInitStore = AgentPondStoreType;
export type SelectStorePrompt = SelectPrompt<AgentPondInitStore>;

type EnvOptions = GlobalOptions & {
	host?: string;
	langfuse?: boolean;
	otel?: boolean;
	port?: string;
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
			const environment = resolveAgentPondEnvironment({
				name: globalOptions.env,
			});
			if (globalOptions.json) {
				return print(environment, true);
			}
			return print([environment], false);
		});

	addGlobalOptions(env.command("get <name>"))
		.description("print shell exports for an environment")
		.option("--host <host>", "dev host", "127.0.0.1")
		.option("--langfuse", "print only Langfuse-compatible SDK exports")
		.option("--otel", "print only OpenTelemetry SDK exports")
		.option("--port <port>", "dev port", "4318")
		.action((name: string, commandOptions: EnvOptions) => {
			printEnvironmentExports(name, commandOptions);
		});

	addGlobalOptions(env.command("list"))
		.description("list local environments")
		.action((_commandOptions: EnvOptions, command: Command) => {
			const globalOptions = command.optsWithGlobals<GlobalOptions>();
			const selected = resolveAgentPondEnvironment({
				name: globalOptions.env,
			}).name;
			const names = listAgentPondEnvironments();
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
				const store =
					storeFromValue(commandOptions.store) ??
					(await promptForStore(promptStore));
				const environment = initAgentPondEnvironment(name, {
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
				const selectedName =
					name ?? (await promptForEnvironmentName(promptSelect));
				const environment = selectAgentPondEnvironment(selectedName);
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
): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new CliError("Missing environment name");
	}
	const current = resolveAgentPondEnvironment();
	const names = listAgentPondEnvironments();
	const choices = (names.length > 0 ? names : [current.name]).map((name) => ({
		name,
		value: name,
	}));
	return promptSelect({
		message: "Select AgentPond environment",
		choices,
	});
}

function printEnvironmentExports(name: string, options: EnvOptions): void {
	const family = envFamilyFromOptions(options);
	const entries =
		name === "dev"
			? devSdkEnvironment(
					options.host ?? "127.0.0.1",
					parsePort(options.port ?? "4318"),
					family,
				)
			: filterEnvEntries(readEnvironmentFileExports(name), family);
	for (const entry of entries) {
		console.log(`export ${entry.key}=${shellValue(entry.value)}`);
	}
}

function envFamilyFromOptions(options: EnvOptions): EnvFamily {
	if (options.langfuse && options.otel) {
		throw new CliError("--langfuse and --otel cannot be used together");
	}
	if (options.langfuse) return "langfuse";
	if (options.otel) return "otel";
	return "all";
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
