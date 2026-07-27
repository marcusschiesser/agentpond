import type { AgentPondConfig } from "./config.js";
import type { AgentPondStorageContext } from "./object-store.js";

export const AGENTPOND_PLATFORM_KINDS = [
	"firebase",
	"supabase",
	"vercel",
] as const;

export type AgentPondPlatformKind = (typeof AGENTPOND_PLATFORM_KINDS)[number];
export type AgentPondStorageEnvironmentKind =
	| "files-sdk"
	| AgentPondPlatformKind;

type AgentPondEnvironmentContextBase = {
	rootDir: string;
	config: AgentPondConfig;
};

export type AgentPondDevEnvironmentContext = AgentPondEnvironmentContextBase & {
	kind: "dev";
};

export type AgentPondStorageEnvironmentContext =
	AgentPondEnvironmentContextBase & {
		kind: AgentPondStorageEnvironmentKind;
		resolveStorage(): Promise<AgentPondStorageContext>;
	};

export type AgentPondEnvironmentContext =
	| AgentPondDevEnvironmentContext
	| AgentPondStorageEnvironmentContext;

export type AgentPondProviderProject = {
	readonly rootDir: string;
	readonly projectLabel: string;
	selectEnvironment(name: string): Promise<string>;
	resolveEnvironment(envName?: string): AgentPondStorageEnvironmentContext;
};

export type AgentPondProvider = {
	readonly kind: AgentPondPlatformKind;
	readonly displayName: string;
	readonly instrumentationPrompt: string;
	openProject(options?: {
		cwd?: string;
		allowUnlinked?: boolean;
	}): AgentPondProviderProject | undefined;
};
