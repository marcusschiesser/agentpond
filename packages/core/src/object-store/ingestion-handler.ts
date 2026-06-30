import type { IngestionEvent } from "../schemas.js";
import { AcceptedEventWriter } from "../writer.js";
import type { BatchManifest, OtelStorageObject } from "../writer.js";
import { normalizePrefix } from "../config.js";
import type { ObjectStore } from "./types.js";

export type IngestionSink = {
	writeEvents: (params: {
		projectId: string;
		events: IngestionEvent[];
	}) => Promise<unknown>;
	writeOtelResourceSpans: (params: {
		projectId: string;
		resourceSpans: unknown[];
	}) => Promise<unknown>;
};

export type ObjectStoreIngestionSinkOptions = {
	prefix?: string;
};

export function sinkFromStore(
	store: ObjectStore,
	options: ObjectStoreIngestionSinkOptions = {},
): IngestionSink {
	return new ObjectStoreIngestionSink(store, options);
}

export class ObjectStoreIngestionSink implements IngestionSink {
	private readonly prefix: string;

	constructor(
		private readonly store: ObjectStore,
		options: ObjectStoreIngestionSinkOptions = {},
	) {
		this.prefix = normalizePrefix(options.prefix ?? "");
	}

	async writeEvents(params: {
		projectId: string;
		events: IngestionEvent[];
	}): Promise<BatchManifest> {
		return await new AcceptedEventWriter({
			store: this.store,
			projectId: params.projectId,
			prefix: this.prefix,
		}).writeAcceptedEvents(params.events);
	}

	async writeOtelResourceSpans(params: {
		projectId: string;
		resourceSpans: unknown[];
	}): Promise<OtelStorageObject | undefined> {
		return await new AcceptedEventWriter({
			store: this.store,
			projectId: params.projectId,
			prefix: this.prefix,
		}).writeOtelResourceSpans(params.resourceSpans);
	}
}
