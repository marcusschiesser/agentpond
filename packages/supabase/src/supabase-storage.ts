import { nonEmpty, type ObjectStore } from "@agentpond/core";
import {
	defaultFilesClientOptions,
	type FilesClientOptions,
	FilesObjectStore,
} from "@agentpond/files-sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Files } from "files-sdk";
import { supabase } from "files-sdk/supabase";
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

export type SupabaseStorageObjectStoreConfig = FilesClientOptions & {
	url: string;
	secretKey: string;
	bucket?: string;
	prefix?: string;
};

export type SupabaseStorageRuntimeOptions = FilesClientOptions & {
	bucket?: string;
	env?: SupabaseEnvironment;
	prefix?: string;
};

export type SupabaseStorageClientOptions = FilesClientOptions & {
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

type SupabaseStorageApi = {
	getBucket(id: string): Promise<{
		data: { public: boolean } | null;
		error: StorageError | null;
	}>;
};

export function supabaseStorageConfigFromEnv(
	env: SupabaseEnvironment,
	options: Pick<
		SupabaseStorageObjectStoreConfig,
		"bucket" | "prefix" | "retries" | "timeout"
	> = {},
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
		...(options.retries !== undefined ? { retries: options.retries } : {}),
		...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
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

export function createSupabaseStorageStoreFromConfig(
	options: SupabaseStorageObjectStoreConfig,
): FilesObjectStore {
	const url = validatedSupabaseUrl(options.url);
	const secretKey = validateSupabaseSecretKey(options.secretKey);
	const client = createClient(url, secretKey, {
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false,
		},
	});
	return createSupabaseStorageStoreFromClient(client, options);
}

export function createSupabaseStorageStoreFromRuntimeEnv(
	options: SupabaseStorageRuntimeOptions = {},
): FilesObjectStore {
	return createSupabaseStorageStoreFromConfig(
		supabaseStorageConfigFromEnv(
			options.env ?? supabaseRuntimeEnvironment(),
			options,
		),
	);
}

export function createSupabaseStorageStoreFromClient(
	client: SupabaseClient,
	options: SupabaseStorageClientOptions = {},
): FilesObjectStore {
	const key = (client as unknown as { supabaseKey?: unknown }).supabaseKey;
	if (typeof key !== "string") {
		throw new Error(
			"Supabase storage requires a client initialized with a Supabase secret or service-role key",
		);
	}
	validateSupabaseSecretKey(key);
	const bucket = options.bucket ?? defaultSupabaseStorageBucket;
	return FilesObjectStore.fromFiles(
		new Files({
			adapter: supabase({
				bucket,
				client,
			}),
			retries: options.retries ?? defaultFilesClientOptions.retries,
			timeout: options.timeout ?? defaultFilesClientOptions.timeout,
		}),
		{
			beforeFirstOperation: () =>
				validatePrivateBucket(
					client.storage as unknown as SupabaseStorageApi,
					bucket,
				),
		},
	);
}

export async function createSupabaseStorageStoreFromCliProject(
	project: SupabaseCliProjectConfig,
	dependencies: {
		run?: SupabaseProcessRunner;
		createStore?: (config: SupabaseStorageObjectStoreConfig) => ObjectStore;
	} = {},
): Promise<ObjectStore> {
	const secretKey = await supabaseSecretKeyForProject(project, dependencies);
	return (dependencies.createStore ?? createSupabaseStorageStoreFromConfig)({
		url: supabaseHostedUrl(project.projectRef),
		secretKey,
	});
}

async function validatePrivateBucket(
	storage: SupabaseStorageApi,
	bucket: string,
): Promise<void> {
	const { data, error } = await storage.getBucket(bucket);
	if (error || !data) {
		if (isMissingStorageResource(error)) {
			throw new Error(`Supabase Storage bucket "${bucket}" does not exist`);
		}
		throw new Error(
			`Could not inspect Supabase Storage bucket "${bucket}": ${storageErrorDetail(error)}`,
		);
	}
	if (data.public) {
		throw new Error(`Supabase Storage bucket "${bucket}" must be private`);
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
