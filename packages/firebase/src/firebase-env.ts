import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findAncestorDirectory } from "@agentpond/core";

export type FirebaseCliProjectConfig = {
	projectId: string;
	bucket: string;
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

	const projectId =
		firebaseProjectIdFromRc(root) ?? firebaseProjectIdFromEnv(env);
	if (!projectId) {
		throw new Error(
			"Could not determine Firebase project id. Run firebase use <project> to write .firebaserc, or set FIREBASE_CONFIG, GCLOUD_PROJECT, GCP_PROJECT, or GOOGLE_CLOUD_PROJECT.",
		);
	}

	return {
		projectId,
		bucket: `${projectId}.firebasestorage.app`,
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
		firebaseProjectIdFromFirebaseConfig(env.FIREBASE_CONFIG) ??
		env.GCLOUD_PROJECT ??
		env.GCP_PROJECT ??
		env.GOOGLE_CLOUD_PROJECT
	);
}

function firebaseProjectIdFromFirebaseConfig(
	config: string | undefined,
): string | undefined {
	if (!config) return undefined;
	try {
		const parsed = JSON.parse(config) as { projectId?: unknown };
		return typeof parsed.projectId === "string" && parsed.projectId
			? parsed.projectId
			: undefined;
	} catch {
		return undefined;
	}
}
