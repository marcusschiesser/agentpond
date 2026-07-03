#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command, CommanderError } from "commander";
import { CliError } from "./cli-support.js";
import { addGlobalOptions } from "./command-support.js";
import { registerDevCommand } from "./commands/dev.js";
import {
	registerEnvCommand,
	type SelectEnvironmentPrompt,
	type SelectStorePrompt,
} from "./commands/env.js";
import { registerObservationsCommand } from "./commands/observations.js";
import { registerScoresCommand } from "./commands/scores.js";
import { registerSessionsCommand } from "./commands/sessions.js";
import { registerSqlCommand } from "./commands/sql.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerTracesCommand } from "./commands/traces.js";
import {
	type CliUpdateCheckOptions,
	checkForCliUpdate,
} from "./update-check.js";

export { createOtelTraceId } from "./commands/traces.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version: string };
export const CLI_VERSION = packageJson.version;

export type ProgramOptions = {
	selectEnvironment?: SelectEnvironmentPrompt;
	selectStore?: SelectStorePrompt;
	updateCheck?: CliUpdateCheckOptions | false;
};

export function createProgram(options: ProgramOptions = {}): Command {
	const program = new Command();
	program
		.name("agentpond")
		.description("local Langfuse-compatible trace analytics")
		.version(CLI_VERSION)
		.showHelpAfterError()
		.showSuggestionAfterError()
		.exitOverride()
		.configureOutput({
			writeOut: (value) => {
				process.stdout.write(value);
			},
			writeErr: (value) => {
				console.error(value.trimEnd());
			},
		});

	addGlobalOptions(program);
	registerDevCommand(program);
	registerEnvCommand(program, {
		selectEnvironment: options.selectEnvironment,
		selectStore: options.selectStore,
	});
	registerSyncCommand(program);
	registerTracesCommand(program);
	registerObservationsCommand(program);
	registerSessionsCommand(program);
	registerScoresCommand(program);
	registerSqlCommand(program);

	return program;
}

export async function main(
	argv = process.argv,
	options: ProgramOptions = {},
): Promise<void> {
	const program = createProgram(options);
	try {
		await checkForCliUpdate(argv, CLI_VERSION, options.updateCheck);
		await program.parseAsync(argv, { from: "node" });
	} catch (error) {
		if (error instanceof CommanderError) {
			if (
				error.code === "commander.help" ||
				error.code === "commander.helpDisplayed"
			)
				return;
			process.exitCode = error.exitCode === 0 ? 0 : 2;
			return;
		}
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exitCode = error instanceof CliError ? 2 : 1;
	}
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
