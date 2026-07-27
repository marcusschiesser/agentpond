import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { agentPondWorkspaceRoot } from "./workspace.js";

export type AgentPondStoreType = "files-sdk" | "local" | "s3" | "gcs";

export type FilesSdkEnvironmentConfig = {
	provider: string;
	bucket: string;
};

export type InitAgentPondEnvironmentOptions = {
	cwd?: string;
	storeType?: AgentPondStoreType;
	filesSdk?: FilesSdkEnvironmentConfig;
};

export type AgentPondEnvironment = {
	name: string;
	agentpondDir: string;
	envFilePath: string;
	envDir: string;
	dbPath: string;
};

export type ResolveEnvironmentOptions = {
	name?: string;
	cwd?: string;
};

export type EnvFileEntry = {
	key: string;
	value: string;
};

export function loadEnvFile(filePath: string): void {
	for (const [key, value] of Object.entries(parseEnvFile(filePath))) {
		process.env[key] = value;
	}
}

export function parseEnvFile(filePath: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const { key, value } of parseEnvFileEntries(filePath)) {
		values[key] = value;
	}
	return values;
}

export function parseEnvFileEntries(filePath: string): EnvFileEntry[] {
	const values: EnvFileEntry[] = [];
	if (!existsSync(filePath)) return values;
	const content = readFileSync(filePath, "utf8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
			throw new Error(`Invalid environment variable name: ${key}`);
		}
		let val = trimmed.slice(eqIdx + 1).trim();
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1);
		}
		values.push({ key, value: val });
	}
	return values;
}

export function agentPondDir(cwd = process.cwd()): string {
	return join(agentPondWorkspaceRoot(cwd), ".agentpond");
}

export function resolveAgentPondEnvironment(
	options: ResolveEnvironmentOptions = {},
): AgentPondEnvironment {
	const root = agentPondDir(options.cwd);
	const name = normalizeEnvironmentName(
		options.name ?? readSelectedEnvironment(root) ?? "dev",
	);
	const envDir = join(root, "envs", name);
	return {
		name,
		agentpondDir: root,
		envFilePath: join(root, "envs", `${name}.env`),
		envDir,
		dbPath: join(envDir, "cache.duckdb"),
	};
}

export function selectAgentPondEnvironment(
	name: string,
	options: Pick<ResolveEnvironmentOptions, "cwd"> = {},
): AgentPondEnvironment {
	const environment = resolveAgentPondEnvironment({ name, cwd: options.cwd });
	mkdirSync(environment.agentpondDir, { recursive: true });
	writeFileSync(
		join(environment.agentpondDir, "current-env"),
		`${environment.name}\n`,
		"utf8",
	);
	return environment;
}

export function initAgentPondEnvironment(
	name: string,
	options: InitAgentPondEnvironmentOptions = {},
): AgentPondEnvironment {
	const environment = resolveAgentPondEnvironment({ name, cwd: options.cwd });
	mkdirSync(environment.envDir, { recursive: true });
	mkdirSync(join(environment.agentpondDir, "envs"), { recursive: true });
	if (environment.name !== "dev" && !existsSync(environment.envFilePath)) {
		writeFileSync(
			environment.envFilePath,
			defaultEnvironmentFile(
				environment.name,
				options.storeType ?? "s3",
				options.filesSdk,
			),
			"utf8",
		);
	}
	return environment;
}

export function listAgentPondEnvironments(cwd = process.cwd()): string[] {
	const root = agentPondDir(cwd);
	const names = new Set<string>();
	const envsDir = join(root, "envs");
	try {
		for (const entry of readdirSync(envsDir, { withFileTypes: true })) {
			if (entry.isFile() && entry.name.endsWith(".env")) {
				names.add(entry.name.slice(0, -".env".length));
			}
			if (entry.isDirectory()) names.add(entry.name);
		}
	} catch {
		// Missing .agentpond/envs means no initialized environments yet.
	}
	return [...names].sort();
}

function readSelectedEnvironment(root: string): string | undefined {
	try {
		const selected = readFileSync(join(root, "current-env"), "utf8").trim();
		return selected || undefined;
	} catch {
		return undefined;
	}
}

function normalizeEnvironmentName(name: string): string {
	if (!/^[A-Za-z0-9._-]+$/.test(name) || basename(name) !== name) {
		throw new Error(`Invalid environment name: ${name}`);
	}
	return name;
}

