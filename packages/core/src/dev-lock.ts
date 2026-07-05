import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { AgentPondEnvironment } from "./environment.js";

export const DEV_SERVER_RUNNING_MESSAGE =
	"dev server is running; stop it or use the dev ingestion endpoint";

export type DevServerLock = {
	pid: number;
	startedAt: string;
	dbPath: string;
	command: string;
	host?: string;
	port?: number;
	url?: string;
};

export type AcquiredDevServerLock = {
	path: string;
	update: (values: Pick<DevServerLock, "host" | "port" | "url">) => void;
	release: () => void;
};

export function devServerLockPath(environment: AgentPondEnvironment): string {
	return join(environment.envDir, "dev-server.lock");
}

export function acquireDevServerLock(
	environment: AgentPondEnvironment,
): AcquiredDevServerLock {
	const path = devServerLockPath(environment);
	removeStaleDevServerLock(path);
	mkdirSync(dirname(path), { recursive: true });
	const fd = openSync(path, "wx");
	closeSync(fd);
	const lock: DevServerLock = {
		pid: process.pid,
		startedAt: new Date().toISOString(),
		dbPath: environment.dbPath,
		command: process.argv.join(" "),
	};
	writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
	let released = false;
	return {
		path,
		update: (values) => {
			if (released) return;
			const current = readDevServerLockFile(path);
			if (current?.pid !== process.pid) return;
			writeFileSync(
				path,
				`${JSON.stringify({ ...current, ...values }, null, 2)}\n`,
				"utf8",
			);
		},
		release: () => {
			if (released) return;
			released = true;
			try {
				const current = readDevServerLockFile(path);
				if (current?.pid === process.pid) unlinkSync(path);
			} catch {
				// Best-effort cleanup during process shutdown.
			}
		},
	};
}

export function isDevServerRunning(environment: AgentPondEnvironment): boolean {
	const path = devServerLockPath(environment);
	removeStaleDevServerLock(path);
	return readDevServerLockFile(path) !== undefined;
}

export function readDevServerLock(
	environment: AgentPondEnvironment,
): DevServerLock | undefined {
	const path = devServerLockPath(environment);
	removeStaleDevServerLock(path);
	return readDevServerLockFile(path);
}

function removeStaleDevServerLock(path: string): void {
	const lock = readDevServerLockFile(path);
	if (!lock) {
		if (existsSync(path)) {
			try {
				unlinkSync(path);
			} catch {
				// Another process may have removed or replaced it.
			}
		}
		return;
	}
	if (isProcessAlive(lock.pid)) return;
	try {
		unlinkSync(path);
	} catch {
		// Another process may have removed or replaced it.
	}
}

function readDevServerLockFile(path: string): DevServerLock | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(
			readFileSync(path, "utf8"),
		) as Partial<DevServerLock>;
		if (typeof parsed.pid !== "number") return undefined;
		return {
			pid: parsed.pid,
			startedAt: String(parsed.startedAt ?? ""),
			dbPath: String(parsed.dbPath ?? ""),
			command: String(parsed.command ?? ""),
			host: typeof parsed.host === "string" ? parsed.host : undefined,
			port: typeof parsed.port === "number" ? parsed.port : undefined,
			url: typeof parsed.url === "string" ? parsed.url : undefined,
		};
	} catch {
		return undefined;
	}
}

function isProcessAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "EPERM";
	}
}
