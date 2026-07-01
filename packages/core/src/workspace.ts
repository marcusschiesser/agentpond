import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function agentPondWorkspaceRoot(cwd = process.cwd()): string {
	let dir = cwd;
	for (;;) {
		if (isWorkspaceRoot(dir)) return dir;
		const parent = dirname(dir);
		if (parent === dir) return cwd;
		dir = parent;
	}
}

function isWorkspaceRoot(dir: string): boolean {
	if (
		existsSync(join(dir, "pnpm-workspace.yaml")) ||
		existsSync(join(dir, "pnpm-workspace.yml")) ||
		existsSync(join(dir, "lerna.json")) ||
		existsSync(join(dir, "nx.json")) ||
		existsSync(join(dir, "rush.json")) ||
		existsSync(join(dir, "turbo.json"))
	) {
		return true;
	}
	return packageJsonHasWorkspaces(join(dir, "package.json"));
}

function packageJsonHasWorkspaces(filePath: string): boolean {
	if (!existsSync(filePath)) return false;
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as {
			workspaces?: unknown;
		};
		return parsed.workspaces !== undefined;
	} catch {
		return false;
	}
}
