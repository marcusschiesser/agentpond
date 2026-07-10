import { S3ObjectStore } from "@agentpond/aws";
import {
	type AgentPondEnvironmentContext,
	agentPondWorkspaceRoot,
	configFromEnv,
	objectStoreForConfig as configuredObjectStoreForConfig,
} from "@agentpond/core";
import { firebaseEnvironmentContextFromCwdIfAvailable } from "@agentpond/firebase";
import { GcsObjectStore } from "@agentpond/google";
import { VercelBlobObjectStore } from "@agentpond/vercel";

export type EnvironmentContextOptions = {
	cwd?: string;
	envName?: string;
};

export function environmentContextForCommand(
	options: EnvironmentContextOptions = {},
): AgentPondEnvironmentContext {
	return (
		firebaseEnvironmentContextFromCwdIfAvailable(options) ??
		defaultAgentPondEnvironmentContext(options)
	);
}

function defaultAgentPondEnvironmentContext(
	options: EnvironmentContextOptions,
): AgentPondEnvironmentContext {
	const rootDir = agentPondWorkspaceRoot(options.cwd);
	const config = configFromEnv({
		cwd: rootDir,
		envName: options.envName,
	});
	return {
		kind: "agentpond",
		rootDir,
		config,
		usesAgentPondDevServer: config.environment?.name === "dev",
		async resolveStorage() {
			return {
				store: configuredObjectStoreForConfig(config, {
					gcs: GcsObjectStore.fromEnvironment,
					s3: S3ObjectStore.fromEnvironment,
					vercel: VercelBlobObjectStore.fromEnvironment,
				}),
				projectId: config.projectId,
				prefix: config.prefix,
			};
		},
	};
}
