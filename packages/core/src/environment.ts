import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import { defaultAgentPondProjectId } from "./project-id.js";
import { agentPondWorkspaceRoot } from "./workspace.js";

export type FilesSdkEnvironmentConfig = {
	provider: string;
	bucket?: string;
	container?: string;
	endpoint?: string;
	namespace?: string;
	region?: string;
	root?: string;
	storeName?: string;
};

export type InitAgentPondEnvironmentOptions = {
	cwd?: string;
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
			defaultEnvironmentFile(environment.name, options.filesSdk),
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
	filesSdk: FilesSdkEnvironmentConfig | undefined,
): string {
	const isDev = name === "dev";
	if (isDev) return "";
	const lines = [
		"# Project id used to share the same object store across different projects.",
		`AGENTPOND_PROJECT_ID=${defaultAgentPondProjectId}`,
		"# Optional key prefix inside the selected object store.",
		"AGENTPOND_PREFIX=",
		"",
	];
	return [...filesSdkEnvironmentLines(filesSdk), ...lines].join("\n");
}

function filesSdkEnvironmentLines(
	filesSdk: FilesSdkEnvironmentConfig | undefined,
): string[] {
	if (!filesSdk?.provider) {
		throw new Error("Remote environments require a Files SDK provider");
	}
	const provider = environmentFileValue(filesSdk.provider, "provider");
	const bucket = filesSdk.bucket
		? environmentFileValue(filesSdk.bucket, "bucket")
		: undefined;
	const container = filesSdk.container
		? environmentFileValue(filesSdk.container, "container")
		: undefined;
	const endpoint = filesSdk.endpoint
		? environmentFileValue(filesSdk.endpoint, "endpoint")
		: undefined;
	const namespace = filesSdk.namespace
		? environmentFileValue(filesSdk.namespace, "namespace")
		: undefined;
	const region = filesSdk.region
		? environmentFileValue(filesSdk.region, "region")
		: undefined;
	const root = filesSdk.root
		? environmentFileValue(filesSdk.root, "root")
		: undefined;
	const storeName = filesSdk.storeName
		? environmentFileValue(filesSdk.storeName, "store name")
		: undefined;
	return [
		"# Files SDK adapter used by the exporter and AgentPond CLI.",
		`FILES_SDK_PROVIDER=${provider}`,
		...(bucket
			? [
					"# Bucket containing AgentPond ingestion objects.",
					`AGENTPOND_FILES_BUCKET=${bucket}`,
				]
			: []),
		...(container
			? [
					"# Container containing AgentPond ingestion objects.",
					`AGENTPOND_FILES_CONTAINER=${container}`,
				]
			: []),
		...(endpoint
			? [
					"# Optional endpoint required by this Files SDK provider.",
					`FILES_SDK_ENDPOINT=${endpoint}`,
				]
			: []),
		...(namespace
			? [
					"# Namespace used by this Files SDK provider.",
					`AGENTPOND_FILES_NAMESPACE=${namespace}`,
				]
			: []),
		...(region
			? [
					"# Optional region required by this Files SDK provider.",
					`FILES_SDK_REGION=${region}`,
				]
			: []),
		...(root
			? ["# Root used by this Files SDK provider.", `FILES_SDK_ROOT=${root}`]
			: []),
		...(storeName
			? [
					"# Store name used by this Files SDK provider.",
					`AGENTPOND_FILES_STORE_NAME=${storeName}`,
				]
			: []),
		"# Authenticate with the provider-specific environment variables documented by Files SDK.",
		"",
	];
}

function environmentFileValue(value: string, label: string): string {
	if (value.includes("\n") || value.includes("\r")) {
		throw new Error(`Files SDK ${label} must be a single-line value`);
	}
	return value;
}
