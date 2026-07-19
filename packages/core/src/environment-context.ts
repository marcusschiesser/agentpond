import type { AgentPondConfig } from "./config.js";
import type { AgentPondStorageContext } from "./object-store.js";

export type AgentPondEnvironmentContext = {
	kind: string;
	rootDir: string;
	config: AgentPondConfig;
	usesAgentPondDevServer: boolean;
	resolveStorage(): Promise<AgentPondStorageContext>;
};

export type AgentPondProviderProject = {
	readonly rootDir: string;
	readonly projectLabel: string;
	selectEnvironment(name: string): Promise<string>;
	resolveEnvironment(envName?: string): AgentPondEnvironmentContext;
};

export type AgentPondProvider = {
	readonly kind: string;
	readonly displayName: string;
	readonly instrumentationPrompt: string;
	openProject(options?: {
		cwd?: string;
		allowUnlinked?: boolean;
	}): AgentPondProviderProject | undefined;
};
