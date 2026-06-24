import type { IngestionEvent } from "../schemas.js";
import { AcceptedEventWriter } from "../writer.js";
import type { ObjectStore } from "./types.js";

export class ObjectStoreIngestionSink {
	constructor(private readonly store: ObjectStore) {}

	async writeEvents(params: {
		projectId: string;
		prefix: string;
		events: IngestionEvent[];
	}): Promise<void> {
		await new AcceptedEventWriter({
			store: this.store,
			projectId: params.projectId,
			prefix: params.prefix,
		}).writeAcceptedEvents(params.events);
	}

	async writeOtelResourceSpans(params: {
		projectId: string;
		prefix: string;
		resourceSpans: unknown[];
	}): Promise<void> {
		await new AcceptedEventWriter({
			store: this.store,
			projectId: params.projectId,
			prefix: params.prefix,
		}).writeOtelResourceSpans(params.resourceSpans);
	}
}
