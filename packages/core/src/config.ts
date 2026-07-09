import { join } from "node:path";
import {
	type AgentPondEnvironment,
	type AgentPondStoreType,
	parseEnvFile,
	resolveAgentPondEnvironment,
} from "./environment.js";

export type AuthConfig = {
	projectId: string;
	publicKey: string;
	secretKey: string;
};

export type AgentPondConfig = {
	projectId: string;
	dbPath: string;
	prefix: string;
	auth?: AuthConfig;
	environment?: AgentPondEnvironment;
};

export type AgentPondRuntimeConfig = Pick<
	AgentPondConfig,
	"projectId" | "prefix" | "auth"
>;

export type ConfigFromEnvOptions = {
	envName?: string;
	storeType?: AgentPondStoreType;
};

export function configFromEnv(
	options: ConfigFromEnvOptions = {},
): AgentPondConfig {
	const environment = resolveAgentPondEnvironment({
		name: options.envName,
	});
	const fileEnv = parseEnvFile(environment.envFilePath);
	const env = envValue(fileEnv);
	const storeType =
		options.storeType ??
		storeTypeFromValue(env("AGENTPOND_STORE")) ??
		environment.storeType;
	const dbPath = join(environment.envDir, "cache.duckdb");
	const projectId = env("AGENTPOND_PROJECT_ID") ?? "default-project";
	const prefix = normalizePrefix(
		env("AGENTPOND_PREFIX") ??
			env("AGENTPOND_S3_PREFIX") ??
			env("AGENTPOND_GCS_PREFIX") ??
			"",
	);
	const publicKey = env("LANGFUSE_PUBLIC_KEY") ?? "pk-agentpond";
	const secretKey = env("LANGFUSE_SECRET_KEY") ?? "sk-agentpond";

	return {
		projectId,
		dbPath,
		prefix,
		auth: {
			projectId,
			publicKey,
			secretKey,
		},
		environment: {
			...environment,
			dbPath,
			storeType,
		},
	};
}

export function configFromRuntimeEnv(
	env: NodeJS.ProcessEnv = process.env,
): AgentPondRuntimeConfig {
	const projectId = env.AGENTPOND_PROJECT_ID ?? "default-project";
	const prefix = normalizePrefix(
		env.AGENTPOND_PREFIX ??
			env.AGENTPOND_S3_PREFIX ??
			env.AGENTPOND_GCS_PREFIX ??
			"",
	);
	const publicKey = env.LANGFUSE_PUBLIC_KEY ?? "pk-agentpond";
	const secretKey = env.LANGFUSE_SECRET_KEY ?? "sk-agentpond";

	return {
		projectId,
		prefix,
		auth: {
			projectId,
			publicKey,
			secretKey,
		},
	};
}

export function authFromRuntimeEnv(
	env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
	const projectId = env.AGENTPOND_PROJECT_ID ?? "default-project";
	return {
		projectId,
		publicKey: env.LANGFUSE_PUBLIC_KEY ?? "pk-agentpond",
		secretKey: env.LANGFUSE_SECRET_KEY ?? "sk-agentpond",
	};
}

export function normalizePrefix(prefix: string): string {
	if (!prefix) return "";
	return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

export function envValue(
	fileEnv: Record<string, string>,
): (name: string) => string | undefined {
	return (name) => process.env[name] ?? fileEnv[name];
}

export function nonEmpty(value: string | undefined): string | undefined {
	return value === undefined || value === "" ? undefined : value;
}

function storeTypeFromValue(
	value: string | undefined,
): AgentPondStoreType | undefined {
	if (value === undefined) return undefined;
	if (
		value === "local" ||
		value === "s3" ||
		value === "gcs" ||
		value === "vercel"
	) {
		return value;
	}
	throw new Error(
		`AGENTPOND_STORE must be "local", "s3", "gcs", or "vercel", got "${value}"`,
	);
}
