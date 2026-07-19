import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { findAncestorDirectory } from "@agentpond/core";

export type FirebaseCliProjectConfig = {
	projectId: string;
	root: string;
	bucket?: string;
};

export type FirebaseProcessRequest = {
	args: readonly string[];
	cwd: string;
};

export type FirebaseProcessResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
};

export type FirebaseProcessRunner = (
	request: FirebaseProcessRequest,
) => Promise<FirebaseProcessResult>;

export function isFirebaseProjectDirectory(cwd = process.cwd()): boolean {
	return firebaseProjectDirectory(cwd) !== undefined;
}

export function firebaseProjectDirectory(
	cwd = process.cwd(),
): string | undefined {
	return findAncestorDirectory(cwd, isFirebaseProjectRoot);
}

export function firebaseCliProjectConfigFromCwd(
	cwd = process.cwd(),
	env: NodeJS.ProcessEnv = process.env,
	projectName?: string,
): FirebaseCliProjectConfig {
	const root = firebaseProjectDirectory(cwd);
	if (!root) {
		throw new Error(
			"Run AgentPond inside an initialized Firebase project directory with .firebaserc or firebase.json",
		);
	}

	const runtimeConfig = firebaseRuntimeConfig(env.FIREBASE_CONFIG);
	const projectId = projectName
		? (firebaseProjectIdFromRc(root, projectName) ?? projectName)
		: (firebaseProjectIdFromCli(root, env) ??
			runtimeConfig?.projectId ??
			firebaseProjectIdFromEnv(env));
	if (!projectId) {
		throw new Error(
			"Could not determine Firebase project id. Run npx agentpond env use <project> to select a project, or set FIREBASE_CONFIG, GCLOUD_PROJECT, GCP_PROJECT, or GOOGLE_CLOUD_PROJECT.",
		);
	}

	return {
		projectId,
		root,
		...(runtimeConfig?.projectId === projectId && runtimeConfig.storageBucket
			? { bucket: runtimeConfig.storageBucket }
			: {}),
	};
}

export function firebaseFunctionsSourceDirectories(root: string): string[] {
	const configPath = join(root, "firebase.json");
	if (!existsSync(configPath)) return [];

	try {
		const config = JSON.parse(readFileSync(configPath, "utf8")) as {
			functions?: unknown;
		};
		return firebaseFunctionsSources(config.functions).map((source) =>
			join(root, source),
		);
	} catch (error) {
		throw new Error(
			"Could not read Firebase Functions source directories from firebase.json",
			{ cause: error },
		);
	}
}

export function firebaseCliProjectConfigFromCwdIfAvailable(
	cwd = process.cwd(),
	env: NodeJS.ProcessEnv = process.env,
	projectName?: string,
): FirebaseCliProjectConfig | undefined {
	if (!firebaseProjectDirectory(cwd)) return undefined;
	return firebaseCliProjectConfigFromCwd(cwd, env, projectName);
}

export async function selectFirebaseEnvironment(
	name: string,
	options: { cwd?: string } = {},
	dependencies: { run?: FirebaseProcessRunner } = {},
): Promise<string> {
	const project = firebaseCliProjectConfigFromCwd(
		options.cwd,
		process.env,
		name,
	);
	const result = await (dependencies.run ?? runFirebaseProcess)({
		args: ["use", name, "--non-interactive"],
		cwd: project.root,
	});
	if (result.exitCode !== 0) {
		const detail = result.stderr.trim();
		throw new Error(
			detail
				? `Could not select Firebase environment "${name}": ${detail}`
				: `Could not select Firebase environment "${name}". Run firebase login and try again.`,
		);
	}
	return project.projectId;
}

