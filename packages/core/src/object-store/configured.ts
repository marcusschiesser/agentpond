import type { AgentPondConfig } from "../config.js";
import type {
	AgentPondEnvironment,
	AgentPondStoreType,
} from "../environment.js";
import { FileSystemObjectStore } from "./filesystem.js";
import type { ObjectStore } from "./types.js";

type ObjectStoreFactory = (
	environment: AgentPondEnvironment | undefined,
) => ObjectStore;

export type ConfiguredObjectStoreFactories = Partial<
	Record<AgentPondStoreType, ObjectStoreFactory>
>;

export function objectStoreForConfig(
	config: AgentPondConfig,
	factories: ConfiguredObjectStoreFactories,
): ObjectStore {
	const storeType = config.environment?.storeType ?? "local";
	const configuredFactories = {
		local: FileSystemObjectStore.fromEnvironment,
		...factories,
	};

	for (const key of Object.keys(configuredFactories) as AgentPondStoreType[]) {
		const factory = configuredFactories[key];
		if (key === storeType && factory) return factory(config.environment);
	}

	throw new Error(`No object-store factory configured for "${storeType}"`);
}
