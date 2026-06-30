import {
	type AgentPondEnvironment,
	envValue,
	type IngestionSink,
	normalizePrefix,
	type ObjectStore,
	type ObjectStoreIngestionSinkOptions,
	parseEnvFile,
	sinkFromStore,
} from "@agentpond/core";
import { Storage } from "@google-cloud/storage";

export type GcsConfig = {
	bucket: string;
};

function gcsConfigForAgentPondEnvironment(envFilePath?: string): GcsConfig {
	const fileEnv = envFilePath ? parseEnvFile(envFilePath) : {};
	const env = envValue(fileEnv);
	return {
		bucket: env("AGENTPOND_GCS_BUCKET") ?? "agentpond",
	};
}

export function gcsConfigFromRuntimeEnv(): GcsConfig {
	return gcsConfigForAgentPondEnvironment();
}

type GcsFile = {
	save(data: string, options: { contentType: string }): Promise<void>;
	download(): Promise<[Buffer]>;
};

type GcsBucket = {
	file(name: string): GcsFile;
	getFiles(options: {
		prefix: string;
		autoPaginate: true;
	}): Promise<[{ name: string }[], ...unknown[]]>;
};

type GcsStorage = {
	bucket(name: string): GcsBucket;
};

export class GcsObjectStore implements ObjectStore {
	private readonly bucket: GcsBucket;

	static fromEnvironment(
		environment: AgentPondEnvironment | undefined,
	): GcsObjectStore {
		return new GcsObjectStore(
			gcsConfigForAgentPondEnvironment(environment?.envFilePath),
		);
	}

	static fromRuntimeEnv(): GcsObjectStore {
		return new GcsObjectStore(gcsConfigFromRuntimeEnv());
	}

	constructor(
		readonly config: GcsConfig,
		storage: GcsStorage = new Storage(),
	) {
		this.bucket = storage.bucket(config.bucket);
	}

	toSink(options: ObjectStoreIngestionSinkOptions = {}): IngestionSink {
		return sinkFromStore(this, {
			prefix:
				options.prefix ??
				normalizePrefix(
					process.env.AGENTPOND_PREFIX ??
						process.env.AGENTPOND_GCS_PREFIX ??
						"",
				),
		});
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
