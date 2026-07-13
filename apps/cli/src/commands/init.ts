import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { Command } from "commander";
import { CliError } from "../cli-support.js";
import type { GlobalOptions } from "../command-support.js";
import {
	AVAILABLE_PLATFORMS,
	initPlatformFromValue,
	type ProviderProjectContext,
	providerForCommand,
} from "../providers.js";

const require = createRequire(import.meta.url);

export const MANUAL_SETUP_URL =
	"https://github.com/marcusschiesser/agentpond/blob/main/docs/getting-started/manual-setup.md";

export const AGENTPOND_SKILLS_SOURCE = "marcusschiesser/agentpond";
export const AGENTPOND_INIT_SKILLS = [
	"agentpond-instrumentation",
	"agentpond",
] as const;

export function agentPondCliHeader(): string {
	return [
		"AgentPond",
		"Store agent traces remotely. Analyze them locally.",
	].join("\n");
}

export function agentPondInitHeader(context: {
	displayName: string;
	projectLabel: string;
}): string {
	return [
		agentPondCliHeader(),
		"",
		`${context.displayName} project: ${context.projectLabel}`,
		"Installing AgentPond skills...",
	].join("\n");
}

type InitCommandOptions = {
	platform?: string;
};

export type SkillsInstallRequest = {
	cwd: string;
	source: string;
	skills: readonly string[];
};

export type SkillsInstaller = (request: SkillsInstallRequest) => Promise<void>;

export type SkillsProcessRequest = {
	args: readonly string[];
	command: string;
	cwd: string;
};

export type SkillsProcessRunner = (
	request: SkillsProcessRequest,
) => Promise<number>;

export function registerInitCommand(
	program: Command,
	options: { installSkills?: SkillsInstaller } = {},
): void {
	program
		.command("init")
		.description("set up AgentPond for the current project")
		.option(
			"--platform <platform>",
			`setup platform: ${AVAILABLE_PLATFORMS.join(" or ")}`,
		)
		.action(async (commandOptions: InitCommandOptions, command: Command) => {
			const globalOptions = command.optsWithGlobals<GlobalOptions>();
			if (globalOptions.json) {
				throw new CliError("--json is not supported by npx agentpond init");
			}

			const platform = initPlatformFromValue(commandOptions.platform);
			let setup:
				| { context: ProviderProjectContext; projectLabel: string }
				| undefined;
			try {
				const context = providerForCommand({ platform });
				setup = context
					? { context, projectLabel: context.project.projectLabel }
					: undefined;
			} catch (error) {
				throw new CliError(
					error instanceof Error ? error.message : String(error),
				);
			}
			if (!setup) {
				throw new CliError(
					[
						"Automatic AgentPond setup supports Firebase and Vercel projects.",
						"",
						"For AWS, Google Cloud, and other deployment setups, see:",
						MANUAL_SETUP_URL,
					].join("\n"),
				);
			}
			const { context, projectLabel } = setup;

			console.log(
				agentPondInitHeader({
					displayName: context.provider.displayName,
					projectLabel,
				}),
			);

			await (options.installSkills ?? installSkillsWithBundledCli)({
				cwd: context.project.rootDir,
				source: AGENTPOND_SKILLS_SOURCE,
				skills: AGENTPOND_INIT_SKILLS,
			});

			console.log(
				[
					`AgentPond skills ready for ${context.provider.displayName} project: ${projectLabel}`,
					"",
					"Paste this prompt into your coding agent:",
					"",
					context.provider.instrumentationPrompt,
				].join("\n"),
			);
		});
}

export async function installSkillsWithBundledCli(
	request: SkillsInstallRequest,
	options: {
		cliPath?: string;
		run?: SkillsProcessRunner;
	} = {},
): Promise<void> {
	const cliPath = options.cliPath ?? require.resolve("skills/bin/cli.mjs");
	const args = [cliPath, "add", request.source];
	for (const skill of request.skills) {
		args.push("--skill", skill);
	}

	const exitCode = await (options.run ?? runSkillsProcess)({
		args,
		command: process.execPath,
		cwd: request.cwd,
	});

	if (exitCode !== 0) {
		throw new CliError(`Skills CLI exited with status ${exitCode}`);
	}

	const missingSkills = request.skills.filter(
		(skill) =>
			!existsSync(join(request.cwd, ".agents", "skills", skill, "SKILL.md")),
	);
	if (missingSkills.length > 0) {
		throw new CliError(
			`AgentPond skill installation was cancelled or did not complete. Missing: ${missingSkills.join(", ")}`,
		);
	}
}

async function runSkillsProcess(
	request: SkillsProcessRequest,
): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const child = spawn(request.command, request.args, {
			cwd: request.cwd,
			stdio: "inherit",
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code !== null) return resolve(code);
			reject(new Error(`Skills CLI stopped by signal ${signal ?? "unknown"}`));
		});
	});
}
