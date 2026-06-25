import {
	bodyIdForEvent,
	type IngestionEvent,
	otelResourceSpansToEvents,
} from "@agentpond/core";
import type { DuckDbOperations } from "../cache/db-operations.js";
import { BatchProjection, rawEventRow } from "../cache/projection.js";

export type DirectWriteResult = {
	eventsProcessed: number;
	eventsSkipped: number;
};

export class DuckDbDirectIngestion {
	constructor(private readonly db: DuckDbOperations) {}

	async writeEvents(params: {
		projectId: string;
		events: IngestionEvent[];
		source?: string;
	}): Promise<DirectWriteResult> {
		const eventIds = params.events.map((event) => event.id);
		const existingEventIds = await this.db.existingRawEventIds(eventIds);
		const projection = new BatchProjection(this.db);
		let eventsSkipped = 0;
		for (const event of params.events) {
			if (existingEventIds.has(event.id)) {
				eventsSkipped += 1;
				continue;
			}
			projection.addRawEvent(
				rawEventRow({
					projectId: params.projectId,
					manifestKey: null,
					objectKey: `${params.source ?? "direct"}/${event.id}`,
					entityId: bodyIdForEvent(event) ?? event.id,
					event,
				}),
			);
		}
		if (projection.pendingEventCount === 0) {
			return { eventsProcessed: 0, eventsSkipped };
		}
		await this.db.exec("BEGIN TRANSACTION");
		try {
			await projection.commit(params.projectId);
			await this.db.exec("COMMIT");
		} catch (error) {
			await this.db.exec("ROLLBACK");
			throw error;
		}
		return {
			eventsProcessed: projection.pendingEventCount,
			eventsSkipped,
		};
	}

	async writeOtelResourceSpans(params: {
		projectId: string;
		resourceSpans: unknown[];
		source?: string;
	}): Promise<DirectWriteResult> {
		return this.writeEvents({
			projectId: params.projectId,
			events: otelResourceSpansToEvents(params.resourceSpans),
			source: params.source ?? "otel-direct",
		});
	}
}
