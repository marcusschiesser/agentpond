import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
	firebaseCliProjectConfigFromCwd,
	firebaseProjectDirectory,
} from "@agentpond/firebase";
import type { Command } from "commander";
import { CliError } from "../cli-support.js";
import type { GlobalOptions } from "../command-support.js";

const require = createRequire(import.meta.url);

export const MANUAL_SETUP_URL =
	"https://github.com/marcusschiesser/agentpond/blob/main/docs/getting-started/manual-setup.md";

export const AGENTPOND_SKILLS_SOURCE = "marcusschiesser/agentpond";
export const AGENTPOND_INIT_SKILLS = [
	"agentpond-instrumentation",
	"agentpond",
] as const;

export const FIREBASE_INSTRUMENTATION_PROMPT = `Use $agentpond-instrumentation to inspect this Firebase project and add
OpenInference tracing to its trusted server-side AI application.

Reuse existing Firebase Admin and OpenTelemetry initialization, export spans
with createFirebaseSpanExporter() from @agentpond/firebase, and review Firebase
Storage Rules so client SDKs cannot access agentpond/**.

Build the application, exercise one real AI request, then use $agentpond to:

  npx agentpond sync
  npx agentpond traces list --limit 10`;

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
		.action(async (_commandOptions: unknown, command: Command) => {
			const globalOptions = command.optsWithGlobals<GlobalOptions>();
			if (globalOptions.json) {
				throw new CliError("--json is not supported by npx agentpond init");
			}

			const root = firebaseProjectDirectory();
			if (!root) {
				throw new CliError(
					[
						"Automatic AgentPond setup currently supports Firebase projects.",
						"",
						"For AWS, Google Cloud, Vercel, and other deployment setups, see:",
						MANUAL_SETUP_URL,
					].join("\n"),
				);
			}

			let project: ReturnType<typeof firebaseCliProjectConfigFromCwd>;
			try {
				project = firebaseCliProjectConfigFromCwd(root);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new CliError(
					message.includes("Could not determine Firebase project id")
						? "No active Firebase project is selected. Run firebase use <alias-or-project-id> and try again."
						: message,
				);
			}

			await (options.installSkills ?? installSkillsWithBundledCli)({
				cwd: project.root,
				source: AGENTPOND_SKILLS_SOURCE,
				skills: AGENTPOND_INIT_SKILLS,
			});

			console.log(
				[
					`AgentPond skills installed for Firebase project: ${project.projectId}`,
					"",
					"Paste this prompt into your coding agent:",
					"",
					FIREBASE_INSTRUMENTATION_PROMPT,
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
