import {
	type AgentPondContentPolicy,
	AgentPondSpanExporter,
} from "@agentpond/otel";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
	supabaseProjectRefFromUrl,
	validateSupabaseProjectRef,
} from "./supabase-project.js";
import {
	defaultSupabaseStorageBucket,
	defaultSupabaseStoragePrefix,
	type SupabaseEnvironment,
	SupabaseStorageObjectStore,
	supabaseRuntimeEnvironment,
	supabaseStorageConfigFromEnv,
} from "./supabase-storage.js";

export type SupabaseSpanExporterOptions = {
	bucket?: string;
	client?: SupabaseClient;
	contentPolicy?: AgentPondContentPolicy;
	env?: SupabaseEnvironment;
	prefix?: string;
	projectId?: string;
	secretKey?: string;
	url?: string;
};

export function createSupabaseSpanExporter(
	options: SupabaseSpanExporterOptions = {},
): AgentPondSpanExporter {
	if (options.client) {
		const projectId = options.projectId
			? validateSupabaseProjectRef(options.projectId)
			: supabaseProjectRefFromUrl(supabaseClientUrl(options.client));
		const store = SupabaseStorageObjectStore.fromClient(options.client, {
			bucket: options.bucket ?? defaultSupabaseStorageBucket,
			prefix: options.prefix ?? defaultSupabaseStoragePrefix,
		});
		return new AgentPondSpanExporter({
			contentPolicy: options.contentPolicy,
			store,
			projectId,
		});
	}

	const env =
		options.env ??
		(options.url && options.secretKey ? {} : supabaseRuntimeEnvironment());
	const storageConfig = supabaseStorageConfigFromEnv(
		{
			...env,
			...(options.url ? { SUPABASE_URL: options.url } : {}),
			...(options.secretKey ? { SUPABASE_SECRET_KEY: options.secretKey } : {}),
		},
		{
			bucket: options.bucket ?? defaultSupabaseStorageBucket,
			prefix: options.prefix ?? defaultSupabaseStoragePrefix,
		},
	);
	const projectId = options.projectId
		? validateSupabaseProjectRef(options.projectId)
		: supabaseProjectRefFromUrl(storageConfig.url);
	const store = SupabaseStorageObjectStore.fromConfig(storageConfig);

	return new AgentPondSpanExporter({
		contentPolicy: options.contentPolicy,
		store,
		projectId,
	});
}

function supabaseClientUrl(client: SupabaseClient): string {
	const url = (client as unknown as { supabaseUrl?: unknown }).supabaseUrl;
	if (typeof url !== "string") {
		throw new Error(
			"createSupabaseSpanExporter() requires an explicit projectId when the Supabase client URL is unavailable",
		);
	}
	return url;
}
