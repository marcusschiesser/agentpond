import {
	type IngestionSink,
	nonEmpty,
	normalizePrefix,
	type ObjectStore,
	type ObjectStoreIngestionSinkOptions,
	sinkFromStore,
} from "@agentpond/core";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
	SupabaseCliProjectConfig,
	SupabaseProcessRunner,
} from "./supabase-project.js";
import {
	supabaseHostedUrl,
	supabaseSecretKeyForProject,
} from "./supabase-project.js";

export const defaultSupabaseStorageBucket = "agentpond";
export const defaultSupabaseStoragePrefix = "";

export type SupabaseEnvironment = Record<string, string | undefined>;

export type SupabaseStorageObjectStoreConfig = {
	url: string;
	secretKey: string;
	bucket?: string;
	prefix?: string;
};

export type SupabaseStorageRuntimeOptions = {
	bucket?: string;
	env?: SupabaseEnvironment;
	prefix?: string;
};

export type SupabaseStorageClientOptions = {
	bucket?: string;
	prefix?: string;
};

export type SupabaseStorageConfig = {
	bucket: string;
	prefix: string;
};

type StorageError = {
	message?: string;
	status?: number;
	statusCode?: number | string;
};

type StorageResult<T> = Promise<{
	data: T | null;
	error: StorageError | null;
}>;

type StorageEntry = {
	id?: string | null;
	metadata?: unknown;
	name: string;
};

type StorageBucketApi = {
	upload(
		path: string,
		body: string,
		options: {
			cacheControl: string;
			contentType: string;
			upsert: boolean;
		},
	): StorageResult<unknown>;
	download(path: string): StorageResult<Blob>;
	list(
		path: string,
		options: {
			limit: number;
			offset: number;
			sortBy: { column: "name"; order: "asc" };
		},
	): StorageResult<StorageEntry[]>;
};

type SupabaseStorageApi = {
	getBucket(id: string): StorageResult<{ public: boolean }>;
	from(id: string): StorageBucketApi;
};

export function supabaseStorageConfigFromEnv(
	env: SupabaseEnvironment,
	options: Pick<SupabaseStorageObjectStoreConfig, "bucket" | "prefix"> = {},
): SupabaseStorageObjectStoreConfig {
	const url = nonEmpty(env.SUPABASE_URL);
	if (!url) {
		throw new Error(
			"Supabase storage requires SUPABASE_URL or an explicit url",
		);
	}

	const secretKey = supabaseSecretKeyFromEnv(env);
	return {
		url: validatedSupabaseUrl(url),
		secretKey,
		bucket: options.bucket ?? defaultSupabaseStorageBucket,
		prefix: options.prefix ?? defaultSupabaseStoragePrefix,
	};
}

export function supabaseSecretKeyFromEnv(env: SupabaseEnvironment): string {
	const direct = nonEmpty(env.SUPABASE_SECRET_KEY);
	if (direct) return validateSupabaseSecretKey(direct);

	const dictionary = nonEmpty(env.SUPABASE_SECRET_KEYS);
	if (dictionary) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(dictionary);
		} catch {
			throw new Error("SUPABASE_SECRET_KEYS must contain a JSON object");
		}
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("SUPABASE_SECRET_KEYS must contain a JSON object");
		}
		const value = (parsed as Record<string, unknown>).default;
		if (value !== undefined && (typeof value !== "string" || !value)) {
			throw new Error(
				"SUPABASE_SECRET_KEYS.default must be a non-empty string",
			);
		}
		if (typeof value === "string" && value) {
			return validateSupabaseSecretKey(value);
		}
	}

	const legacy = nonEmpty(env.SUPABASE_SERVICE_ROLE_KEY);
	if (legacy) return validateSupabaseSecretKey(legacy);
	throw new Error(
		"Supabase storage requires SUPABASE_SECRET_KEY, SUPABASE_SECRET_KEYS.default, or SUPABASE_SERVICE_ROLE_KEY",
	);
}

