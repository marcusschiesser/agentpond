import type { IngestionSink, ObjectStore } from "@agentpond/core";

export type StoreOrSinkOptions = {
	store?: ObjectStore;
	sink?: IngestionSink;
};

export function resolveIngestionSink(
	options: StoreOrSinkOptions,
	defaultStore: ObjectStore | (() => ObjectStore),
): IngestionSink {
	if (options.store && options.sink) {
		throw new Error(
			"AgentPond ingest options cannot include both store and sink",
		);
	}
	if (options.sink) return options.sink;
	return (options.store ?? storeFromDefault(defaultStore)).toSink();
}

function storeFromDefault(defaultStore: ObjectStore | (() => ObjectStore)) {
	return typeof defaultStore === "function" ? defaultStore() : defaultStore;
}
