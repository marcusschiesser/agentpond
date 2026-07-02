import assert from "node:assert/strict";
import test from "node:test";
import {
	type AuthConfig,
	eventTypes,
	sinkFromStore,
} from "@agentpond/core";
import {
	VercelBlobObjectStore,
	type VercelBlobClient,
	vercelBlobConfigFromRuntimeEnv,
} from "@agentpond/vercel";

const auth: AuthConfig = {
	projectId: "project-a",
	publicKey: "pk",
	secretKey: "sk",
};

test("Vercel Blob config reads provider settings from runtime env", () => {
	const originalEnv = saveEnv(VERCEL_ENV_KEYS);

	try {
		clearEnv(VERCEL_ENV_KEYS);

		assert.deepEqual(vercelBlobConfigFromRuntimeEnv(), {
			access: "private",
			token: undefined,
			storeId: undefined,
			oidcToken: undefined,
		});

		process.env.AGENTPOND_BLOB_ACCESS = "public";
		process.env.BLOB_READ_WRITE_TOKEN = "rw-token";
		process.env.BLOB_STORE_ID = "store_123";
		process.env.VERCEL_OIDC_TOKEN = "oidc-token";

		assert.deepEqual(vercelBlobConfigFromRuntimeEnv(), {
			access: "public",
			token: "rw-token",
			storeId: "store_123",
			oidcToken: "oidc-token",
		});
	} finally {
		restoreEnv(originalEnv);
	}
});

test("Vercel Blob config rejects invalid access settings", () => {
	const originalEnv = saveEnv(VERCEL_ENV_KEYS);

	try {
		clearEnv(VERCEL_ENV_KEYS);
		process.env.AGENTPOND_BLOB_ACCESS = "shared";

		assert.throws(
			() => vercelBlobConfigFromRuntimeEnv(),
			/AGENTPOND_BLOB_ACCESS must be "private" or "public"/,
		);
	} finally {
		restoreEnv(originalEnv);
	}
});

test("Vercel Blob object store writes, reads, and lists JSON objects", async () => {
	const objects = new Map<string, string>();
	const putOptions: unknown[] = [];
	const listOptions: unknown[] = [];
	const store = new VercelBlobObjectStore(
		{
			access: "private",
			token: "rw-token",
			storeId: "store_123",
			oidcToken: "oidc-token",
		},
		createMockBlobClient(objects, putOptions, listOptions),
	);

	await store.putJson("project-a/trace/trace-2/event.json", { ok: 2 });
	await store.putJson("project-a/trace/trace-1/event.json", { ok: true });

	assert.deepEqual(putOptions[0], {
		access: "private",
		allowOverwrite: true,
		contentType: "application/json",
		token: "rw-token",
		storeId: "store_123",
		oidcToken: "oidc-token",
	});
	assert.deepEqual(await store.getJson("project-a/trace/trace-1/event.json"), {
		ok: true,
	});
	assert.deepEqual(await store.listKeys("project-a/trace/"), [
		"project-a/trace/trace-1/event.json",
		"project-a/trace/trace-2/event.json",
	]);
	assert.equal(listOptions.length, 2);
	assert.deepEqual(listOptions[0], {
		prefix: "project-a/trace/",
		cursor: undefined,
		mode: "expanded",
		token: "rw-token",
		storeId: "store_123",
		oidcToken: "oidc-token",
	});
	assert.deepEqual(listOptions[1], {
		prefix: "project-a/trace/",
		cursor: "next-page",
		mode: "expanded",
		token: "rw-token",
		storeId: "store_123",
		oidcToken: "oidc-token",
	});
});

test("Vercel Blob object store reports missing or empty objects", async () => {
	const objects = new Map<string, string>();
	const store = new VercelBlobObjectStore(
		{ access: "private" },
		createMockBlobClient(objects),
	);

	await assert.rejects(
		() => store.getJson("missing.json"),
		/Vercel Blob object not found: missing\.json/,
	);

	objects.set("empty.json", "");
	await assert.rejects(
		() => store.getJson("empty.json"),
		/Vercel Blob object is empty: empty\.json/,
	);
});

test("Vercel Blob object store creates sink with runtime prefix", async () => {
	const objects = new Map<string, string>();
	const store = new VercelBlobObjectStore(
		{ access: "private" },
		createMockBlobClient(objects),
	);

	await store.toSink({ prefix: "prod" }).writeEvents({
		projectId: auth.projectId,
		events: [
			{
				id: "event-vercel-sink-1",
				timestamp: "2026-06-14T00:00:00.000Z",
				type: eventTypes.TRACE_CREATE,
				body: { id: "trace-vercel-sink-1" },
			},
		],
	});

	assert.equal((await store.listKeys("prod/project-a/")).length > 0, true);
});

test("Vercel Blob object store can be used as a generic ingestion sink", async () => {
	const objects = new Map<string, string>();
	const store = new VercelBlobObjectStore(
		{ access: "private" },
		createMockBlobClient(objects),
	);

	await sinkFromStore(store).writeEvents({
		projectId: auth.projectId,
		events: [
			{
				id: "event-vercel-generic-1",
				timestamp: "2026-06-14T00:00:00.000Z",
				type: eventTypes.TRACE_CREATE,
				body: { id: "trace-vercel-generic-1" },
			},
		],
	});

	assert.equal((await store.listKeys("project-a/")).length > 0, true);
});

function createMockBlobClient(
	objects: Map<string, string>,
	putOptions: unknown[] = [],
	listOptions: unknown[] = [],
): VercelBlobClient {
	return {
		put: async (pathname, body, options) => {
			putOptions.push(options);
			objects.set(pathname, body);
			return { pathname };
		},
		get: async (pathname) => {
			if (!objects.has(pathname)) return null;
			return {
				statusCode: 200,
				stream: streamFromString(objects.get(pathname) ?? ""),
			};
		},
		list: async (options) => {
			listOptions.push(options);
			const keys = [...objects.keys()]
				.filter((key) => key.startsWith(options.prefix))
				.sort();
			const pageSize = 1;
			const start = options.cursor === "next-page" ? 1 : 0;
			const page = keys.slice(start, start + pageSize);
			const next = start + pageSize;
			return {
				blobs: page.map((pathname) => ({ pathname })),
				cursor: next < keys.length ? "next-page" : undefined,
				hasMore: next < keys.length,
			};
		},
	};
}

function streamFromString(value: string): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(value));
			controller.close();
		},
	});
}

const VERCEL_ENV_KEYS = [
	"AGENTPOND_BLOB_ACCESS",
	"BLOB_READ_WRITE_TOKEN",
	"BLOB_STORE_ID",
	"VERCEL_OIDC_TOKEN",
] as const;

type VercelEnvKey = (typeof VERCEL_ENV_KEYS)[number];
type EnvSnapshot = Map<VercelEnvKey, string | undefined>;

function saveEnv(keys: readonly VercelEnvKey[]): EnvSnapshot {
	return new Map(keys.map((key) => [key, process.env[key]]));
}

function clearEnv(keys: readonly VercelEnvKey[]): void {
	for (const key of keys) {
		delete process.env[key];
	}
}

function restoreEnv(snapshot: EnvSnapshot): void {
	for (const [key, value] of snapshot) {
		if (value === undefined) {
			delete process.env[key];
			continue;
		}
		process.env[key] = value;
	}
}
