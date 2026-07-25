import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { text } from "node:stream/consumers";
import { findAncestorDirectory, nonEmpty } from "@agentpond/core";
import { validateSupabaseSecretKey } from "./supabase-storage.js";

export const SUPABASE_PROJECT_REF_PATTERN = /^[a-z]{20}$/;

export type SupabaseCliProjectConfig = {
	projectRef: string;
	root: string;
};

export type SupabaseProcessRequest = {
	args: readonly string[];
	cwd: string;
	stdio: "capture" | "inherit";
};

export type SupabaseProcessResult = {
	exitCode: number;
	stderr: string;
	stdout: string;
};

export type SupabaseProcessRunner = (
	request: SupabaseProcessRequest,
) => Promise<SupabaseProcessResult>;

export const SUPABASE_INSTRUMENTATION_PROMPT = `Use $agentpond-instrumentation to inspect this Supabase project and add
OpenInference tracing to its trusted AI application.

Use the dedicated private agentpond Storage bucket and export spans directly
with createSupabaseSpanExporter() from @agentpond/supabase.

Build the application, exercise one real AI request, then use $agentpond to:

  npx agentpond sync
  npx agentpond traces list --limit 10`;

export function isSupabaseProjectDirectory(cwd = process.cwd()): boolean {
	return supabaseProjectDirectory(cwd) !== undefined;
}

export function supabaseProjectDirectory(
	cwd = process.cwd(),
): string | undefined {
	return findAncestorDirectory(cwd, (directory) =>
		existsSync(join(directory, "supabase", "config.toml")),
	);
}

export function supabaseCliProjectConfigFromCwd(
	cwd = process.cwd(),
): SupabaseCliProjectConfig {
	const root = supabaseProjectDirectory(cwd);
	if (!root) {
		throw new Error(
			"Run AgentPond inside an initialized Supabase project with supabase/config.toml",
		);
	}
	const projectRef = supabaseLinkedProjectRef(root);
	if (!projectRef) {
		throw new Error(
			"Run supabase link --project-ref <project-ref> before using AgentPond with this Supabase project",
		);
	}
	return { projectRef, root };
}

export function supabaseCliProjectConfigFromCwdIfAvailable(
	cwd = process.cwd(),
): SupabaseCliProjectConfig | undefined {
	const root = supabaseProjectDirectory(cwd);
	if (!root) return undefined;
	const projectRef = supabaseLinkedProjectRef(root);
	return projectRef ? { projectRef, root } : undefined;
}

export function supabaseLinkedProjectRef(root: string): string | undefined {
	const path = join(root, "supabase", ".temp", "project-ref");
	if (!existsSync(path)) return undefined;
	let projectRef: string;
	try {
		projectRef = readFileSync(path, "utf8").trim();
	} catch {
		throw new Error(`Could not read Supabase project link state at ${path}`);
	}
	if (!projectRef) return undefined;
	return validateSupabaseProjectRef(projectRef);
}

export function validateSupabaseProjectRef(projectRef: string): string {
	if (!SUPABASE_PROJECT_REF_PATTERN.test(projectRef)) {
		throw new Error(
			"Supabase project ref must contain exactly 20 lowercase letters",
		);
	}
	return projectRef;
}

export function supabaseHostedUrl(projectRef: string): string {
	return `https://${validateSupabaseProjectRef(projectRef)}.supabase.co`;
}

export function supabaseProjectRefFromUrl(urlValue: string): string {
	let url: URL;
	try {
		url = new URL(urlValue);
	} catch {
		throw new Error(
			"Could not derive a Supabase project ref from SUPABASE_URL",
		);
	}
	const match = /^([a-z]{20})\.supabase\.co$/.exec(url.hostname);
	if (url.protocol !== "https:" || url.port || !match) {
		throw new Error(
			"Could not derive a hosted Supabase project ref from SUPABASE_URL; provide projectId explicitly",
		);
	}
	return validateSupabaseProjectRef(match[1]);
}

