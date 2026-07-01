import { resolve } from "node:path";

const writeQueues = new Map<string, Promise<void>>();

export async function withDuckDbWriteLock<T>(
	dbPath: string,
	write: () => Promise<T>,
): Promise<T> {
	const key = resolve(dbPath);
	const previous = writeQueues.get(key) ?? Promise.resolve();
	let release!: () => void;
	const current = new Promise<void>((resolveCurrent) => {
		release = resolveCurrent;
	});
	const tail = previous.catch(() => undefined).then(() => current);
	writeQueues.set(key, tail);
	await previous.catch(() => undefined);

	try {
		return await retryDuckDbLockConflicts(write);
	} finally {
		release();
		if (writeQueues.get(key) === tail) writeQueues.delete(key);
	}
}

export async function retryDuckDbLockConflicts<T>(
	write: () => Promise<T>,
): Promise<T> {
	const maxAttempts = 30;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await write();
		} catch (error) {
			if (!isDuckDbLockConflict(error) || attempt === maxAttempts) {
				throw error;
			}
			await delay(Math.min(50 * attempt, 1000));
		}
	}
	throw new Error("unreachable DuckDB lock retry state");
}

export function isDuckDbLockConflict(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return (
		message.includes("Could not set lock") ||
		message.includes("Conflicting lock")
	);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolveDelay) => {
		setTimeout(resolveDelay, ms);
	});
}
