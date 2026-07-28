import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { agentPondWorkspaceRoot } from "@agentpond/core";
import type { Command } from "commander";
import { CliError } from "../cli-support.js";
import type { GlobalOptions } from "../command-support.js";
import { providerForCommand } from "../providers.js";

const require = createRequire(import.meta.url);

export const MANUAL_SETUP_URL =
	"https://github.com/marcusschiesser/agentpond/blob/main/docs/getting-started/manual-setup.md";
export const FILES_SDK_PROVIDER_DOCS_URL =
	"https://files-sdk.dev/docs/providers";

export const FILES_SDK_INSTRUMENTATION_PROMPT = `Use $agentpond-instrumentation to inspect this project and add
OpenInference tracing to its trusted Node.js AI application.

Use createFilesSpanExporterFromRuntimeEnv() from @agentpond/files-sdk/otel so
the application and AgentPond CLI share one environment-driven storage setup.

For dependency-free local verification, create a persistent Files SDK
filesystem environment with:

  npx agentpond env init local --provider fs --root <absolute-project-root>/.agentpond/envs/local/objects

Build the application, exercise one real AI request with the local environment
loaded, then use $agentpond to sync and inspect the trace. After verification,
help the user choose a production Files SDK provider from
${FILES_SDK_PROVIDER_DOCS_URL} and follow ${MANUAL_SETUP_URL}.`;

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

export type SkillsInstallRequest = {
	cwd: string;
	source: string;
	skills: readonly string[];
};

export type SkillsInstaller = (request: SkillsInstallRequest) => Promise<void>;

type InitSetup = {
	displayName: string;
	instrumentationPrompt: string;
	projectLabel: string;
	rootDir: string;
};

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
		.action(async (_commandOptions: GlobalOptions, command: Command) => {
			const globalOptions = command.optsWithGlobals<GlobalOptions>();
			if (globalOptions.json) {
				throw new CliError("--json is not supported by npx agentpond init");
			}

			let setup: InitSetup;
			try {
				const context = providerForCommand({
					allowUnlinked: true,
					platform: globalOptions.platform,
				});
				setup = context
					? {
							displayName: context.provider.displayName,
							instrumentationPrompt: context.provider.instrumentationPrompt,
							projectLabel: context.project.projectLabel,
							rootDir: context.project.rootDir,
						}
					: filesSdkInitSetup();
			} catch (error) {
				throw new CliError(
					error instanceof Error ? error.message : String(error),
				);
			}

			console.log(
				agentPondInitHeader({
					displayName: setup.displayName,
					projectLabel: setup.projectLabel,
				}),
			);

			await (options.installSkills ?? installSkillsWithBundledCli)({
				cwd: setup.rootDir,
				source: AGENTPOND_SKILLS_SOURCE,
				skills: AGENTPOND_INIT_SKILLS,
			});

			console.log(
				[
					`AgentPond skills ready for ${setup.displayName} project: ${setup.projectLabel}`,
					"",
					"Paste this prompt into your coding agent:",
					"",
					setup.instrumentationPrompt,
				].join("\n"),
			);
		});
}

function filesSdkInitSetup(): InitSetup {
	const rootDir = agentPondWorkspaceRoot();
	return {
		displayName: "Files SDK",
		instrumentationPrompt: FILES_SDK_INSTRUMENTATION_PROMPT,
		projectLabel: rootDir,
		rootDir,
	};
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
