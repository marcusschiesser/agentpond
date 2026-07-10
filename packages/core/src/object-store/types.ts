import type {
	IngestionSink,
	ObjectStoreIngestionSinkOptions,
} from "./ingestion-handler.js";

export type ObjectStore = {
	toSink(options?: ObjectStoreIngestionSinkOptions): IngestionSink;
	putJson(key: string, value: unknown): Promise<void>;
	getJson<T>(key: string): Promise<T>;
	listKeys(prefix: string): Promise<string[]>;
};
