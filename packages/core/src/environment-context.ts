import type { AgentPondConfig } from "./config.js";
import type { AgentPondStorageContext } from "./object-store.js";

export type AgentPondEnvironmentContext = {
	kind: string;
	rootDir: string;
	config: AgentPondConfig;
	usesAgentPondDevServer: boolean;
	resolveStorage(): Promise<AgentPondStorageContext>;
};
