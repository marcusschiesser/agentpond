import {
	type IngestionSink,
	nonEmpty,
	normalizePrefix,
	type ObjectStore,
	type ObjectStoreIngestionSinkOptions,
	sinkFromStore,
} from "@agentpond/core";
import { get, list, put } from "@vercel/blob";

export type VercelBlobAccess = "private" | "public";

export type VercelBlobConfig = {
	access: VercelBlobAccess;
	token?: string;
	storeId?: string;
	oidcToken?: string;
};

type BlobAuthOptions = {
	token?: string;
	storeId?: string;
	oidcToken?: string;
};

type BlobPutOptions = BlobAuthOptions & {
	access: VercelBlobAccess;
	allowOverwrite: true;
	contentType: "application/json";
};

type BlobGetOptions = BlobAuthOptions & {
	access: VercelBlobAccess;
};

type BlobListOptions = BlobAuthOptions & {
	prefix: string;
	cursor?: string;
	mode: "expanded";
};

type BlobGetResult = {
	statusCode: number;
	stream: ReadableStream<Uint8Array> | null;
};

type BlobListResult = {
	blobs: Array<{ pathname: string }>;
	cursor?: string;
	hasMore: boolean;
};

export type VercelBlobClient = {
	put(
		pathname: string,
		body: string,
		options: BlobPutOptions,
	): Promise<unknown>;
	get(pathname: string, options: BlobGetOptions): Promise<BlobGetResult | null>;
	list(options: BlobListOptions): Promise<BlobListResult>;
};

const defaultBlobClient: VercelBlobClient = {
	put,
	get,
	list,
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
	const config = vercelBlobConfigFromEnv(process.env);
	return {
		access: config.access,
		token: config.token,
		storeId: config.storeId,
	};
}

export class VercelBlobObjectStore implements ObjectStore {
	static fromRuntimeEnv(): VercelBlobObjectStore {
		return new VercelBlobObjectStore(vercelBlobConfigFromRuntimeEnv());
	}

	static fromConfig(config: VercelBlobConfig): VercelBlobObjectStore {
		return new VercelBlobObjectStore(config);
	}

	constructor(
		readonly config: VercelBlobConfig,
		private readonly client: VercelBlobClient = defaultBlobClient,
	) {}

	toSink(options: ObjectStoreIngestionSinkOptions = {}): IngestionSink {
		return sinkFromStore(this, {
			prefix:
				options.prefix ?? normalizePrefix(process.env.AGENTPOND_PREFIX ?? ""),
		});
	}

	async putJson(key: string, value: unknown): Promise<void> {
		await this.client.put(key, JSON.stringify(value), {
			access: this.config.access,
			allowOverwrite: true,
			contentType: "application/json",
			...this.authOptions(),
		});
	}

	async getJson<T>(key: string): Promise<T> {
		const response = await this.client.get(key, {
			access: this.config.access,
			...this.authOptions(),
		});
		if (!response) throw new Error(`Vercel Blob object not found: ${key}`);
		if (response.statusCode !== 200 || !response.stream) {
			throw new Error(
				`Vercel Blob object read failed for ${key}: ${response.statusCode}`,
			);
		}
		const body = await new Response(response.stream).text();
		if (!body) throw new Error(`Vercel Blob object is empty: ${key}`);
		return JSON.parse(body) as T;
	}

	async listKeys(prefix: string): Promise<string[]> {
		const keys: string[] = [];
		let cursor: string | undefined;
		do {
			const response = await this.client.list({
				prefix,
				cursor,
				mode: "expanded",
				...this.authOptions(),
			});
			for (const blob of response.blobs) {
				keys.push(blob.pathname);
			}
			cursor = response.hasMore ? response.cursor : undefined;
		} while (cursor);
		return keys.sort();
	}

	private authOptions(): BlobAuthOptions {
		return {
			token: this.config.token,
			storeId: this.config.storeId,
			oidcToken: this.config.oidcToken,
		};
	}
}

function accessFromEnv(value: string | undefined): VercelBlobAccess {
	const access = nonEmpty(value) ?? "private";
	if (access === "private" || access === "public") return access;
	throw new Error(
		`AGENTPOND_BLOB_ACCESS must be "private" or "public", got "${access}"`,
	);
}
