import {
	type AgentPondEnvironmentContext,
	configFromEnv,
	normalizePrefix,
} from "@agentpond/core";
import { firebaseCliProjectConfigFromCwdIfAvailable } from "./firebase-env.js";
import {
	defaultFirebaseStoragePrefix,
	FirebaseStorageObjectStore,
} from "./firebase-storage.js";

export type FirebaseEnvironmentContextOptions = {
	cwd?: string;
	envName?: string;
};

export function firebaseEnvironmentContextFromCwdIfAvailable(
	options: FirebaseEnvironmentContextOptions = {},
): AgentPondEnvironmentContext | undefined {
	const project = firebaseCliProjectConfigFromCwdIfAvailable(options.cwd);
	if (!project) return undefined;

	const config = configFromEnv({
		cwd: project.root,
		envName: options.envName ?? project.projectId,
	});

	return {
		kind: "firebase",
		rootDir: project.root,
		config,
		usesAgentPondDevServer: false,
		async resolveStorage() {
			return {
				store: await FirebaseStorageObjectStore.fromCliProject(project),
				projectId: project.projectId,
				prefix: normalizePrefix(defaultFirebaseStoragePrefix),
			};
		},
	};
}
