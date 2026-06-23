import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

export type AgentPondStoreType = "local" | "s3";

export type AgentPondEnvironment = {
	name: string;
	agentpondDir: string;
	envFilePath: string;
	envDir: string;
	dbPath: string;
	eventStorePath: string;
	storeType: AgentPondStoreType;
};

export type ResolveEnvironmentOptions = {
	name?: string;
	cwd?: string;
};

export function loadEnvFile(filePath: string): void {
	for (const [key, value] of Object.entries(parseEnvFile(filePath))) {
		process.env[key] = value;
	}
}

export function parseEnvFile(filePath: string): Record<string, string> {
	const values: Record<string, string> = {};
	if (!existsSync(filePath)) return values;
	const content = readFileSync(filePath, "utf8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eqIdx = trimmed.indexOf("=");
		if (eqIdx === -1) continue;
		const key = trimmed.slice(0, eqIdx).trim();
		let val = trimmed.slice(eqIdx + 1).trim();
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1);
		}
		values[key] = val;
	}
	return values;
}

export function agentPondDir(cwd = process.cwd()): string {
	return join(cwd, ".agentpond");
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
		eventStorePath: join(envDir, "events"),
		storeType: name === "dev" ? "local" : "s3",
	};
}

export function selectAgentPondEnvironment(name: string): AgentPondEnvironment {
	const environment = resolveAgentPondEnvironment({ name });
	mkdirSync(environment.agentpondDir, { recursive: true });
	writeFileSync(
		join(environment.agentpondDir, "current-env"),
		`${environment.name}\n`,
		"utf8",
	);
	return environment;
}

export function initAgentPondEnvironment(name: string): AgentPondEnvironment {
	const environment = resolveAgentPondEnvironment({ name });
	mkdirSync(environment.envDir, { recursive: true });
	mkdirSync(join(environment.agentpondDir, "envs"), { recursive: true });
	if (!existsSync(environment.envFilePath)) {
		writeFileSync(
			environment.envFilePath,
			defaultEnvironmentFile(environment.name),
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

function defaultEnvironmentFile(name: string): string {
	const store = name === "dev" ? "local" : "s3";
	return [
		`AGENTPOND_STORE=${store}`,
		"AGENTPOND_PROJECT_ID=default-project",
		"LANGFUSE_PUBLIC_KEY=pk-agentpond",
		"LANGFUSE_SECRET_KEY=sk-agentpond",
		"",
	].join("\n");
}
