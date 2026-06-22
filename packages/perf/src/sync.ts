import type { S3ObjectStore } from "@agentpond/core";
import type { AgentPondCache, SyncProgress } from "@agentpond/duckdb";
import type { PerfArgs } from "./args.js";

export type SyncTiming = {
	durationMs: number;
	result: Awaited<ReturnType<AgentPondCache["syncFromStore"]>>;
};

export async function timeSync(
	db: AgentPondCache,
	store: S3ObjectStore,
	args: PerfArgs,
	onProgress?: (progress: SyncProgress) => void,
): Promise<SyncTiming> {
	const started = performance.now();
	const result = await db.syncFromStore({
		store,
		projectId: args.projectId,
		prefix: args.prefix,
		onProgress,
	});
	return {
		durationMs: performance.now() - started,
		result,
	};
}

export async function countTraces(db: AgentPondCache): Promise<number> {
	const rows = await db.query<{ count: bigint | number }>(
		"select count(*) as count from traces",
	);
	return Number(rows[0]?.count ?? 0);
}

export function roundMs(value: number): number {
	return Math.round(value * 100) / 100;
}

export function formatDuration(value: number): string {
	if (value < 1000) return `${roundMs(value)}ms`;
	const seconds = value / 1000;
	if (seconds < 60) return `${Math.round(seconds * 100) / 100}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = Math.round((seconds - minutes * 60) * 100) / 100;
	return `${minutes}m ${remainingSeconds}s`;
}

export function formatSyncTiming(timing: SyncTiming) {
	return {
		durationMs: roundMs(timing.durationMs),
		result: timing.result,
	};
}
