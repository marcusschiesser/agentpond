import type { BatchManifest, S3ObjectStore } from "@agentpond/core";

export type StorageStats = {
	objectCount: number;
	manifestCount: number;
	totalStoredOtelBytes: number;
	averageBytesPerTrace: number;
	traceBytes: {
		min: number;
		p50: number;
		p95: number;
		max: number;
	};
};

export async function collectStorageStats(
	store: S3ObjectStore,
	prefix: string,
	projectId: string,
): Promise<StorageStats> {
	const manifestKeys = await store.listKeys(`${prefix}${projectId}/manifests/`);
	const manifests = await Promise.all(
		manifestKeys.map((key) => store.getJson<BatchManifest>(key)),
	);
	const objectKeys = [
		...new Set(
			manifests.flatMap((manifest) =>
				manifest.objects.map((object) => object.key),
			),
		),
	].sort();
	const traceBytes = new Map<string, number>();
	let totalStoredOtelBytes = 0;

	for (const key of objectKeys) {
		const resourceSpans = await store.getJson<unknown[]>(key);
		totalStoredOtelBytes += byteLength(resourceSpans);
		for (const span of spansFromResourceSpans(resourceSpans)) {
			const traceId = stringField(span, "traceId");
			if (!traceId) continue;
			traceBytes.set(
				traceId,
				(traceBytes.get(traceId) ?? 0) + byteLength(span),
			);
		}
	}

	const sizes = [...traceBytes.values()].sort((a, b) => a - b);
	return {
		objectCount: objectKeys.length,
		manifestCount: manifestKeys.length,
		totalStoredOtelBytes,
		averageBytesPerTrace: sizes.length
			? Math.round(totalStoredOtelBytes / sizes.length)
			: 0,
		traceBytes: {
			min: percentile(sizes, 0),
			p50: percentile(sizes, 0.5),
			p95: percentile(sizes, 0.95),
			max: percentile(sizes, 1),
		},
	};
}

function spansFromResourceSpans(resourceSpans: unknown[]): unknown[] {
	const spans: unknown[] = [];
	for (const resourceSpan of resourceSpans) {
		for (const scopeSpan of arrayField(resourceSpan, "scopeSpans")) {
			spans.push(...arrayField(scopeSpan, "spans"));
		}
	}
	return spans;
}

function arrayField(value: unknown, key: string): unknown[] {
	if (!value || typeof value !== "object") return [];
	const field = (value as Record<string, unknown>)[key];
	return Array.isArray(field) ? field : [];
}

function stringField(value: unknown, key: string): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const field = (value as Record<string, unknown>)[key];
	return typeof field === "string" ? field : undefined;
}

function byteLength(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function percentile(sortedValues: number[], percentileValue: number): number {
	if (sortedValues.length === 0) return 0;
	const index = Math.min(
		sortedValues.length - 1,
		Math.floor((sortedValues.length - 1) * percentileValue),
	);
	return sortedValues[index];
}
