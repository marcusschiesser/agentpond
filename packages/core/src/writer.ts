import { createHash, randomUUID } from "node:crypto";
import type { ObjectStore } from "./object-store.js";
import type { EntityType, IngestionEvent } from "./schemas.js";
import { bodyIdForEvent, entityTypeForEvent } from "./schemas.js";
import { utcMinutePath } from "./time.js";

export type ManifestObject = {
	key: string;
	entityType: EntityType;
	entityId: string;
	eventIds: string[];
	minTimestamp: string;
	maxTimestamp: string;
	sha256: string;
};

export type BatchManifest = {
	batchId: string;
	projectId: string;
	createdAt: string;
	objects: ManifestObject[];
};

export type OtelStorageObject = {
	key: string;
	spanCount: number;
};

export type AcceptedEventWriterOptions = {
	store: ObjectStore;
	projectId: string;
	prefix?: string;
};

export class AcceptedEventWriter {
	private readonly prefix: string;

	constructor(private readonly options: AcceptedEventWriterOptions) {
		this.prefix = options.prefix ?? "";
	}

	async writeAcceptedEvents(
		events: IngestionEvent[],
		batchId = randomUUID(),
	): Promise<BatchManifest> {
		const grouped = new Map<string, IngestionEvent[]>();

		for (const event of events) {
			const entityType = entityTypeForEvent(event.type);
			const entityId = bodyIdForEvent(event);
			if (!entityId) continue;
			const key = `${entityType}:${entityId}`;
			const group = grouped.get(key) ?? [];
			group.push(event);
			grouped.set(key, group);
		}

		const objects: ManifestObject[] = [];
		for (const eventsForEntity of grouped.values()) {
			eventsForEntity.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
			const first = eventsForEntity[0];
			const entityType = entityTypeForEvent(first.type);
			const entityId = bodyIdForEvent(first);
			if (!entityId) continue;
			const key = `${this.prefix}${this.options.projectId}/${entityType}/${entityId}/${first.id}.json`;
			const serialized = JSON.stringify(eventsForEntity);
			await this.options.store.putJson(key, eventsForEntity);
			objects.push({
				key,
				entityType,
				entityId,
				eventIds: eventsForEntity.map((event) => event.id),
				minTimestamp: eventsForEntity[0].timestamp,
				maxTimestamp: eventsForEntity[eventsForEntity.length - 1].timestamp,
				sha256: createHash("sha256").update(serialized).digest("hex"),
			});
		}

		const createdAt = new Date().toISOString();
		const manifest: BatchManifest = {
			batchId,
			projectId: this.options.projectId,
			createdAt,
			objects,
		};
		await this.options.store.putJson(
			this.manifestKey(batchId, createdAt),
			manifest,
		);
		return manifest;
	}

	async writeOtelResourceSpans(
		resourceSpans: unknown[],
		batchId = randomUUID(),
	): Promise<OtelStorageObject | undefined> {
		if (resourceSpans.length === 0) return undefined;

		const key = `${this.prefix}otel/${this.options.projectId}/${utcMinutePath(new Date())}/${batchId}.json`;
		await this.options.store.putJson(key, resourceSpans);
		return { key, spanCount: countOtelSpans(resourceSpans) };
	}

	private manifestKey(batchId: string, timestamp: string): string {
		return `${this.prefix}${this.options.projectId}/manifests/${utcMinutePath(new Date(timestamp))}/${batchId}.json`;
	}
}

export function manifestPrefix(prefix: string, projectId: string): string {
	return `${prefix}${projectId}/manifests/`;
}

export function otelPrefix(prefix: string, projectId: string): string {
	return `${prefix}otel/${projectId}/`;
}

function countOtelSpans(resourceSpans: unknown[]): number {
	let count = 0;
	for (const resourceSpan of resourceSpans) {
		if (!resourceSpan || typeof resourceSpan !== "object") continue;
		const scopeSpans = (resourceSpan as Record<string, unknown>).scopeSpans;
		if (!Array.isArray(scopeSpans)) continue;
		for (const scopeSpan of scopeSpans) {
			if (!scopeSpan || typeof scopeSpan !== "object") continue;
			const spans = (scopeSpan as Record<string, unknown>).spans;
			if (Array.isArray(spans)) count += spans.length;
		}
	}
	return count;
}
