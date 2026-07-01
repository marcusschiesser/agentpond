import {
	type AgentPondEnvironment,
	envValue,
	type IngestionSink,
	nonEmpty,
	normalizePrefix,
	type ObjectStore,
	type ObjectStoreIngestionSinkOptions,
	parseEnvFile,
	sinkFromStore,
} from "@agentpond/core";
import {
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";

export type S3ChecksumSetting = "WHEN_SUPPORTED" | "WHEN_REQUIRED";

export type S3Config = {
	bucket: string;
	endpoint?: string;
	region: string;
	accessKeyId?: string;
	secretAccessKey?: string;
	forcePathStyle?: boolean;
	requestChecksumCalculation?: S3ChecksumSetting;
	responseChecksumValidation?: S3ChecksumSetting;
};

function s3ConfigForAgentPondEnvironment(envFilePath?: string): S3Config {
	const fileEnv = envFilePath ? parseEnvFile(envFilePath) : {};
	const env = envValue(fileEnv);
	return {
		bucket: env("AGENTPOND_S3_BUCKET") ?? "agentpond",
		endpoint: nonEmpty(env("AGENTPOND_S3_ENDPOINT")),
		region: env("AWS_REGION") ?? env("AGENTPOND_S3_REGION") ?? "us-east-1",
		accessKeyId:
			nonEmpty(env("AWS_ACCESS_KEY_ID")) ??
			nonEmpty(env("AGENTPOND_S3_ACCESS_KEY_ID")),
		secretAccessKey:
			nonEmpty(env("AWS_SECRET_ACCESS_KEY")) ??
			nonEmpty(env("AGENTPOND_S3_SECRET_ACCESS_KEY")),
		forcePathStyle:
			(env("AGENTPOND_S3_FORCE_PATH_STYLE") ?? "true") !== "false",
		requestChecksumCalculation: checksumSettingFromEnv(
			"AGENTPOND_S3_REQUEST_CHECKSUM_CALCULATION",
			env("AGENTPOND_S3_REQUEST_CHECKSUM_CALCULATION"),
		),
		responseChecksumValidation: checksumSettingFromEnv(
			"AGENTPOND_S3_RESPONSE_CHECKSUM_VALIDATION",
			env("AGENTPOND_S3_RESPONSE_CHECKSUM_VALIDATION"),
		),
	};
}

export function s3ConfigFromRuntimeEnv(): S3Config {
	return s3ConfigForAgentPondEnvironment();
}

export class S3ObjectStore implements ObjectStore {
	private readonly client: S3Client;

	static fromEnvironment(
		environment: AgentPondEnvironment | undefined,
	): S3ObjectStore {
		return new S3ObjectStore(
			s3ConfigForAgentPondEnvironment(environment?.envFilePath),
		);
	}

	static fromRuntimeEnv(): S3ObjectStore {
		return new S3ObjectStore(s3ConfigFromRuntimeEnv());
	}

	static fromConfig(config: S3Config): S3ObjectStore {
		return new S3ObjectStore(config);
	}

	constructor(private readonly config: S3Config) {
		this.client = new S3Client({
			endpoint: config.endpoint,
			region: config.region,
			forcePathStyle: config.forcePathStyle ?? false,
			requestChecksumCalculation: config.requestChecksumCalculation,
			responseChecksumValidation: config.responseChecksumValidation,
			credentials:
				config.accessKeyId && config.secretAccessKey
					? {
							accessKeyId: config.accessKeyId,
							secretAccessKey: config.secretAccessKey,
						}
					: undefined,
		});
	}

	toSink(options: ObjectStoreIngestionSinkOptions = {}): IngestionSink {
		return sinkFromStore(this, {
			prefix:
				options.prefix ??
				normalizePrefix(
					process.env.AGENTPOND_PREFIX ?? process.env.AGENTPOND_S3_PREFIX ?? "",
				),
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

function checksumSettingFromEnv(
	name: string,
	value: string | undefined,
): S3ChecksumSetting | undefined {
	const setting = nonEmpty(value);
	if (setting === undefined) return undefined;
	if (setting === "WHEN_SUPPORTED" || setting === "WHEN_REQUIRED") {
		return setting;
	}
	throw new Error(
		`${name} must be "WHEN_SUPPORTED" or "WHEN_REQUIRED", got "${setting}"`,
	);
}
