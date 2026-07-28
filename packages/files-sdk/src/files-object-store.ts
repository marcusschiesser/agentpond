import {
	type AgentPondEnvironment,
	type IngestionSink,
	nonEmpty,
	type ObjectStore,
	type ObjectStoreIngestionSinkOptions,
	parseEnvFile,
	sinkFromStore,
} from "@agentpond/core";
import type { Files } from "files-sdk";
import { loadFiles } from "files-sdk/loader";
import {
	getProvider,
	PROVIDER_NAMES,
	type Provider,
} from "files-sdk/providers";

const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const UNSUPPORTED_NODE_PROVIDERS = new Set(["bun-s3"]);
const NON_PERSISTENT_PROVIDERS = new Set(["memory"]);
const SUPPORTED_PROVIDER_CONFIG_FIELDS = [
	"bucket",
	"endpoint",
	"region",
	"root",
] as const;
const SUPPORTED_PROVIDER_CONFIG_FIELD_SET = new Set<string>(
	SUPPORTED_PROVIDER_CONFIG_FIELDS,
);
const PROVIDER_CONFIG_FIELD_OVERRIDES: Record<string, readonly string[]> = {
	akamai: ["bucket", "region"],
	"backblaze-b2": ["bucket", "region"],
	"ibm-cos": ["bucket", "region"],
	"oracle-cloud": ["bucket", "namespace", "region"],
};

export type FilesClient = Pick<Files, "download" | "listAll" | "upload">;

export type FilesSdkObjectStoreConfig = {
	provider: string;
	bucket?: string;
	endpoint?: string;
	region?: string;
	root?: string;
};

type ProviderHelp = {
	provider: string;
	peerDependencies: readonly string[];
};

export type FilesSdkProviderConfigField =
	(typeof SUPPORTED_PROVIDER_CONFIG_FIELDS)[number];

export type FilesSdkProvider = Provider & {
	configFields: readonly FilesSdkProviderConfigField[];
};

export type FilesSdkBucketProvider = FilesSdkProvider;

export function getFilesSdkProvider(provider: string): FilesSdkProvider {
	const definition = getProvider(provider);
	if (!definition) {
		throw new Error(
			`Unknown Files SDK provider "${provider}". Supported providers: ${listFilesSdkProviders()
				.map(({ slug }) => slug)
				.join(", ")}`,
		);
	}
	return validateFilesSdkProvider(definition);
}

export function listFilesSdkProviders(): FilesSdkProvider[] {
	return PROVIDER_NAMES.flatMap((provider) => {
		const definition = getProvider(provider);
		if (!definition) return [];
		try {
			return [validateFilesSdkProvider(definition)];
		} catch {
			return [];
		}
	});
}

export function getFilesSdkBucketProvider(
	provider: string,
): FilesSdkBucketProvider {
	return validateBucketProvider(getFilesSdkProvider(provider));
}

export function listFilesSdkBucketProviders(): FilesSdkBucketProvider[] {
	return listFilesSdkProviders().flatMap((definition) => {
		try {
			return [validateBucketProvider(definition)];
		} catch {
			return [];
		}
	});
}

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
	const fileEnv = parseEnvFile(environment.envFilePath);
	return filesSdkConfigFromValues((name) => fileEnv[name]);
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
	if (!provider) {
		throw new Error("Files SDK object storage requires FILES_SDK_PROVIDER");
	}
	const bucket = nonEmpty(env("AGENTPOND_FILES_BUCKET"));
	const endpoint = nonEmpty(env("FILES_SDK_ENDPOINT"));
	const region = nonEmpty(env("FILES_SDK_REGION"));
	const root = nonEmpty(env("FILES_SDK_ROOT"));
	const config = {
		provider,
		...(bucket ? { bucket } : {}),
		...(endpoint ? { endpoint } : {}),
		...(region ? { region } : {}),
		...(root ? { root } : {}),
	};
	validateFilesSdkConfig(config);
	return config;
}

function validateFilesSdkConfig(config: FilesSdkObjectStoreConfig) {
	const definition = getFilesSdkProvider(config.provider);
	for (const field of definition.configFields) {
		if (!config[field]) {
			throw new Error(
				`Files SDK provider "${config.provider}" requires ${providerConfigEnvironmentVariable(field)}`,
			);
		}
	}
	return definition;
}

function validateFilesSdkProvider(definition: Provider): FilesSdkProvider {
	const configFields =
		PROVIDER_CONFIG_FIELD_OVERRIDES[definition.slug] ??
		definition.env.config ??
		[];
	if (NON_PERSISTENT_PROVIDERS.has(definition.slug)) {
		throw new Error(
			`Files SDK provider "${definition.slug}" is not persistent and is not supported by AgentPond`,
		);
	}
	if (UNSUPPORTED_NODE_PROVIDERS.has(definition.slug)) {
		throw new Error(
			`Files SDK provider "${definition.slug}" is not supported by AgentPond's Node.js runtime`,
		);
	}
	for (const field of configFields) {
		if (!SUPPORTED_PROVIDER_CONFIG_FIELD_SET.has(field)) {
			throw new Error(
				`Files SDK provider "${definition.slug}" requires unsupported configuration field "${field}"`,
			);
		}
	}
	return {
		...definition,
		configFields: configFields as readonly FilesSdkProviderConfigField[],
	};
}

function validateBucketProvider(
	definition: FilesSdkProvider,
): FilesSdkBucketProvider {
	if (!definition.configFields.includes("bucket")) {
		throw new Error(
			`Files SDK provider "${definition.slug}" is not bucket-backed and is not supported by this API`,
		);
	}
	return definition;
}

function providerConfigEnvironmentVariable(
	field: FilesSdkProviderConfigField,
): string {
	switch (field) {
		case "bucket":
			return "AGENTPOND_FILES_BUCKET";
		case "endpoint":
			return "FILES_SDK_ENDPOINT";
		case "region":
			return "FILES_SDK_REGION";
		case "root":
			return "FILES_SDK_ROOT";
	}
}

async function loadConfiguredFiles(
	config: FilesSdkObjectStoreConfig,
): Promise<FilesClient> {
	const { files } = await loadFiles({
		provider: config.provider,
		...(config.bucket ? { bucket: config.bucket } : {}),
		...(config.endpoint ? { endpoint: config.endpoint } : {}),
		...(config.region ? { region: config.region } : {}),
		...(config.root ? { root: config.root } : {}),
		retries: DEFAULT_RETRIES,
		timeout: DEFAULT_TIMEOUT_MS,
	});
	return files;
}
