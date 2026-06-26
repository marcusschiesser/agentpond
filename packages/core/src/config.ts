import { join } from "node:path";
import {
	type AgentPondEnvironment,
	type AgentPondStoreType,
	parseEnvFile,
	resolveAgentPondEnvironment,
} from "./environment.js";

export type S3Config = {
	bucket: string;
	endpoint?: string;
	region: string;
	accessKeyId?: string;
	secretAccessKey?: string;
	forcePathStyle: boolean;
};

export type GcsConfig = {
	bucket: string;
};

export type AuthConfig = {
	projectId: string;
	publicKey: string;
	secretKey: string;
};

export type AgentPondConfig = {
	projectId: string;
	dbPath: string;
	prefix: string;
	s3: S3Config;
	gcs: GcsConfig;
	auth?: AuthConfig;
	environment?: AgentPondEnvironment;
};

export function configFromEnv(
	overrides: Partial<{
		envName: string;
		storeType: AgentPondStoreType;
	}> = {},
): AgentPondConfig {
	const environment = resolveAgentPondEnvironment({ name: overrides.envName });
	const fileEnv = parseEnvFile(environment.envFilePath);
	const env = envValue(fileEnv);
	const storeType =
		overrides.storeType ??
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
		s3: {
			bucket: env("AGENTPOND_S3_BUCKET") ?? "agentpond",
			endpoint: nonEmpty(env("AGENTPOND_S3_ENDPOINT")),
			region: env("AWS_REGION") ?? env("AGENTPOND_S3_REGION") ?? "us-east-1",
			accessKeyId:
				nonEmpty(env("AWS_ACCESS_KEY_ID")) ??
				nonEmpty(env("AGENTPOND_S3_ACCESS_KEY_ID")),
			secretAccessKey:
				nonEmpty(env("AWS_SECRET_ACCESS_KEY")) ??
				nonEmpty(env("AGENTPOND_S3_SECRET_ACCESS_KEY")),
			forcePathStyle:
				(env("AGENTPOND_S3_FORCE_PATH_STYLE") ?? "true") !== "false",
		},
		gcs: {
			bucket: env("AGENTPOND_GCS_BUCKET") ?? "agentpond",
		},
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

export function normalizePrefix(prefix: string): string {
	if (!prefix) return "";
	return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function envValue(
	fileEnv: Record<string, string>,
): (name: string) => string | undefined {
	return (name) => process.env[name] ?? fileEnv[name];
}

function nonEmpty(value: string | undefined): string | undefined {
	return value === undefined || value === "" ? undefined : value;
}

function storeTypeFromValue(
	value: string | undefined,
): AgentPondStoreType | undefined {
	if (value === undefined) return undefined;
	if (value === "local" || value === "s3" || value === "gcs") return value;
	throw new Error(
		`AGENTPOND_STORE must be "local", "s3", or "gcs", got "${value}"`,
	);
}
