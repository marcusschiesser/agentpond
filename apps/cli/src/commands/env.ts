import { existsSync } from "node:fs";
import {
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
import { devSdkEnvironment, type EnvVar } from "../dev-env.js";

export type SelectEnvironmentPrompt = (config: {
	message: string;
	choices: Array<{ name: string; value: string }>;
}) => Promise<string>;

type EnvOptions = GlobalOptions & {
	host?: string;
	port?: string;
};

export function registerEnvCommand(
	program: Command,
	options: { selectEnvironment?: SelectEnvironmentPrompt } = {},
): void {
	const promptSelect = options.selectEnvironment ?? select<string>;
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
		.action((name: string, _commandOptions: EnvOptions, command: Command) => {
			const environment = initAgentPondEnvironment(name);
			return print(
				{
					name: environment.name,
					envFile: environment.envFilePath,
					dbPath: environment.dbPath,
				},
				Boolean(command.optsWithGlobals<GlobalOptions>().json),
			);
		});

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
	const entries =
		name === "dev"
			? devSdkEnvironment(
					options.host ?? "127.0.0.1",
					parsePort(options.port ?? "4318"),
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
