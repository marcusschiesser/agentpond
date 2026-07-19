import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findAncestorDirectory } from "@agentpond/core";

const VERCEL_CONFIG_FILES = [
	"vercel.json",
	"vercel.ts",
	"vercel.mts",
	"vercel.js",
	"vercel.mjs",
	"vercel.cjs",
] as const;

export type VercelCliProjectConfig = {
	projectId: string;
	orgId?: string;
	projectName?: string;
	root: string;
};

export const VERCEL_INSTRUMENTATION_PROMPT = `Use $agentpond-instrumentation to inspect this Vercel project and add
OpenInference tracing to its Node.js AI application.

Use a connected private Vercel Blob store and export spans directly with
createVercelSpanExporter() from @agentpond/vercel.

Build the application, exercise one real AI request, then use $agentpond to:

  npx agentpond sync
  npx agentpond traces list --limit 10`;

export function vercelProjectDirectory(
	cwd = process.cwd(),
): string | undefined {
	return findAncestorDirectory(cwd, (dir) =>
		existsSync(join(dir, ".vercel", "project.json")),
	);
}

export function vercelProjectCandidateDirectory(
	cwd = process.cwd(),
): string | undefined {
	return findAncestorDirectory(
		cwd,
		(dir) =>
			existsSync(join(dir, ".vercel", "project.json")) ||
			VERCEL_CONFIG_FILES.some((file) => existsSync(join(dir, file))),
	);
}

export function vercelCliProjectConfigFromCwd(
	cwd = process.cwd(),
): VercelCliProjectConfig {
	const root = vercelProjectDirectory(cwd);
	if (!root) {
		throw new Error(
			"Run vercel link before using AgentPond with this Vercel project",
		);
	}

	const projectPath = join(root, ".vercel", "project.json");
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(projectPath, "utf8"));
	} catch (error) {
		throw new Error(`Could not read ${projectPath}`, { cause: error });
	}
	if (!value || typeof value !== "object") {
		throw new Error(`Invalid Vercel project configuration: ${projectPath}`);
	}
	const project = value as Record<string, unknown>;
	if (typeof project.projectId !== "string" || !project.projectId) {
		throw new Error(`Missing projectId in ${projectPath}`);
	}

	return {
		projectId: project.projectId,
		root,
		...(typeof project.orgId === "string" ? { orgId: project.orgId } : {}),
		...(typeof project.projectName === "string"
			? { projectName: project.projectName }
			: {}),
	};
}

export function vercelCliProjectConfigFromCwdIfAvailable(
	cwd = process.cwd(),
): VercelCliProjectConfig | undefined {
	if (!vercelProjectDirectory(cwd)) return undefined;
	return vercelCliProjectConfigFromCwd(cwd);
}
