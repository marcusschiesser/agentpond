import { type AgentPondConfig, configFromRuntimeEnv } from "../config.js";
import type {
	AgentPondEnvironment,
	AgentPondStoreType,
} from "../environment.js";
import { FileSystemObjectStore } from "./filesystem.js";
import { type IngestionSink, sinkFromStore } from "./ingestion-handler.js";
import type { ObjectStore } from "./types.js";

type ObjectStoreFactory = (
	environment: AgentPondEnvironment | undefined,
) => ObjectStore;

export type ConfiguredObjectStoreFactories = Partial<
	Record<AgentPondStoreType, ObjectStoreFactory>
>;

export type RuntimeObjectStoreType = Exclude<AgentPondStoreType, "local">;

export type RuntimeObjectStoreFactories = Partial<
	Record<RuntimeObjectStoreType, () => ObjectStore>
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
	const factory = configuredFactories[storeType];
	if (factory) return factory(config.environment);

	throw new Error(`No object-store factory configured for "${storeType}"`);
}

export function sinkForConfig(
	config: AgentPondConfig,
	factories: ConfiguredObjectStoreFactories,
): IngestionSink {
	return sinkFromStore(objectStoreForConfig(config, factories), {
		prefix: config.prefix,
	});
}

export function sinkForRuntimeEnv(
	factories: RuntimeObjectStoreFactories,
	env: NodeJS.ProcessEnv = process.env,
): IngestionSink {
	const config = configFromRuntimeEnv(env);
	const storeType = runtimeStoreTypeFromEnv(env);
	const factory = factories[storeType];
	if (!factory) {
		throw new Error(`No object-store factory configured for "${storeType}"`);
	}

	return sinkFromStore(factory(), { prefix: config.prefix });
}

function runtimeStoreTypeFromEnv(
	env: NodeJS.ProcessEnv,
): RuntimeObjectStoreType {
	const storeType = env.AGENTPOND_STORE ?? "s3";
	if (storeType === "s3" || storeType === "gcs" || storeType === "vercel") {
		return storeType;
	}
	throw new Error(
		`AGENTPOND_STORE must be "s3", "gcs", or "vercel" for runtime config, got "${storeType}"`,
	);
}
