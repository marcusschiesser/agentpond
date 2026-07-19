import {
	type AgentPondEnvironmentContext,
	type AgentPondProvider,
	type AgentPondProviderProject,
	configFromEnv,
	normalizePrefix,
} from "@agentpond/core";
import {
	type FirebaseCliProjectConfig,
	firebaseCliProjectConfigFromCwd,
	firebaseCliProjectConfigFromCwdIfAvailable,
	firebaseProjectDirectory,
	selectFirebaseEnvironment,
} from "./firebase-env.js";
import {
	defaultFirebaseStoragePrefix,
	FirebaseStorageObjectStore,
} from "./firebase-storage.js";

export type FirebaseEnvironmentContextOptions = {
	cwd?: string;
	envName?: string;
};

export const FIREBASE_INSTRUMENTATION_PROMPT = `Use $agentpond-instrumentation to inspect this Firebase project and add
OpenInference tracing to its trusted server-side AI application.

Reuse existing Firebase Admin and OpenTelemetry initialization, export spans
with createFirebaseSpanExporter() from @agentpond/firebase, and review Firebase
Storage Rules so client SDKs cannot access agentpond/**.

Build the application, exercise one real AI request, then use $agentpond to:

  npx agentpond sync
  npx agentpond traces list --limit 10`;

export function firebaseEnvironmentContextFromCwdIfAvailable(
	options: FirebaseEnvironmentContextOptions = {},
): AgentPondEnvironmentContext | undefined {
	const project = firebaseCliProjectConfigFromCwdIfAvailable(
		options.cwd,
		process.env,
		options.envName,
	);
	if (!project) return undefined;
	return firebaseEnvironmentContext(project);
}

function firebaseEnvironmentContext(
	project: FirebaseCliProjectConfig,
): AgentPondEnvironmentContext {
	const config = configFromEnv({
		cwd: project.root,
		envName: project.projectId,
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

export const firebaseProvider = {
	kind: "firebase",
	displayName: "Firebase",
	instrumentationPrompt: FIREBASE_INSTRUMENTATION_PROMPT,
	openProject(options = {}) {
		const root = firebaseProjectDirectory(options.cwd);
		return root ? firebaseProviderProject(root) : undefined;
	},
} as const satisfies AgentPondProvider;

function firebaseProviderProject(root: string): AgentPondProviderProject {
	return {
		rootDir: root,
		get projectLabel() {
			try {
				return firebaseCliProjectConfigFromCwd(root).projectId;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(
					message.includes("Could not determine Firebase project id")
						? "No active Firebase project is selected. Run npx agentpond env use <alias-or-project-id> and try again."
						: message,
					{ cause: error },
				);
			}
		},
		selectEnvironment(name) {
			return selectFirebaseEnvironment(name, { cwd: root });
		},
		resolveEnvironment(envName) {
			return firebaseEnvironmentContext(
				firebaseCliProjectConfigFromCwd(root, process.env, envName),
			);
		},
	};
}
