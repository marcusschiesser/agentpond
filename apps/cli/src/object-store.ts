import { S3ObjectStore } from "@agentpond/aws";
import {
	type AgentPondConfig,
	objectStoreForConfig as configuredObjectStoreForConfig,
	normalizePrefix,
	type ObjectStore,
	parseEnvFile,
} from "@agentpond/core";
import {
	defaultFirebaseStoragePrefix,
	FirebaseStorageObjectStore,
	firebaseCliProjectConfigFromCwd,
	isFirebaseProjectDirectory,
} from "@agentpond/firebase";
import { GcsObjectStore } from "@agentpond/google";
import { VercelBlobObjectStore } from "@agentpond/vercel";

export type ObjectStorageContext = {
	store: ObjectStore;
	projectId: string;
	prefix: string;
};

export function usesAgentPondDevServer(config: AgentPondConfig): boolean {
	return config.environment?.name === "dev" && !usesProjectObjectStore(config);
}

export async function objectStorageForConfig(
	config: AgentPondConfig,
): Promise<ObjectStorageContext> {
	if (usesProjectObjectStore(config)) {
		const project = firebaseCliProjectConfigFromCwd();
		return {
			store: await FirebaseStorageObjectStore.fromCliProject(project),
			projectId: project.projectId,
			prefix: normalizePrefix(defaultFirebaseStoragePrefix),
		};
	}

	return {
		store: configuredObjectStoreForConfig(config, {
			gcs: GcsObjectStore.fromEnvironment,
			s3: S3ObjectStore.fromEnvironment,
			vercel: VercelBlobObjectStore.fromEnvironment,
		}),
		projectId: config.projectId,
		prefix: config.prefix,
	};
}

function usesProjectObjectStore(config: AgentPondConfig): boolean {
	const explicitStore = explicitStoreFromConfig(config);
	if (explicitStore) return false;
	return isFirebaseProjectDirectory();
}

function explicitStoreFromConfig(config: AgentPondConfig): string | undefined {
	if (process.env.AGENTPOND_STORE) return process.env.AGENTPOND_STORE;
	if (!config.environment) return undefined;
	const fileEnv = parseEnvFile(config.environment.envFilePath);
	return fileEnv.AGENTPOND_STORE;
}
