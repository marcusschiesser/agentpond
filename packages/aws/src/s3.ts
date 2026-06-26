import {
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import type { ObjectStore, S3Config } from "@agentpond/core";

export class S3ObjectStore implements ObjectStore {
	private readonly client: S3Client;

	constructor(private readonly config: S3Config) {
		this.client = new S3Client({
			endpoint: config.endpoint,
			region: config.region,
			forcePathStyle: config.forcePathStyle,
			credentials:
				config.accessKeyId && config.secretAccessKey
					? {
							accessKeyId: config.accessKeyId,
							secretAccessKey: config.secretAccessKey,
						}
					: undefined,
		});
	}

	async putJson(key: string, value: unknown): Promise<void> {
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.config.bucket,
				Key: key,
				Body: JSON.stringify(value),
				ContentType: "application/json",
			}),
		);
	}

	async getJson<T>(key: string): Promise<T> {
		const response = await this.client.send(
			new GetObjectCommand({
				Bucket: this.config.bucket,
				Key: key,
			}),
		);
		const body = await response.Body?.transformToString();
		if (!body) throw new Error(`S3 object is empty: ${key}`);
		return JSON.parse(body) as T;
	}

	async listKeys(prefix: string): Promise<string[]> {
		const keys: string[] = [];
		let ContinuationToken: string | undefined;
		do {
			const response = await this.client.send(
				new ListObjectsV2Command({
					Bucket: this.config.bucket,
					Prefix: prefix,
					ContinuationToken,
				}),
			);
			for (const item of response.Contents ?? []) {
				if (item.Key) keys.push(item.Key);
			}
			ContinuationToken = response.NextContinuationToken;
		} while (ContinuationToken);
		return keys.sort();
	}
}