function defaultEnvironmentFile(
	name: string,
	storeType: AgentPondStoreType,
	filesSdk: FilesSdkEnvironmentConfig | undefined,
): string {
	const isDev = name === "dev";
	if (isDev) return "";
	const lines = [
		"# Project id used to share the same object store across different projects.",
		"AGENTPOND_PROJECT_ID=default-project",
		"# Optional key prefix inside the selected object store.",
		"AGENTPOND_PREFIX=",
		"",
		"# OpenTelemetry exporter endpoint used by standard OTLP HTTP exporters.",
		"OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/api/public/otel",
		"# Signal-specific OTLP trace endpoint used by exporters that expect the full traces URL.",
		"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/api/public/otel/v1/traces",
		"# OpenTelemetry exporter protocol for OTLP HTTP JSON.",
		"OTEL_EXPORTER_OTLP_PROTOCOL=http/json",
		"",
		"# Langfuse-compatible base URL used by SDKs.",
		"LANGFUSE_BASE_URL=http://localhost:4318",
		"",
		"# Langfuse-compatible public key accepted by the ingestion server.",
		"LANGFUSE_PUBLIC_KEY=pk-agentpond",
		"# Langfuse-compatible secret key accepted by the ingestion server.",
		"LANGFUSE_SECRET_KEY=sk-agentpond",
		"",
	];
	return [...storeEnvironmentLines(storeType, filesSdk), ...lines].join("\n");
}

function storeEnvironmentLines(
	storeType: AgentPondStoreType,
	filesSdk: FilesSdkEnvironmentConfig | undefined,
): string[] {
	if (storeType === "local") {
		return [
			"# Storage backend for this environment.",
			"AGENTPOND_STORE=local",
			"",
		];
	}
	if (storeType === "gcs") {
		return [
			"# Storage backend for this environment. GCS-backed environments sync from object storage.",
			"AGENTPOND_STORE=gcs",
			"",
			"# Google Cloud Storage bucket containing AgentPond ingestion objects.",
			"AGENTPOND_GCS_BUCKET=agentpond",
			"# Authenticate with Google Application Default Credentials or GOOGLE_APPLICATION_CREDENTIALS.",
			"",
		];
	}
	if (storeType === "files-sdk") {
		if (!filesSdk?.provider || !filesSdk.bucket) {
			throw new Error(
				"Files SDK environments require both a provider and bucket",
			);
		}
		const provider = environmentFileValue(filesSdk.provider, "provider");
		const bucket = environmentFileValue(filesSdk.bucket, "bucket");
		return [
			"# Storage backend for this environment. Files SDK environments sync from object storage.",
			"AGENTPOND_STORE=files-sdk",
			"",
			"# Files SDK bucket adapter used by the exporter and AgentPond CLI.",
			`FILES_SDK_PROVIDER=${provider}`,
			"# Bucket containing AgentPond ingestion objects.",
			`AGENTPOND_FILES_BUCKET=${bucket}`,
			"# Authenticate with the provider-specific environment variables documented by Files SDK.",
			"",
		];
	}
	return [
		"# Storage backend for this environment. S3-backed environments sync from object storage.",
		"AGENTPOND_STORE=s3",
		"",
		"# S3 bucket containing AgentPond ingestion objects.",
		"AGENTPOND_S3_BUCKET=agentpond",
		"# Local MinIO endpoint from docker-compose.yml. Leave empty for Amazon S3.",
		"AGENTPOND_S3_ENDPOINT=http://localhost:9000",
		"# AWS/S3 region used by the object-store client.",
		"AGENTPOND_S3_REGION=us-east-1",
		"# Local MinIO access key from docker-compose.yml. Leave empty to use the AWS SDK credential chain.",
		"AGENTPOND_S3_ACCESS_KEY_ID=minio",
		"# Local MinIO secret key from docker-compose.yml. Leave empty to use the AWS SDK credential chain.",
		"AGENTPOND_S3_SECRET_ACCESS_KEY=minio123",
		"# Use true for MinIO. Use false for Amazon S3 virtual-hosted buckets.",
		"AGENTPOND_S3_FORCE_PATH_STYLE=true",
		"# Optional for S3-compatible providers such as Hugging Face Storage Buckets.",
		"# AGENTPOND_S3_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED",
		"# AGENTPOND_S3_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED",
		"",
	];
}

function environmentFileValue(value: string, label: string): string {
	if (value.includes("\n") || value.includes("\r")) {
		throw new Error(`Files SDK ${label} must be a single-line value`);
	}
	return value;
}