export async function selectSupabaseEnvironment(
	name: string,
	options: { cwd?: string } = {},
	dependencies: { run?: SupabaseProcessRunner } = {},
): Promise<string> {
	const projectRef = validateSupabaseProjectRef(name);
	const root = supabaseProjectDirectory(options.cwd);
	if (!root) {
		throw new Error(
			"Run AgentPond inside an initialized Supabase project with supabase/config.toml",
		);
	}
	const result = await (dependencies.run ?? runSupabaseProcess)({
		args: ["link", "--project-ref", projectRef],
		cwd: root,
		stdio: "inherit",
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`Could not link Supabase project "${projectRef}". Run supabase login and try again.`,
		);
	}
	return projectRef;
}

export async function supabaseSecretKeyForProject(
	project: SupabaseCliProjectConfig,
	dependencies: { run?: SupabaseProcessRunner } = {},
): Promise<string> {
	const result = await (dependencies.run ?? runSupabaseProcess)({
		args: [
			"projects",
			"api-keys",
			"--project-ref",
			project.projectRef,
			"--output",
			"json",
			"--reveal",
		],
		cwd: project.root,
		stdio: "capture",
	});
	if (result.exitCode !== 0) {
		throw new Error(
			`Could not load Supabase API keys for project "${project.projectRef}". Run supabase login and verify project access.`,
		);
	}

	let value: unknown;
	try {
		value = JSON.parse(result.stdout);
	} catch {
		throw new Error(
			`Supabase CLI returned invalid API-key metadata for project "${project.projectRef}"`,
		);
	}
	const entries = supabaseApiKeyEntries(value);
	const modern = entries.find(
		(entry) => entry.name === "default" && entry.type === "secret",
	);
	const legacy = entries.find((entry) => entry.name === "service_role");
	const key = nonEmpty(modern?.api_key) ?? nonEmpty(legacy?.api_key);
	if (!key) {
		throw new Error(
			`No default secret or legacy service-role key is available for Supabase project "${project.projectRef}"`,
		);
	}
	try {
		return validateSupabaseSecretKey(key);
	} catch {
		throw new Error(
			`Supabase CLI did not reveal a usable secret or service-role key for project "${project.projectRef}"`,
		);
	}
}

export async function runSupabaseProcess(
	request: SupabaseProcessRequest,
): Promise<SupabaseProcessResult> {
	const child = spawn("supabase", request.args, {
		cwd: request.cwd,
		stdio:
			request.stdio === "inherit"
				? "inherit"
				: (["inherit", "pipe", "pipe"] as const),
	});
	try {
		if (request.stdio === "inherit") {
			const [code, signal] = (await once(child, "exit")) as [
				number | null,
				NodeJS.Signals | null,
			];
			if (code !== null) return { exitCode: code, stderr: "", stdout: "" };
			throw new Error(`Supabase CLI stopped by signal ${signal ?? "unknown"}`);
		}
		if (!child.stdout || !child.stderr) {
			throw new Error("Could not capture Supabase CLI output");
		}
		const [[code, signal], stdout, stderr] = await Promise.all([
			once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>,
			text(child.stdout),
			text(child.stderr),
		]);
		if (code !== null) return { exitCode: code, stderr, stdout };
		throw new Error(`Supabase CLI stopped by signal ${signal ?? "unknown"}`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(
				"Supabase CLI is required. Install it, run supabase login, and try again.",
			);
		}
		throw error;
	}
}

type SupabaseApiKeyEntry = {
	api_key: string;
	name: string;
	type?: string;
};

function supabaseApiKeyEntries(value: unknown): SupabaseApiKeyEntry[] {
	const values = Array.isArray(value)
		? value
		: value &&
				typeof value === "object" &&
				Array.isArray((value as { apiKeys?: unknown }).apiKeys)
			? (value as { apiKeys: unknown[] }).apiKeys
			: [];
	return values.flatMap((entry) => {
		if (!entry || typeof entry !== "object") return [];
		const candidate = entry as Record<string, unknown>;
		if (
			typeof candidate.name !== "string" ||
			typeof candidate.api_key !== "string"
		) {
			return [];
		}
		return [
			{
				name: candidate.name,
				api_key: candidate.api_key,
				...(typeof candidate.type === "string" ? { type: candidate.type } : {}),
			},
		];
	});
}
