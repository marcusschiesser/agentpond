import {
	type IngestionSink,
	type ObjectStore,
	type ObjectStoreIngestionSinkOptions,
	sinkFromStore,
} from "@agentpond/core";

export type FirebaseBucketFile = {
	save(data: string, options: { contentType: string }): Promise<void>;
	download(): Promise<[Buffer]>;
};

export type FirebaseBucket = {
	file(name: string): FirebaseBucketFile;
	getFiles(options: {
		prefix: string;
		autoPaginate: true;
	}): Promise<[{ name: string }[], ...unknown[]]>;
};

export class FirebaseBucketObjectStore implements ObjectStore {
	constructor(private readonly bucket: FirebaseBucket) {}

	toSink(options: ObjectStoreIngestionSinkOptions = {}): IngestionSink {
		return sinkFromStore(this, options);
	}

	async putJson(key: string, value: unknown): Promise<void> {
		await this.bucket.file(key).save(JSON.stringify(value), {
			contentType: "application/json",
		});
	}

	async getJson<T>(key: string): Promise<T> {
		const [body] = await this.bucket.file(key).download();
		if (body.length === 0) throw new Error(`GCS object is empty: ${key}`);
		return JSON.parse(body.toString("utf8")) as T;
	}

	async listKeys(prefix: string): Promise<string[]> {
		const [files] = await this.bucket.getFiles({ prefix, autoPaginate: true });
		return files.map((file) => file.name).sort();
	}
}
