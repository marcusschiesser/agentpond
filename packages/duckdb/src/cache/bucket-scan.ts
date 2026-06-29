import { type ObjectStore, utcHourPath } from "@agentpond/core";

export type BucketScanWindow = {
	start: Date;
	end: Date;
	finalized: Date;
};

export function currentBucketScanWindow(
	now = floorUtcMinute(new Date()),
): BucketScanWindow {
	return {
		start: addMinutes(now, -24 * 60),
		end: now,
		finalized: addMinutes(now, -5),
	};
}

export function bucketScanWindowFromState(
	lastFinalized: Date | undefined,
	now = floorUtcMinute(new Date()),
): BucketScanWindow {
	return {
		start: lastFinalized
			? addMinutes(lastFinalized, -30)
			: addMinutes(now, -24 * 60),
		end: now,
		finalized: addMinutes(now, -5),
	};
}

export async function listKeysForUtcHourBuckets(params: {
	store: ObjectStore;
	prefix: string;
	start: Date;
	end: Date;
}): Promise<string[]> {
	const keys: string[] = [];
	for (const bucket of utcHourBuckets(params.start, params.end)) {
		keys.push(...(await params.store.listKeys(`${params.prefix}${bucket}/`)));
	}
	return [...new Set(keys)].sort();
}

export function floorUtcMinute(date: Date): Date {
	return new Date(
		Date.UTC(
			date.getUTCFullYear(),
			date.getUTCMonth(),
			date.getUTCDate(),
			date.getUTCHours(),
			date.getUTCMinutes(),
		),
	);
}

export function addMinutes(date: Date, minutes: number): Date {
	return new Date(date.getTime() + minutes * 60_000);
}

function* utcHourBuckets(start: Date, end: Date): Generator<string> {
	let cursor = floorUtcMinute(start);
	cursor = new Date(
		Date.UTC(
			cursor.getUTCFullYear(),
			cursor.getUTCMonth(),
			cursor.getUTCDate(),
			cursor.getUTCHours(),
		),
	);
	const last = floorUtcMinute(end);
	while (cursor.getTime() <= last.getTime()) {
		yield utcHourPath(cursor);
		cursor = addMinutes(cursor, 60);
	}
}
