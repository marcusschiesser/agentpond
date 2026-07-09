import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findAncestorDirectory } from "@agentpond/core";

export type FirebaseCliProjectConfig = {
	projectId: string;
	bucket?: string;
};

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
): FirebaseCliProjectConfig {
	const root = firebaseProjectDirectory(cwd);
	if (!root) {
		throw new Error(
			"Run AgentPond inside an initialized Firebase project directory with .firebaserc or firebase.json",
		);
	}

	const runtimeConfig = firebaseRuntimeConfig(env.FIREBASE_CONFIG);
	const projectId =
		firebaseProjectIdFromRc(root) ??
		runtimeConfig?.projectId ??
		firebaseProjectIdFromEnv(env);
	if (!projectId) {
		throw new Error(
			"Could not determine Firebase project id. Run firebase use <project> to write .firebaserc, or set FIREBASE_CONFIG, GCLOUD_PROJECT, GCP_PROJECT, or GOOGLE_CLOUD_PROJECT.",
		);
	}

	return {
		projectId,
		...(runtimeConfig?.storageBucket
			? { bucket: runtimeConfig.storageBucket }
			: {}),
	};
}

export function firebaseCliProjectConfigFromCwdIfAvailable(
	cwd = process.cwd(),
	env: NodeJS.ProcessEnv = process.env,
): FirebaseCliProjectConfig | undefined {
	if (!firebaseProjectDirectory(cwd)) return undefined;
	return firebaseCliProjectConfigFromCwd(cwd, env);
}

function isFirebaseProjectRoot(dir: string): boolean {
	return (
		existsSync(join(dir, ".firebaserc")) ||
		existsSync(join(dir, "firebase.json"))
	);
}

function firebaseProjectIdFromRc(root: string): string | undefined {
	const rcPath = join(root, ".firebaserc");
	if (!existsSync(rcPath)) return undefined;
	try {
		const rcData = JSON.parse(readFileSync(rcPath, "utf8")) as {
			projects?: { default?: unknown };
		};
		const projectId = rcData.projects?.default;
		return typeof projectId === "string" && projectId ? projectId : undefined;
	} catch (error) {
		throw new Error(
			"Could not read Firebase project id from .firebaserc projects.default",
			{ cause: error },
		);
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
