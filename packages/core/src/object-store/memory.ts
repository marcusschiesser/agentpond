import type { ObjectStore } from "./types.js";
import {
	type IngestionSink,
	type ObjectStoreIngestionSinkOptions,
	sinkFromStore,
} from "./ingestion-handler.js";

export class MemoryObjectStore implements ObjectStore {
	readonly writes: string[] = [];
	private readonly objects = new Map<string, unknown>();

	toSink(options: ObjectStoreIngestionSinkOptions = {}): IngestionSink {
		return sinkFromStore(this, options);
	}

	async putJson(key: string, value: unknown): Promise<void> {
		this.writes.push(key);
		this.objects.set(key, JSON.parse(JSON.stringify(value)));
	}

	async getJson<T>(key: string): Promise<T> {
		if (!this.objects.has(key)) throw new Error(`Object not found: ${key}`);
		return this.objects.get(key) as T;
	}

	async listKeys(prefix: string): Promise<string[]> {
		return [...this.objects.keys()]
			.filter((key) => key.startsWith(prefix))
			.sort();
	}
}
