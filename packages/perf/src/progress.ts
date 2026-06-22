import type { SyncProgress } from "@agentpond/duckdb";
import type { LoadProgress } from "./load.js";

type ThrottleState = {
	lastLoggedAt: number;
};

const LOG_INTERVAL_MS = 1000;

export function logStep(message: string): void {
	console.error(`[perf] ${message}`);
}

export function createLoadProgressLogger(): (progress: LoadProgress) => void {
	const state: ThrottleState = { lastLoggedAt: 0 };
	return (progress) => {
		if (
			progress.generatedTraces !== progress.totalTraces &&
			!shouldLog(state)
		) {
			return;
		}
		const percent =
			progress.totalTraces > 0
				? Math.floor((progress.generatedTraces / progress.totalTraces) * 100)
				: 100;
		logStep(
			`ingestion generated ${progress.generatedTraces}/${progress.totalTraces} traces (${percent}%)`,
		);
	};
}

export function createSyncProgressLogger(
	label: string,
): (progress: SyncProgress) => void {
	const state: ThrottleState = { lastLoggedAt: 0 };
	return (progress) => {
		if (progress.phase !== "complete" && !shouldLog(state)) return;
		logStep(
			`${label} sync ${progress.phase}: manifests ${progress.manifestsSeen}/${progress.manifestsTotal} ` +
				`processed=${progress.manifestsProcessed} skipped=${progress.manifestsSkipped}, ` +
				`objects processed=${progress.objectsProcessed} skipped=${progress.objectsSkipped}, ` +
				`events=${progress.eventsProcessed}`,
		);
	};
}

function shouldLog(state: ThrottleState): boolean {
	const now = Date.now();
	if (state.lastLoggedAt !== 0 && now - state.lastLoggedAt < LOG_INTERVAL_MS) {
		return false;
	}
	state.lastLoggedAt = now;
	return true;
}
