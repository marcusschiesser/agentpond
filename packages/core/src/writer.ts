import { createHash, randomUUID } from "node:crypto";
import type { ObjectStore } from "./object-store.js";
import type { BatchResult, EntityType, IngestionEvent } from "./schemas.js";
import {
	bodyIdForEvent,
	entityTypeForEvent,
	parseIngestionEvents,
} from "./schemas.js";

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

	async processBatch(input: unknown[]): Promise<BatchResult> {
		const { events, errors } = parseIngestionEvents(input);
		if (events.length > 0) {
			await this.writeAcceptedEvents(events);
		}
		return {
			successes: events.map((event) => ({ id: event.id, status: 201 })),
			errors,
		};
	}

	async writeOtelResourceSpans(
		resourceSpans: unknown[],
		batchId = randomUUID(),
	): Promise<BatchManifest | undefined> {
		if (resourceSpans.length === 0) return undefined;

		const key = `${this.prefix}otel/${this.options.projectId}/${this.currentTimePath()}/${batchId}.json`;
		const serialized = JSON.stringify(resourceSpans);
		await this.options.store.putJson(key, resourceSpans);

		const createdAt = new Date().toISOString();
		const manifest: BatchManifest = {
			batchId,
			projectId: this.options.projectId,
			createdAt,
			objects: [
				{
					key,
					entityType: "otel",
					entityId: batchId,
					eventIds: [],
					minTimestamp: createdAt,
					maxTimestamp: createdAt,
					sha256: createHash("sha256").update(serialized).digest("hex"),
				},
			],
		};
		await this.options.store.putJson(
			this.manifestKey(batchId, createdAt),
			manifest,
		);
		return manifest;
	}

	private manifestKey(batchId: string, timestamp: string): string {
		const date = new Date(timestamp);
		const yyyy = String(date.getUTCFullYear());
		const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
		const dd = String(date.getUTCDate()).padStart(2, "0");
		const hh = String(date.getUTCHours()).padStart(2, "0");
		return `${this.prefix}${this.options.projectId}/manifests/${yyyy}/${mm}/${dd}/${hh}/${batchId}.json`;
	}

	private currentTimePath(): string {
		const date = new Date();
		const yyyy = String(date.getFullYear());
		const mm = String(date.getMonth() + 1).padStart(2, "0");
		const dd = String(date.getDate()).padStart(2, "0");
		const hh = String(date.getHours()).padStart(2, "0");
		const min = String(date.getMinutes()).padStart(2, "0");
		return `${yyyy}/${mm}/${dd}/${hh}/${min}`;
	}
}

export function manifestPrefix(prefix: string, projectId: string): string {
	return `${prefix}${projectId}/manifests/`;
}
