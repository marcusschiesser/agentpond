import {
	type AgentPondEnvironmentContext,
	type AgentPondProvider,
	type AgentPondProviderProject,
	agentPondWorkspaceRoot,
	resolveAgentPondEnvironment,
} from "@agentpond/core";
import {
	SUPABASE_INSTRUMENTATION_PROMPT,
	type SupabaseCliProjectConfig,
	type SupabaseProcessRunner,
	selectSupabaseEnvironment,
	supabaseCliProjectConfigFromCwdIfAvailable,
	supabaseLinkedProjectRef,
	supabaseProjectDirectory,
	validateSupabaseProjectRef,
} from "./supabase-project.js";
import { SupabaseStorageObjectStore } from "./supabase-storage.js";

export type SupabaseEnvironmentContextOptions = {
	cwd?: string;
	envName?: string;
};

export function supabaseEnvironmentContextFromCwdIfAvailable(
	options: SupabaseEnvironmentContextOptions = {},
	dependencies: { run?: SupabaseProcessRunner } = {},
): AgentPondEnvironmentContext | undefined {
	const root = supabaseProjectDirectory(options.cwd);
	if (!root) return undefined;
	const projectRef = options.envName
		? validateSupabaseProjectRef(options.envName)
		: supabaseLinkedProjectRef(root);
	if (!projectRef) {
		throw new Error(
			"Run supabase link --project-ref <project-ref> before using AgentPond with this Supabase project",
		);
	}
	return supabaseEnvironmentContext({ projectRef, root }, dependencies);
}

function supabaseEnvironmentContext(
	project: SupabaseCliProjectConfig,
	dependencies: { run?: SupabaseProcessRunner } = {},
): AgentPondEnvironmentContext {
	const environment = resolveAgentPondEnvironment({
		cwd: project.root,
		name: project.projectRef,
	});
	const config = {
		projectId: project.projectRef,
		dbPath: environment.dbPath,
		prefix: "",
		auth: {
			projectId: project.projectRef,
			publicKey: "pk-agentpond",
			secretKey: "sk-agentpond",
		},
		environment,
	};

	return {
		kind: "supabase",
		rootDir: project.root,
		config,
		usesAgentPondDevServer: false,
		async resolveStorage() {
			return {
				store: await SupabaseStorageObjectStore.fromCliProject(
					project,
					dependencies,
				),
				projectId: project.projectRef,
				prefix: "",
			};
		},
	};
}

export const supabaseProvider = {
	kind: "supabase",
	displayName: "Supabase",
	instrumentationPrompt: SUPABASE_INSTRUMENTATION_PROMPT,
	openProject(options = {}) {
		const candidateRoot = supabaseProjectDirectory(options.cwd);
		if (!candidateRoot && !options.allowUnlinked) return undefined;
		const root = candidateRoot ?? agentPondWorkspaceRoot(options.cwd);
		return supabaseProviderProject(root);
	},
} as const satisfies AgentPondProvider;

function supabaseProviderProject(root: string): AgentPondProviderProject {
	return {
		get projectLabel() {
			return (
				supabaseCliProjectConfigFromCwdIfAvailable(root)?.projectRef ??
				"unlinked"
			);
		},
		rootDir: root,
		selectEnvironment(name) {
			return selectSupabaseEnvironment(name, { cwd: root });
		},
		resolveEnvironment(envName) {
			const projectRef = envName
				? validateSupabaseProjectRef(envName)
				: supabaseLinkedProjectRef(root);
			if (!projectRef) {
				throw new Error(
					"Run supabase link --project-ref <project-ref> before using AgentPond with this Supabase project",
				);
			}
			return supabaseEnvironmentContext({ projectRef, root });
		},
	};
}
