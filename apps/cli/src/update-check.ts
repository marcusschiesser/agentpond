import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { confirm } from "@inquirer/prompts";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_LATEST_URL = "https://registry.npmjs.org/agentpond/latest";

type FetchLike = typeof fetch;

type UpdateCheckCache = {
	checkedAt: number;
	latestVersion?: string;
};

type ConfirmUpdate = (config: {
	message: string;
	default?: boolean;
}) => Promise<boolean>;

export type CliUpdateCheckOptions = {
	fetch?: FetchLike;
	now?: () => number;
	confirmUpdate?: ConfirmUpdate;
	runUpdate?: (version: string) => Promise<number>;
	force?: boolean;
	cachePath?: string;
};

type Semver = {
	major: number;
	minor: number;
	patch: number;
};

export async function checkForCliUpdate(
	argv: readonly string[],
	currentVersion: string,
	options: CliUpdateCheckOptions | false | undefined,
): Promise<void> {
	if (options === false) return;
	if (!shouldCheckForUpdates(argv, options)) return;

	const now = options?.now?.() ?? Date.now();
	const cachePath = options?.cachePath ?? defaultCachePath();
	const cached = readUpdateCache(cachePath);
	if (
		!options?.force &&
		cached?.checkedAt &&
		now - cached.checkedAt < CHECK_INTERVAL_MS
	) {
		return;
	}

	const latestVersion = await fetchLatestVersion(options?.fetch ?? fetch);
	if (!latestVersion) return;
	writeUpdateCache(cachePath, { checkedAt: now, latestVersion });

	if (isNewerVersion(latestVersion, currentVersion)) {
		await promptForUpdate(latestVersion, options);
	}
}

export function shouldCheckForUpdates(
	argv: readonly string[],
	options?: CliUpdateCheckOptions,
): boolean {
	if (options?.force) return true;
	if (process.env.NODE_ENV === "test") return false;
	if (process.env.CI) return false;
	if (process.env.AGENTPOND_NO_UPDATE_CHECK === "1") return false;
	if (process.env.AGENTPOND_UPDATE_CHECK === "0") return false;
	if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stderr.isTTY) {
		return false;
	}
	return !argv.some((arg) =>
		["--json", "--help", "-h", "--version", "-V"].includes(arg),
	);
}

export function isNewerVersion(candidate: string, current: string): boolean {
	const candidateSemver = parseSemver(candidate);
	const currentSemver = parseSemver(current);
	if (!candidateSemver || !currentSemver) return false;
	if (candidateSemver.major !== currentSemver.major) {
		return candidateSemver.major > currentSemver.major;
	}
	if (candidateSemver.minor !== currentSemver.minor) {
		return candidateSemver.minor > currentSemver.minor;
	}
	return candidateSemver.patch > currentSemver.patch;
}

function parseSemver(version: string): Semver | undefined {
	const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (!match) return undefined;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
	};
}

async function fetchLatestVersion(
	fetchImpl: FetchLike,
): Promise<string | undefined> {
	try {
		const response = await fetchImpl(REGISTRY_LATEST_URL, {
			signal: AbortSignal.timeout(1000),
		});
		if (!response.ok) return undefined;
		const body = (await response.json()) as { version?: unknown };
		return typeof body.version === "string" ? body.version : undefined;
	} catch {
		return undefined;
	}
}

async function promptForUpdate(
	latestVersion: string,
	options?: CliUpdateCheckOptions,
): Promise<void> {
	const confirmUpdate = options?.confirmUpdate ?? confirm;
	const runUpdate = options?.runUpdate ?? runNpmUpdate;
	const shouldUpdate = await confirmUpdate({
		message: `AgentPond ${latestVersion} is available. Update now with npm install -g agentpond@latest?`,
		default: false,
	});
	if (!shouldUpdate) return;

	const exitCode = await runUpdate(latestVersion);
	if (exitCode === 0) {
		console.error(
			"AgentPond was updated. Restart this command to use the new version.",
		);
	} else {
		console.error(
			"AgentPond update failed. You can run: npm install -g agentpond@latest",
		);
	}
}

function runNpmUpdate(_version: string): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn("npm", ["install", "-g", "agentpond@latest"], {
			stdio: "inherit",
		});
		child.once("error", () => resolve(1));
		child.once("close", (code) => resolve(code ?? 1));
	});
}

function defaultCachePath(): string {
	return join(homedir(), ".cache", "agentpond", "update-check.json");
}

function readUpdateCache(cachePath: string): UpdateCheckCache | undefined {
	if (!existsSync(cachePath)) return undefined;
	try {
		return JSON.parse(readFileSync(cachePath, "utf8")) as UpdateCheckCache;
	} catch {
		return undefined;
	}
}

function writeUpdateCache(cachePath: string, cache: UpdateCheckCache): void {
	try {
		mkdirSync(dirname(cachePath), { recursive: true });
		writeFileSync(cachePath, JSON.stringify(cache), "utf8");
	} catch {
		// The update prompt is optional; cache failures should never block CLI startup.
	}
}