export function validateSupabaseSecretKey(secretKey: string): string {
	if (
		secretKey.includes("*") ||
		secretKey.includes("·") ||
		secretKey.includes("•") ||
		secretKey.startsWith("sb_publishable_") ||
		secretKey.startsWith("anon")
	) {
		throw invalidSupabaseCredentialError();
	}
	if (secretKey.startsWith("sb_secret_") && secretKey.length > 10) {
		return secretKey;
	}
	if (legacyJwtRole(secretKey) === "service_role") return secretKey;
	throw invalidSupabaseCredentialError();
}

export class SupabaseStorageObjectStore implements ObjectStore {
	private bucketValidation?: Promise<void>;

	static fromConfig(
		options: SupabaseStorageObjectStoreConfig,
	): SupabaseStorageObjectStore {
		const url = validatedSupabaseUrl(options.url);
		const secretKey = validateSupabaseSecretKey(options.secretKey);
		const client = createClient(url, secretKey, {
			auth: {
				autoRefreshToken: false,
				detectSessionInUrl: false,
				persistSession: false,
			},
		});
		return SupabaseStorageObjectStore.fromClient(client, options);
	}

	static fromRuntimeEnv(
		options: SupabaseStorageRuntimeOptions = {},
	): SupabaseStorageObjectStore {
		return SupabaseStorageObjectStore.fromConfig(
			supabaseStorageConfigFromEnv(
				options.env ?? supabaseRuntimeEnvironment(),
				options,
			),
		);
	}

	static fromClient(
		client: SupabaseClient,
		options: SupabaseStorageClientOptions = {},
	): SupabaseStorageObjectStore {
		const key = (client as unknown as { supabaseKey?: unknown }).supabaseKey;
		if (typeof key !== "string") {
			throw new Error(
				"SupabaseStorageObjectStore.fromClient() requires a client initialized with a Supabase secret or service-role key",
			);
		}
		validateSupabaseSecretKey(key);
		return new SupabaseStorageObjectStore(
			{
				bucket: options.bucket ?? defaultSupabaseStorageBucket,
				prefix: options.prefix ?? defaultSupabaseStoragePrefix,
			},
			client.storage as unknown as SupabaseStorageApi,
		);
	}

	static async fromCliProject(
		project: SupabaseCliProjectConfig,
		dependencies: { run?: SupabaseProcessRunner } = {},
	): Promise<SupabaseStorageObjectStore> {
		const secretKey = await supabaseSecretKeyForProject(project, dependencies);
		return SupabaseStorageObjectStore.fromConfig({
			url: supabaseHostedUrl(project.projectRef),
			secretKey,
		});
	}

	private constructor(
		readonly config: SupabaseStorageConfig,
		private readonly storage: SupabaseStorageApi,
	) {}

	toSink(options: ObjectStoreIngestionSinkOptions = {}): IngestionSink {
		return sinkFromStore(this, {
			prefix: normalizePrefix(options.prefix ?? this.config.prefix),
		});
	}

	async putJson(key: string, value: unknown): Promise<void> {
		await this.ensurePrivateBucket();
		const { error } = await this.storage
			.from(this.config.bucket)
			.upload(key, JSON.stringify(value), {
				cacheControl: "0",
				contentType: "application/json",
				upsert: true,
			});
		if (error) {
			throw new Error(
				`Could not upload Supabase Storage object ${key}: ${storageErrorDetail(error)}`,
			);
		}
	}

	async getJson<T>(key: string): Promise<T> {
		await this.ensurePrivateBucket();
		const { data, error } = await this.storage
			.from(this.config.bucket)
			.download(key);
		if (error || !data) {
			throw new Error(
				`Could not download Supabase Storage object ${key}: ${storageErrorDetail(error)}`,
			);
		}
		const body = await data.text();
		if (!body) throw new Error(`Supabase Storage object is empty: ${key}`);
		try {
			return JSON.parse(body) as T;
		} catch {
			throw new Error(`Supabase Storage object is not valid JSON: ${key}`);
		}
	}

	async listKeys(prefix: string): Promise<string[]> {
		await this.ensurePrivateBucket();
		const initialDirectory = listingDirectoryForPrefix(prefix);
		const keys = new Set<string>();
		await this.listDirectory(initialDirectory, prefix, keys, new Set());
		return [...keys].sort();
	}

	private async ensurePrivateBucket(): Promise<void> {
		this.bucketValidation ??= this.validatePrivateBucket();
		await this.bucketValidation;
	}