export async function runFirebaseProcess(
	request: FirebaseProcessRequest,
): Promise<FirebaseProcessResult> {
	return await new Promise((resolve, reject) => {
		execFile(
			"firebase",
			[...request.args],
			{ cwd: request.cwd, encoding: "utf8" },
			(error, stdout, stderr) => {
				if (!error) {
					resolve({ exitCode: 0, stderr, stdout });
					return;
				}
				if (error.code === "ENOENT") {
					reject(
						new Error(
							"Firebase CLI is required. Install it, run firebase login, and try again.",
						),
					);
					return;
				}
				resolve({
					exitCode: typeof error.code === "number" ? error.code : 1,
					stderr,
					stdout,
				});
			},
		);
	});
}

function isFirebaseProjectRoot(dir: string): boolean {
	return (
		existsSync(join(dir, ".firebaserc")) ||
		existsSync(join(dir, "firebase.json"))
	);
}

function firebaseFunctionsSources(functions: unknown): string[] {
	if (typeof functions === "string") return [functions];
	if (Array.isArray(functions)) {
		return functions.flatMap(firebaseFunctionsSources);
	}
	if (functions && typeof functions === "object") {
		const source = (functions as { source?: unknown }).source;
		return typeof source === "string" ? [source] : [];
	}
	return [];
}

function firebaseProjectIdFromCli(
	root: string,
	env: NodeJS.ProcessEnv,
): string | undefined {
	const activeProject = firebaseActiveProjectFromConfigStore(root, env);
	if (!activeProject) return firebaseProjectIdFromRc(root);
	return firebaseProjectIdFromRc(root, activeProject) ?? activeProject;
}

function firebaseProjectIdFromRc(
	root: string,
	alias = "default",
): string | undefined {
	const rcPath = join(root, ".firebaserc");
	if (!existsSync(rcPath)) return undefined;
	try {
		const rcData = JSON.parse(readFileSync(rcPath, "utf8")) as {
			projects?: Record<string, unknown>;
		};
		const projectId = rcData.projects?.[alias];
		return typeof projectId === "string" && projectId ? projectId : undefined;
	} catch (error) {
		throw new Error(
			`Could not read Firebase project id from .firebaserc projects.${alias}`,
			{ cause: error },
		);
	}
}

function firebaseActiveProjectFromConfigStore(
	root: string,
	env: NodeJS.ProcessEnv,
): string | undefined {
	const configHome =
		env.XDG_CONFIG_HOME ||
		(env.HOME ? join(env.HOME, ".config") : join(homedir(), ".config"));
	const configPath = join(configHome, "configstore", "firebase-tools.json");
	if (!existsSync(configPath)) return undefined;

	try {
		const config = JSON.parse(readFileSync(configPath, "utf8")) as {
			activeProjects?: Record<string, unknown>;
		};
		let currentDir = resolve(root);
		while (true) {
			const activeProject = config.activeProjects?.[currentDir];
			if (typeof activeProject === "string" && activeProject) {
				return activeProject;
			}
			const parentDir = dirname(currentDir);
			if (parentDir === currentDir) return undefined;
			currentDir = parentDir;
		}
	} catch {
		return undefined;
	}
}

function firebaseProjectIdFromEnv(env: NodeJS.ProcessEnv): string | undefined {
	return (
		firebaseRuntimeConfig(env.FIREBASE_CONFIG)?.projectId ??
		env.GCLOUD_PROJECT ??
		env.GCP_PROJECT ??
		env.GOOGLE_CLOUD_PROJECT
	);
}

function firebaseRuntimeConfig(config: string | undefined):
	| {
			projectId?: string;
			storageBucket?: string;
	  }
	| undefined {
	if (!config) return undefined;
	try {
		const parsed = JSON.parse(config) as {
			projectId?: unknown;
			storageBucket?: unknown;
		};
		return {
			...(typeof parsed.projectId === "string" && parsed.projectId
				? { projectId: parsed.projectId }
				: {}),
			...(typeof parsed.storageBucket === "string" && parsed.storageBucket
				? { storageBucket: parsed.storageBucket }
				: {}),
		};
	} catch {
		return undefined;
	}
}
