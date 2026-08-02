import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
	type AgentPondProvider,
	agentPondWorkspaceRoot,
} from "@agentpond/core";
import type { Command } from "commander";
import { CliError, print } from "../cli-support.js";
import type { GlobalOptions } from "../command-support.js";
import {
	type InitPlatform,
	initPlatformFromValue,
	type ProviderInitRequirements,
	providerForCommand,
	providerForPlatform,
	providerInitRequirementsForPlatform,
} from "../providers.js";

const require = createRequire(import.meta.url);

export const SETUP_GUIDE_URL =
	"https://github.com/marcusschiesser/agentpond/blob/main/docs/getting-started/setup.md";
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
${FILES_SDK_PROVIDER_DOCS_URL} and follow ${SETUP_GUIDE_URL}.`;

export const AGENTPOND_SKILLS_SOURCE = "marcusschiesser/agentpond";
export const AGENTPOND_INIT_SKILLS = [
	"agentpond-instrumentation",
	"agentpond",
] as const;

const FILES_SDK_INIT_REQUIREMENTS = {
	configuration: ["storage-provider", "storage-provider-config"],
	packages: ["@agentpond/files-sdk", "@agentpond/otel", "files-sdk"],
	telemetry: ["opentelemetry", "openinference"],
} as const satisfies ProviderInitRequirements;

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
	provider: InitProvider;
	requirements: ProviderInitRequirements;
	rootDir: string;
};

type InitProvider = "files-sdk" | InitPlatform;

type InitCheckSetup =
	| {
			kind: "files-sdk";
			linkingRequired: false;
	  }
	| {
			kind: "provider-managed";
			linkingRequired: boolean;
			provider: InitPlatform;
	  };

export type InitCheckReason = {
	code:
		| "detection-failed"
		| "invalid-platform"
		| "multiple-providers"
		| "provider-not-found"
		| "provider-not-ready";
	message: string;
	nextSteps: string[];
};

export type InitCheckResult = {
	schemaVersion: 1;
	cliVersion: string;
	project: {
		root: string;
	};
	reason?: InitCheckReason;
	requirements?: ProviderInitRequirements;
	setup?: InitCheckSetup;
	supported: boolean;
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
	options: { cliVersion: string; installSkills?: SkillsInstaller },
): void {
	const init = program
		.command("init")
		.description("set up AgentPond for the current project");

	init
		.command("check")
		.description("check AgentPond setup support without changing the project")
		.action((_commandOptions: GlobalOptions, command: Command) => {
			const globalOptions = command.optsWithGlobals<GlobalOptions>();
			const result = checkInitSupport({
				cliVersion: options.cliVersion,
				platform: globalOptions.platform,
			});
			if (globalOptions.json) print(result, true);
			else console.log(formatInitCheck(result));
			if (!result.supported) process.exitCode = 2;
		});

	init.action(async (_commandOptions: GlobalOptions, command: Command) => {
		const globalOptions = command.optsWithGlobals<GlobalOptions>();
		if (globalOptions.json) {
			throw new CliError("--json is not supported by npx agentpond init");
		}

		let setup: InitSetup;
		try {
			setup = initSetup({ platform: globalOptions.platform });
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

export function checkInitSupport(options: {
	cliVersion: string;
	cwd?: string;
	platform?: string;
}): InitCheckResult {
	const cwd = options.cwd ?? process.cwd();
	const fallbackRoot = agentPondWorkspaceRoot(cwd);
	let context: ReturnType<typeof providerForCommand>;
	try {
		context = providerForCommand({
			allowUnlinked: true,
			cwd,
			platform: options.platform,
		});
	} catch (error) {
		const reason = initCheckReason(error);
		const provider = providerFromFailedCheck(options.platform, reason);
		return unsupportedInitCheckResult({
			cliVersion: options.cliVersion,
			projectRoot: fallbackRoot,
			provider,
			reason,
		});
	}

	if (!context) {
		return supportedInitCheckResult(filesSdkInitSetup(cwd), options.cliVersion);
	}

	try {
		return supportedInitCheckResult(
			{
				displayName: context.provider.displayName,
				instrumentationPrompt: context.provider.instrumentationPrompt,
				projectLabel: context.project.projectLabel,
				provider: context.provider.kind,
				requirements: providerInitRequirementsForPlatform(
					context.provider.kind,
				),
				rootDir: context.project.rootDir,
			},
			options.cliVersion,
		);
	} catch (error) {
		return unsupportedInitCheckResult({
			cliVersion: options.cliVersion,
			projectRoot: context.project.rootDir,
			provider: context.provider,
			reason: initCheckReason(error),
		});
	}
}

function supportedInitCheckResult(
	setup: InitSetup,
	cliVersion: string,
): InitCheckResult {
	return {
		schemaVersion: 1,
		cliVersion,
		supported: true,
		project: {
			root: setup.rootDir,
		},
		requirements: setup.requirements,
		setup: initCheckSetup(setup.provider, setup.projectLabel === "unlinked"),
	};
}

function unsupportedInitCheckResult(options: {
	cliVersion: string;
	projectRoot: string;
	provider: AgentPondProvider | null;
	reason: InitCheckReason;
}): InitCheckResult {
	const requirements = options.provider
		? providerInitRequirementsForPlatform(options.provider.kind)
		: undefined;
	const setup = options.provider
		? initCheckSetup(
				options.provider.kind,
				options.reason.code === "provider-not-ready",
			)
		: undefined;
	return {
		schemaVersion: 1,
		cliVersion: options.cliVersion,
		supported: false,
		project: {
			root: options.projectRoot,
		},
		reason: options.reason,
		...(requirements ? { requirements } : {}),
		...(setup ? { setup } : {}),
	};
}

function initCheckSetup(
	provider: InitProvider,
	linkingRequired: boolean,
): InitCheckSetup {
	return provider === "files-sdk"
		? {
				kind: "files-sdk",
				linkingRequired: false,
			}
		: {
				kind: "provider-managed",
				linkingRequired,
				provider,
			};
}

function initSetup(
	options: { cwd?: string; platform?: string } = {},
): InitSetup {
	const context = providerForCommand({
		allowUnlinked: true,
		cwd: options.cwd,
		platform: options.platform,
	});
	return context
		? {
				displayName: context.provider.displayName,
				instrumentationPrompt: context.provider.instrumentationPrompt,
				projectLabel: context.project.projectLabel,
				provider: context.provider.kind,
				requirements: providerInitRequirementsForPlatform(
					context.provider.kind,
				),
				rootDir: context.project.rootDir,
			}
		: filesSdkInitSetup(options.cwd);
}

function filesSdkInitSetup(cwd = process.cwd()): InitSetup {
	const rootDir = agentPondWorkspaceRoot(cwd);
	return {
		displayName: "Files SDK",
		instrumentationPrompt: FILES_SDK_INSTRUMENTATION_PROMPT,
		projectLabel: rootDir,
		provider: "files-sdk",
		requirements: FILES_SDK_INIT_REQUIREMENTS,
		rootDir,
	};
}

function initCheckReason(error: unknown): InitCheckReason {
	const message = error instanceof Error ? error.message : String(error);
	if (message.startsWith("Multiple AgentPond platforms were detected:")) {
		return {
			code: "multiple-providers",
			message,
			nextSteps: [
				"Rerun with --platform firebase, --platform supabase, or --platform vercel.",
			],
		};
	}
	if (message.startsWith("--platform must be ")) {
		return {
			code: "invalid-platform",
			message,
			nextSteps: ["Use firebase, supabase, or vercel as the platform value."],
		};
	}
	if (/^No (Firebase|Supabase|Vercel) project was detected\./.test(message)) {
		return {
			code: "provider-not-found",
			message,
			nextSteps: [
				"Run the check from that provider's project or omit --platform to use automatic detection.",
			],
		};
	}
	if (
		message.includes("No active Firebase project is selected") ||
		message.includes("before using AgentPond with this")
	) {
		return {
			code: "provider-not-ready",
			message,
			nextSteps: [
				"Link or select the provider project, then rerun agentpond init check.",
			],
		};
	}
	return {
		code: "detection-failed",
		message,
		nextSteps: [
			"Resolve the reported project-detection error, then rerun agentpond init check.",
		],
	};
}

function providerFromFailedCheck(
	platform: string | undefined,
	reason: InitCheckReason,
): AgentPondProvider | null {
	if (
		reason.code === "invalid-platform" ||
		reason.code === "multiple-providers"
	) {
		return null;
	}
	const initPlatform = initPlatformFromValue(platform);
	return initPlatform ? providerForPlatform(initPlatform) : null;
}

function formatInitCheck(result: InitCheckResult): string {
	const lines = [
		`AgentPond init is ${result.supported ? "supported" : "not supported"} (CLI ${result.cliVersion})`,
		`Project: ${result.project.root}`,
	];
	if (result.setup) {
		lines.push(
			`Setup: ${
				result.setup.kind === "files-sdk"
					? "Files SDK fallback"
					: `${providerForPlatform(result.setup.provider).displayName} (provider-managed)`
			}`,
		);
		if (result.setup.linkingRequired) {
			lines.push("Provider linking is required during setup.");
		}
	}
	if (result.supported) {
		lines.push("Next: npx agentpond init");
	} else if (result.reason) {
		lines.push(
			`Reason (${result.reason.code}): ${result.reason.message}`,
			"Next steps:",
			...result.reason.nextSteps.map((nextStep) => `- ${nextStep}`),
		);
	}
	return lines.join("\n");
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