	private async validatePrivateBucket(): Promise<void> {
		const { data, error } = await this.storage.getBucket(this.config.bucket);
		if (error || !data) {
			if (isMissingStorageResource(error)) {
				throw new Error(
					`Supabase Storage bucket "${this.config.bucket}" does not exist`,
				);
			}
			throw new Error(
				`Could not inspect Supabase Storage bucket "${this.config.bucket}": ${storageErrorDetail(error)}`,
			);
		}
		if (data.public) {
			throw new Error(
				`Supabase Storage bucket "${this.config.bucket}" must be private`,
			);
		}
	}

	private async listDirectory(
		directory: string,
		prefix: string,
		keys: Set<string>,
		visited: Set<string>,
	): Promise<void> {
		if (visited.has(directory)) return;
		visited.add(directory);
		const entries: StorageEntry[] = [];
		const limit = 100;
		let offset = 0;
		while (true) {
			const { data, error } = await this.storage
				.from(this.config.bucket)
				.list(directory, {
					limit,
					offset,
					sortBy: { column: "name", order: "asc" },
				});
			if (error || !data) {
				throw new Error(
					`Could not list Supabase Storage path ${directory || "/"}: ${storageErrorDetail(error)}`,
				);
			}
			entries.push(...data);
			if (data.length < limit) break;
			offset += data.length;
		}

		for (const entry of entries.sort((left, right) =>
			left.name.localeCompare(right.name),
		)) {
			const key = directory ? `${directory}/${entry.name}` : entry.name;
			if (isStorageDirectory(entry)) {
				if (key.startsWith(prefix) || prefix.startsWith(`${key}/`)) {
					await this.listDirectory(key, prefix, keys, visited);
				}
				continue;
			}
			if (key.startsWith(prefix)) keys.add(key);
		}
	}
}

export function supabaseRuntimeEnvironment(): SupabaseEnvironment {
	const names = [
		"SUPABASE_URL",
		"SUPABASE_SECRET_KEY",
		"SUPABASE_SECRET_KEYS",
		"SUPABASE_SERVICE_ROLE_KEY",
	] as const;
	const env: SupabaseEnvironment = {};
	if (typeof process !== "undefined") {
		for (const name of names) env[name] = process.env[name];
	}
	const deno = (
		globalThis as {
			Deno?: { env?: { get(name: string): string | undefined } };
		}
	).Deno;
	if (deno?.env) {
		for (const name of names) env[name] ??= deno.env.get(name);
	}
	return env;
}

function validatedSupabaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("Supabase url must be a valid absolute URL");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("Supabase url must use http or https");
	}
	return url.toString().replace(/\/$/, "");
}

function legacyJwtRole(value: string): string | undefined {
	const payload = value.split(".")[1];
	if (!payload) return undefined;
	try {
		const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
		const padded = normalized.padEnd(
			normalized.length + ((4 - (normalized.length % 4)) % 4),
			"=",
		);
		const parsed = JSON.parse(atob(padded)) as { role?: unknown };
		return typeof parsed.role === "string" ? parsed.role : undefined;
	} catch {
		return undefined;
	}
}

function invalidSupabaseCredentialError(): Error {
	return new Error(
		"Supabase storage requires a secret key or legacy service-role key; publishable and anonymous keys are not allowed",
	);
}

function listingDirectoryForPrefix(prefix: string): string {
	const trimmed = prefix.replace(/^\/+|\/+$/g, "");
	if (!trimmed) return "";
	if (prefix.endsWith("/")) return trimmed;
	const separator = trimmed.lastIndexOf("/");
	return separator === -1 ? "" : trimmed.slice(0, separator);
}

function isStorageDirectory(entry: StorageEntry): boolean {
	return entry.id == null && entry.metadata == null;
}

function isMissingStorageResource(error: StorageError | null): boolean {
	if (!error) return true;
	const status = error.statusCode ?? error.status;
	return (
		status === 404 ||
		status === "404" ||
		/not found|does not exist/i.test(error.message ?? "")
	);
}

function storageErrorDetail(error: StorageError | null): string {
	return error?.message?.trim() || "unknown storage error";
}
