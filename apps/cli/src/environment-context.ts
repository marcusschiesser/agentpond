import {
	type AgentPondEnvironmentContext,
	agentPondWorkspaceRoot,
	configFromEnv,
} from "@agentpond/core";
import {
	FilesObjectStore,
	filesSdkConfigFromEnvironment,
} from "@agentpond/files-sdk";
import { CliError } from "./cli-support.js";
import { providerForCommand } from "./providers.js";

export type EnvironmentContextOptions = {
	cwd?: string;
	envName?: string;
	platform?: string;
};

export function environmentContextForCommand(
	options: EnvironmentContextOptions = {},
): AgentPondEnvironmentContext {
	const providerContext = providerForCommand(options);
	if (!providerContext) {
		return validateEnvironmentContext(
			defaultAgentPondEnvironmentContext(options),
		);
	}
	try {
		return validateEnvironmentContext(
			providerContext.project.resolveEnvironment(options.envName),
		);
	} catch (error) {
		throw new CliError(error instanceof Error ? error.message : String(error));
	}
}

export function manualEnvironmentContextForCommand(
	action: "dev" | "get" | "init" | "list",
	options: EnvironmentContextOptions = {},
): AgentPondEnvironmentContext {
	const providerContext = providerForCommand({
		cwd: options.cwd,
		platform: options.platform,
	});
	if (providerContext) {
		const alternative =
			action === "dev"
				? "use the provider's runtime and direct span exporter instead"
				: "use the provider's environment selection instead";
		throw new CliError(
			`npx agentpond ${action === "dev" ? "dev" : `env ${action}`} is not available for ${providerContext.provider.kind} projects; ${alternative}`,
		);
	}
	return action === "init" || action === "list"
		? defaultAgentPondEnvironmentContext(options)
		: validateEnvironmentContext(defaultAgentPondEnvironmentContext(options));
}

function defaultAgentPondEnvironmentContext(
	options: EnvironmentContextOptions,
): AgentPondEnvironmentContext {
	const rootDir = agentPondWorkspaceRoot(options.cwd);
	const config = configFromEnv({
		cwd: rootDir,
		envName: options.envName,
	});
	if (config.environment?.name === "dev") {
		return {
			kind: "dev",
			rootDir,
			config,
		};
	}
	return {
		kind: "files-sdk",
		rootDir,
		config,
		async resolveStorage() {
			return {
				store: FilesObjectStore.fromEnvironment(config.environment),
				projectId: config.projectId,
				prefix: config.prefix,
			};
		},
	};
}

export function validateManualEnvironment(cwd: string, name: string): void {
	validateEnvironmentContext(
		defaultAgentPondEnvironmentContext({ cwd, envName: name }),
	);
}

export function validateEnvironmentContext(
	context: AgentPondEnvironmentContext,
): AgentPondEnvironmentContext {
	switch (context.kind) {
		case "dev":
			if (context.config.environment?.name !== "dev") {
				throw new CliError(
					'Only the "dev" environment may use direct DuckDB storage',
				);
			}
			return context;
		case "files-sdk":
			try {
				filesSdkConfigFromEnvironment(context.config.environment);
			} catch (error) {
				const name = context.config.environment?.name ?? "unknown";
				const message = error instanceof Error ? error.message : String(error);
				throw new CliError(
					`AgentPond environment "${name}" is not a valid Files SDK environment: ${message}`,
				);
			}
			return context;
		case "firebase":
		case "supabase":
		case "vercel":
			return context;
		default:
			throw new CliError(
				`Unsupported AgentPond environment kind: ${String(
					(context as { kind?: unknown }).kind,
				)}`,
			);
	}
}
