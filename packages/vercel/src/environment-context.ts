import { spawn } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AgentPondEnvironmentContext,
	type AgentPondProvider,
	type AgentPondProviderProject,
	agentPondWorkspaceRoot,
	normalizePrefix,
	parseEnvFile,
	resolveAgentPondEnvironment,
} from "@agentpond/core";
import { VercelBlobObjectStore, vercelBlobConfigFromEnv } from "./blob.js";
import {
	defaultVercelBlobPrefix,
	vercelAgentPondProjectId,
} from "./span-exporter.js";
import {
	VERCEL_INSTRUMENTATION_PROMPT,
	type VercelCliProjectConfig,
	vercelCliProjectConfigFromCwd,
	vercelCliProjectConfigFromCwdIfAvailable,
	vercelProjectCandidateDirectory,
} from "./vercel-project.js";

export type VercelProcessRequest = {
	args: readonly string[];
	cwd: string;
};

export type VercelProcessResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
};

export type VercelProcessRunner = (
	request: VercelProcessRequest,
) => Promise<VercelProcessResult>;

export type VercelContextOptions = {
	cwd?: string;
	envName?: string;
};

type VercelAgentPondState = {
	projectId: string;
	target: string;
};

export function vercelEnvironmentContextFromCwdIfAvailable(
	options: VercelContextOptions = {},
	dependencies: { run?: VercelProcessRunner } = {},
): AgentPondEnvironmentContext | undefined {
	const root = vercelProjectCandidateDirectory(options.cwd);
	if (!root) return undefined;
	const project = vercelCliProjectConfigFromCwdIfAvailable(root);
	if (!project) {
		throw new Error(
			"Run vercel link before using AgentPond with this Vercel project",
		);
	}
	return vercelEnvironmentContext(project, options.envName, dependencies);
}

function vercelEnvironmentContext(
	project: VercelCliProjectConfig,
	envName: string | undefined,
	dependencies: { run?: VercelProcessRunner } = {},
): AgentPondEnvironmentContext {
	const target = envName ?? vercelSelectedTarget(project) ?? "production";
	const projectId = vercelAgentPondProjectId(project.projectId, target);
	const environment = resolveAgentPondEnvironment({
		cwd: project.root,
		name: projectId,
	});
	const config = {
		projectId,
		dbPath: environment.dbPath,
		prefix: normalizePrefix(defaultVercelBlobPrefix),
		auth: {
			projectId,
			publicKey: "pk-agentpond",
			secretKey: "sk-agentpond",
		},
		environment: { ...environment, name: target },
	};

	return {
		kind: "vercel",
		rootDir: project.root,
		config,
		usesAgentPondDevServer: false,
		async resolveStorage() {
			return {
				store: await vercelStoreForTarget(
					project.root,
					target,
					dependencies.run ?? runVercelProcess,
				),
				projectId,
				prefix: config.prefix,
			};
		},
	};
}

export const vercelProvider = {
	kind: "vercel",
	displayName: "Vercel",
	instrumentationPrompt: VERCEL_INSTRUMENTATION_PROMPT,
	openProject(options = {}) {
		const candidateRoot = vercelProjectCandidateDirectory(options.cwd);
		if (!candidateRoot && !options.allowUnlinked) return undefined;
		const root = candidateRoot ?? agentPondWorkspaceRoot(options.cwd);
		return vercelProviderProject(
			root,
			vercelCliProjectConfigFromCwdIfAvailable(root),
		);
	},
} as const satisfies AgentPondProvider;

function vercelProviderProject(
	root: string,
	linkedProject: VercelCliProjectConfig | undefined,
): AgentPondProviderProject {
	const project = () => linkedProject ?? vercelCliProjectConfigFromCwd(root);
	return {
		projectLabel:
			linkedProject?.projectName ?? linkedProject?.projectId ?? "unlinked",
		rootDir: linkedProject?.root ?? root,
		selectEnvironment(name) {
			return Promise.resolve(selectVercelProjectEnvironment(project(), name));
		},
		resolveEnvironment(envName) {
			return vercelEnvironmentContext(project(), envName);
		},
	};
}

export function selectVercelEnvironment(
	name: string,
	options: { cwd?: string } = {},
): Promise<string> {
	const project = vercelCliProjectConfigFromCwd(options.cwd);
	return Promise.resolve(selectVercelProjectEnvironment(project, name));
}

function selectVercelProjectEnvironment(
	project: VercelCliProjectConfig,
	name: string,
): string {
	vercelAgentPondProjectId(project.projectId, name);
	writeFileSync(
		vercelAgentPondStatePath(project.root),
		`${JSON.stringify({ projectId: project.projectId, target: name }, null, 2)}\n`,
		"utf8",
	);
	return name;
}

function vercelSelectedTarget(
	project: VercelCliProjectConfig,
): string | undefined {
	const path = vercelAgentPondStatePath(project.root);
	if (!existsSync(path)) return undefined;

	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(`Could not read ${path}`, { cause: error });
	}
	if (!isVercelAgentPondState(value)) {
		throw new Error(`Invalid AgentPond Vercel environment state: ${path}`);
	}
	if (value.projectId !== project.projectId) return undefined;
	vercelAgentPondProjectId(project.projectId, value.target);
	return value.target;
}

function vercelAgentPondStatePath(root: string): string {
	return join(root, ".vercel", "agentpond.json");
}

function isVercelAgentPondState(value: unknown): value is VercelAgentPondState {
	if (!value || typeof value !== "object") return false;
	const state = value as Record<string, unknown>;
	return (
		typeof state.projectId === "string" && typeof state.target === "string"
	);
}

async function vercelStoreForTarget(
	root: string,
	target: string,
	run: VercelProcessRunner,
): Promise<VercelBlobObjectStore> {
	const tempDir = mkdtempSync(join(tmpdir(), "agentpond-vercel-"));
	const envPath = join(tempDir, "environment.env");
	try {
		const result = await run({
			args: [
				"env",
				"pull",
				envPath,
				"--environment",
				target,
				"--yes",
				"--no-color",
			],
			cwd: root,
		});
		if (result.exitCode !== 0) {
			throw vercelCliError(
				`load Vercel environment "${target}"`,
				result.stderr,
			);
		}
		const config = vercelBlobConfigFromEnv(parseEnvFile(envPath));
		if (!config.token && !(config.storeId && config.oidcToken)) {
			throw new Error(
				`Vercel environment "${target}" is not connected to a Blob store. Connect a private Blob store and try again.`,
			);
		}
		return VercelBlobObjectStore.fromConfig({ ...config, access: "private" });
	} finally {
		rmSync(tempDir, { force: true, recursive: true });
	}
}

export async function runVercelProcess(
	request: VercelProcessRequest,
): Promise<VercelProcessResult> {
	return await new Promise((resolve, reject) => {
		const child = spawn("vercel", request.args, {
			cwd: request.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", (error) => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				reject(
					new Error(
						"Vercel CLI is required. Install it, run vercel login, and try again.",
					),
				);
				return;
			}
			reject(error);
		});
		child.once("exit", (code, signal) => {
			if (code !== null) {
				resolve({ exitCode: code, stderr, stdout });
				return;
			}
			reject(new Error(`Vercel CLI stopped by signal ${signal ?? "unknown"}`));
		});
	});
}

function vercelCliError(action: string, stderr: string): Error {
	const detail = stderr.trim();
	return new Error(
		detail
			? `Could not ${action}: ${detail}`
			: `Could not ${action}. Run vercel login and vercel link, then try again.`,
	);
}
