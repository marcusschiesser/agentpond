import {
	type AgentPondEnvironment,
	envValue,
	type IngestionSink,
	nonEmpty,
	type ObjectStore,
	type ObjectStoreIngestionSinkOptions,
	parseEnvFile,
	sinkFromStore,
} from "@agentpond/core";
import type { Files } from "files-sdk";
import { loadFiles } from "files-sdk/loader";
import { getProvider } from "files-sdk/providers";

const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const UNSUPPORTED_NODE_PROVIDERS = new Set(["bun-s3"]);

export type FilesClient = Pick<Files, "download" | "listAll" | "upload">;

export type FilesSdkObjectStoreConfig = {
	provider: string;
	bucket: string;
	endpoint?: string;
	region?: string;
};

type ProviderHelp = {
	provider: string;
	peerDependencies: readonly string[];
};

export class FilesObjectStore implements ObjectStore {
	private readonly files: Promise<FilesClient>;
	private providerHelp?: ProviderHelp;

	static fromEnvironment(
		environment: AgentPondEnvironment | undefined,
	): FilesObjectStore {
		return FilesObjectStore.fromConfig(
			filesSdkConfigFromEnvironment(environment),
		);
	}

	static fromRuntimeEnv(
		env: NodeJS.ProcessEnv = process.env,
	): FilesObjectStore {
		return FilesObjectStore.fromConfig(filesSdkConfigFromRuntimeEnv(env));
	}

	static fromConfig(config: FilesSdkObjectStoreConfig): FilesObjectStore {
		const definition = validateFilesSdkConfig(config);
		const store = new FilesObjectStore(loadConfiguredFiles(config));
		store.providerHelp = {
			provider: config.provider,
			peerDependencies: definition.peerDeps,
		};
		return store;
	}

	constructor(files: FilesClient | PromiseLike<FilesClient>) {
		this.files = Promise.resolve(files);
	}

	toSink(options: ObjectStoreIngestionSinkOptions = {}): IngestionSink {
		return sinkFromStore(this, options);
	}

	async putJson(key: string, value: unknown): Promise<void> {
		const json = JSON.stringify(value);
		if (json === undefined) {
			throw new Error(`Value for object "${key}" is not JSON serializable`);
		}
		try {
			const files = await this.files;
			await files.upload(key, json, { contentType: "application/json" });
		} catch (error) {
			throw this.withProviderHelp(error);
		}
	}

	async getJson<T>(key: string): Promise<T> {
		let content: string;
		try {
			const files = await this.files;
			content = await (await files.download(key)).text();
		} catch (error) {
			throw this.withProviderHelp(error);
		}
		try {
			return JSON.parse(content) as T;
		} catch (error) {
			throw new Error(`Object "${key}" does not contain valid JSON`, {
				cause: error,
			});
		}
	}

	async listKeys(prefix: string): Promise<string[]> {
		const keys: string[] = [];
		try {
			const files = await this.files;
			for await (const file of files.listAll({ prefix })) {
				keys.push(file.key);
			}
		} catch (error) {
			throw this.withProviderHelp(error);
		}
		return keys.sort();
	}

	private withProviderHelp(error: unknown): unknown {
		if (!this.providerHelp || this.providerHelp.peerDependencies.length === 0) {
			return error;
		}
		const message = error instanceof Error ? error.message : String(error);
		return new Error(
			`${message}\nFiles SDK provider "${this.providerHelp.provider}" may require these packages: ${this.providerHelp.peerDependencies.join(", ")}`,
			{ cause: error },
		);
	}
}

export function filesSdkConfigFromEnvironment(
	environment: AgentPondEnvironment | undefined,
): FilesSdkObjectStoreConfig {
	if (!environment) {
		throw new Error(
			"Files SDK object storage requires an AgentPond environment",
		);
	}
	const env = envValue(parseEnvFile(environment.envFilePath));
	return filesSdkConfigFromValues(env);
}

export function filesSdkConfigFromRuntimeEnv(
	env: NodeJS.ProcessEnv = process.env,
): FilesSdkObjectStoreConfig {
	return filesSdkConfigFromValues((name) => env[name]);
}

function filesSdkConfigFromValues(
	env: (name: string) => string | undefined,
): FilesSdkObjectStoreConfig {
	const provider = nonEmpty(env("FILES_SDK_PROVIDER"));
	const bucket = nonEmpty(env("AGENTPOND_FILES_BUCKET"));
	if (!provider) {
		throw new Error("Files SDK object storage requires FILES_SDK_PROVIDER");
	}
	if (!bucket) {
		throw new Error("Files SDK object storage requires AGENTPOND_FILES_BUCKET");
	}
	const config = {
		provider,
		bucket,
		endpoint: nonEmpty(env("FILES_SDK_ENDPOINT")),
		region: nonEmpty(env("FILES_SDK_REGION")),
	};
	validateFilesSdkConfig(config);
	return config;
}

function validateFilesSdkConfig(config: FilesSdkObjectStoreConfig) {
	const definition = getProvider(config.provider);
	if (!definition) {
		throw new Error(`Unknown Files SDK provider "${config.provider}"`);
	}
	if (!definition.env.config?.includes("bucket")) {
		throw new Error(
			`Files SDK provider "${config.provider}" is not bucket-backed and is not supported by AgentPond`,
		);
	}
	if (UNSUPPORTED_NODE_PROVIDERS.has(config.provider)) {
		throw new Error(
			`Files SDK provider "${config.provider}" is not supported by AgentPond's Node.js runtime`,
		);
	}
	for (const field of definition.env.config) {
		if (field === "bucket") continue;
		if (field === "endpoint" && !config.endpoint) {
			throw new Error(
				`Files SDK provider "${config.provider}" requires FILES_SDK_ENDPOINT`,
			);
		}
		if (field === "region" && !config.region) {
			throw new Error(
				`Files SDK provider "${config.provider}" requires FILES_SDK_REGION`,
			);
		}
		if (field !== "endpoint" && field !== "region") {
			throw new Error(
				`Files SDK provider "${config.provider}" requires unsupported configuration field "${field}"`,
			);
		}
	}
	return definition;
}

async function loadConfiguredFiles(
	config: FilesSdkObjectStoreConfig,
): Promise<FilesClient> {
	const { files } = await loadFiles({
		bucket: config.bucket,
		provider: config.provider,
		...(config.endpoint ? { endpoint: config.endpoint } : {}),
		...(config.region ? { region: config.region } : {}),
		retries: DEFAULT_RETRIES,
		timeout: DEFAULT_TIMEOUT_MS,
	});
	return files;
}
