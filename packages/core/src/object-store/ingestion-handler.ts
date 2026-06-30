import type { IngestionEvent } from "../schemas.js";
import { AcceptedEventWriter } from "../writer.js";
import type { BatchManifest, OtelStorageObject } from "../writer.js";
import type { ObjectStore } from "./types.js";

export type IngestionSink = {
	writeEvents: (params: {
		projectId: string;
		prefix: string;
		events: IngestionEvent[];
	}) => Promise<unknown>;
	writeOtelResourceSpans: (params: {
		projectId: string;
		prefix: string;
		resourceSpans: unknown[];
	}) => Promise<unknown>;
};

export function sinkFromStore(store: ObjectStore): IngestionSink {
	return new ObjectStoreIngestionSink(store);
}

export class ObjectStoreIngestionSink implements IngestionSink {
	constructor(private readonly store: ObjectStore) {}

	async writeEvents(params: {
		projectId: string;
		prefix: string;
		events: IngestionEvent[];
	}): Promise<BatchManifest> {
		return await new AcceptedEventWriter({
			store: this.store,
			projectId: params.projectId,
			prefix: params.prefix,
		}).writeAcceptedEvents(params.events);
	}

	async writeOtelResourceSpans(params: {
		projectId: string;
		prefix: string;
		resourceSpans: unknown[];
	}): Promise<OtelStorageObject | undefined> {
		return await new AcceptedEventWriter({
			store: this.store,
			projectId: params.projectId,
			prefix: params.prefix,
		}).writeOtelResourceSpans(params.resourceSpans);
	}
}
