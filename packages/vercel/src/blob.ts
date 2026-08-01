import { nonEmpty } from "@agentpond/core";
import {
	defaultFilesClientOptions,
	type FilesClientOptions,
	FilesObjectStore,
} from "@agentpond/files-sdk";
import { Files } from "files-sdk";
import {
	type VercelBlobAdapterOptions,
	vercelBlob,
} from "files-sdk/vercel-blob";

export type VercelBlobAccess = "private" | "public";

export type VercelBlobConfig = {
	access: VercelBlobAccess;
	token?: string;
	storeId?: string;
	oidcToken?: string;
};

export function vercelBlobConfigFromEnv(
	env: NodeJS.ProcessEnv,
): VercelBlobConfig {
	return {
		access: accessFromEnv(env.AGENTPOND_BLOB_ACCESS),
		token: nonEmpty(env.BLOB_READ_WRITE_TOKEN),
		storeId: nonEmpty(env.BLOB_STORE_ID),
		oidcToken: nonEmpty(env.VERCEL_OIDC_TOKEN),
	};
}

export function vercelBlobConfigFromRuntimeEnv(): VercelBlobConfig {
	return {
		access: accessFromEnv(process.env.AGENTPOND_BLOB_ACCESS),
	};
}

export function createVercelBlobStore(
	config: VercelBlobConfig,
	options: FilesClientOptions = {},
): FilesObjectStore {
	return FilesObjectStore.fromFiles(
		new Files({
			adapter: vercelBlob(vercelBlobAdapterOptions(config)),
			retries: options.retries ?? defaultFilesClientOptions.retries,
			timeout: options.timeout ?? defaultFilesClientOptions.timeout,
		}),
	);
}

export function vercelBlobAdapterOptions(
	config: VercelBlobConfig,
): VercelBlobAdapterOptions {
	return {
		access: config.access,
		addRandomSuffix: false,
		allowOverwrite: true,
		token: config.token,
		storeId: config.storeId,
		oidcToken: config.oidcToken,
	};
}

function accessFromEnv(value: string | undefined): VercelBlobAccess {
	const access = nonEmpty(value) ?? "private";
	if (access === "private" || access === "public") return access;
	throw new Error(
		`AGENTPOND_BLOB_ACCESS must be "private" or "public", got "${access}"`,
	);
}
