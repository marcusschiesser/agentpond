import { AcceptedEventWriter, type BatchResult } from "../writer.js";
import type { ObjectStore } from "./types.js";

export class ObjectStoreIngestionHandler {
	constructor(private readonly store: ObjectStore) {}

	async processBatch(params: {
		projectId: string;
		prefix: string;
		batch: unknown[];
	}): Promise<BatchResult> {
		return new AcceptedEventWriter({
			store: this.store,
			projectId: params.projectId,
			prefix: params.prefix,
		}).processBatch(params.batch);
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
