import { S3ObjectStore } from "@agentpond/aws";
import {
	type AgentPondEnvironmentContext,
	agentPondWorkspaceRoot,
	configFromEnv,
	objectStoreForConfig as configuredObjectStoreForConfig,
} from "@agentpond/core";
import { GcsObjectStore } from "@agentpond/google";
import { CliError } from "./cli-support.js";
import { providerForCommand } from "./providers.js";

export type EnvironmentContextOptions = {
	cwd?: string;
	envName?: string;
};

export function environmentContextForCommand(
	options: EnvironmentContextOptions = {},
): AgentPondEnvironmentContext {
	const providerContext = providerForCommand(options);
	if (!providerContext) return defaultAgentPondEnvironmentContext(options);
	try {
		return providerContext.project.resolveEnvironment(options.envName);
	} catch (error) {
		throw new CliError(error instanceof Error ? error.message : String(error));
	}
}

export function manualEnvironmentContextForCommand(
	action: "dev" | "get" | "init" | "list",
	options: EnvironmentContextOptions = {},
): AgentPondEnvironmentContext {
	const providerContext = providerForCommand({ cwd: options.cwd });
	if (providerContext) {
		const alternative =
			action === "dev"
				? "use the provider's runtime and direct span exporter instead"
				: "use the provider's environment selection instead";
		throw new CliError(
			`npx agentpond ${action === "dev" ? "dev" : `env ${action}`} is not available for ${providerContext.provider.kind} projects; ${alternative}`,
		);
	}
	return defaultAgentPondEnvironmentContext(options);
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
				}),
				projectId: config.projectId,
				prefix: config.prefix,
			};
		},
	};
}
