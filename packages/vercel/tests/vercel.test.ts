import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { type AuthConfig, eventTypes, sinkFromStore } from "@agentpond/core";
import { AgentPondSpanExporter } from "@agentpond/otel";
import {
	createVercelSpanExporter,
	selectVercelEnvironment,
	type VercelBlobClient,
	VercelBlobObjectStore,
	type VercelProcessRunner,
	vercelAgentPondProjectId,
	vercelBlobConfigFromEnv,
	vercelBlobConfigFromRuntimeEnv,
	vercelCliProjectConfigFromCwd,
	vercelEnvironmentContextFromCwdIfAvailable,
	vercelProjectCandidateDirectory,
	vercelProvider,
} from "@agentpond/vercel";

const auth: AuthConfig = {
	projectId: "project-a",
	publicKey: "pk",
	secretKey: "sk",
};

test("Vercel Blob runtime config leaves OIDC resolution to the SDK", () => {
	const originalEnv = saveEnv(VERCEL_ENV_KEYS);

	try {
		clearEnv(VERCEL_ENV_KEYS);

		assert.deepEqual(vercelBlobConfigFromRuntimeEnv(), {
			access: "private",
			token: undefined,
			storeId: undefined,
		});

		process.env.AGENTPOND_BLOB_ACCESS = "public";
		process.env.BLOB_READ_WRITE_TOKEN = "rw-token";
		process.env.BLOB_STORE_ID = "store_123";
		process.env.VERCEL_OIDC_TOKEN = "oidc-token";

		assert.deepEqual(vercelBlobConfigFromRuntimeEnv(), {
			access: "public",
			token: "rw-token",
			storeId: "store_123",
		});
		assert.deepEqual(vercelBlobConfigFromEnv(process.env), {
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

test("Vercel span exporter scopes projects by project and target", () => {
	const originalEnv = saveEnv(VERCEL_ENV_KEYS);
	try {
		clearEnv(VERCEL_ENV_KEYS);
		process.env.VERCEL_PROJECT_ID = "prj_demo";
		process.env.VERCEL_TARGET_ENV = "staging";

		assert.equal(
			vercelAgentPondProjectId("prj_demo", "staging"),
			"prj_demo-staging",
		);
		assert.ok(createVercelSpanExporter() instanceof AgentPondSpanExporter);
		assert.throws(
			() => vercelAgentPondProjectId("prj_demo", "feature/unsafe"),
			/Invalid Vercel environment/,
		);
	} finally {
		restoreEnv(originalEnv);
	}
});

test("Vercel span exporter requires project and target identifiers", () => {
	const originalEnv = saveEnv(VERCEL_ENV_KEYS);
	try {
		clearEnv(VERCEL_ENV_KEYS);
		assert.throws(() => createVercelSpanExporter(), /VERCEL_PROJECT_ID/);
		process.env.VERCEL_PROJECT_ID = "prj_demo";
		assert.throws(() => createVercelSpanExporter(), /VERCEL_TARGET_ENV/);
	} finally {
		restoreEnv(originalEnv);
	}
});

test("Vercel span exporter rejects public Blob access", () => {
	const originalEnv = saveEnv(VERCEL_ENV_KEYS);
	try {
		clearEnv(VERCEL_ENV_KEYS);
		process.env.AGENTPOND_BLOB_ACCESS = "public";
		process.env.VERCEL_PROJECT_ID = "prj_demo";
		process.env.VERCEL_TARGET_ENV = "production";

		assert.throws(
			() => createVercelSpanExporter(),
			/private Vercel Blob store/,
		);
	} finally {
		restoreEnv(originalEnv);
	}
});

test("Vercel project config resolves linked projects and config candidates", () => {
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-vercel-project-")),
	);
	const nested = join(root, "apps", "web");
	mkdirSync(join(root, ".vercel"), { recursive: true });
	mkdirSync(nested, { recursive: true });
	writeFileSync(
		join(root, ".vercel", "project.json"),
		JSON.stringify({
			orgId: "team_demo",
			projectId: "prj_demo",
			projectName: "demo",
		}),
		"utf8",
	);

	assert.equal(vercelProjectCandidateDirectory(nested), root);
	assert.deepEqual(vercelCliProjectConfigFromCwd(nested), {
		orgId: "team_demo",
		projectId: "prj_demo",
		projectName: "demo",
		root,
	});
	const project = vercelProvider.openProject({ cwd: nested });
	assert.ok(project);
	assert.equal(vercelProvider.kind, "vercel");
	assert.equal(vercelProvider.displayName, "Vercel");
	assert.match(
		vercelProvider.instrumentationPrompt,
		/createVercelSpanExporter/,
	);
	assert.equal(project.projectLabel, "demo");
	assert.equal(project.rootDir, root);
	assert.equal(
		project.resolveEnvironment("staging").config.environment?.name,
		"staging",
	);
});

test("Vercel environment context resolves one target without pre-listing targets", async () => {
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-vercel-context-")),
	);
	const pulledFiles: string[] = [];
	const run: VercelProcessRunner = async ({ args }) => {
		assert.equal(args[0], "env");
		assert.equal(args[1], "pull");
		const envPath = args[2];
		assert.equal(typeof envPath, "string");
		pulledFiles.push(envPath);
		writeFileSync(
			envPath,
			["BLOB_STORE_ID=store_demo", "VERCEL_OIDC_TOKEN=oidc_demo", ""].join(
				"\n",
			),
			"utf8",
		);
		return { exitCode: 0, stderr: "", stdout: "" };
	};
	mkdirSync(join(root, ".vercel"), { recursive: true });
	writeFileSync(
		join(root, ".vercel", "project.json"),
		JSON.stringify({ projectId: "prj_demo" }),
		"utf8",
	);

	const context = vercelEnvironmentContextFromCwdIfAvailable(
		{ cwd: root, envName: "staging" },
		{ run },
	);
	assert.ok(context);
	assert.equal(context.kind, "vercel");
	assert.equal(context.config.projectId, "prj_demo-staging");
	assert.equal(context.config.environment?.name, "staging");
	assert.equal(context.config.prefix, "agentpond/");
	assert.equal(
		context.config.dbPath,
		join(root, ".agentpond", "envs", "prj_demo-staging", "cache.duckdb"),
	);
	const storage = await context.resolveStorage();
	assert.equal(storage.projectId, "prj_demo-staging");
	assert.equal(storage.prefix, "agentpond/");
	assert.equal(pulledFiles.length, 1);
	assert.equal(existsSync(pulledFiles[0]), false);
});

test("Vercel environment selection persists provider-scoped target state", async () => {
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-vercel-selected-target-")),
	);
	mkdirSync(join(root, ".vercel"), { recursive: true });
	writeFileSync(
		join(root, ".vercel", "project.json"),
		JSON.stringify({ projectId: "prj_demo" }),
		"utf8",
	);

	assert.equal(
		await selectVercelEnvironment("staging", { cwd: root }),
		"staging",
	);
	assert.deepEqual(
		JSON.parse(readFileSync(join(root, ".vercel", "agentpond.json"), "utf8")),
		{ projectId: "prj_demo", target: "staging" },
	);

	const selected = vercelEnvironmentContextFromCwdIfAvailable({ cwd: root });
	const explicit = vercelEnvironmentContextFromCwdIfAvailable({
		cwd: root,
		envName: "preview",
	});
	assert.equal(selected?.config.environment?.name, "staging");
	assert.equal(selected?.config.projectId, "prj_demo-staging");
	assert.equal(explicit?.config.environment?.name, "preview");
	assert.equal(explicit?.config.projectId, "prj_demo-preview");
});

test("Vercel ignores selected targets saved for a different linked project", async () => {
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-vercel-relinked-target-")),
	);
	mkdirSync(join(root, ".vercel"), { recursive: true });
	writeFileSync(
		join(root, ".vercel", "project.json"),
		JSON.stringify({ projectId: "prj_old" }),
		"utf8",
	);
	await selectVercelEnvironment("staging", { cwd: root });
	writeFileSync(
		join(root, ".vercel", "project.json"),
		JSON.stringify({ projectId: "prj_new" }),
		"utf8",
	);

	const context = vercelEnvironmentContextFromCwdIfAvailable({ cwd: root });
	assert.equal(context?.config.environment?.name, "production");
	assert.equal(context?.config.projectId, "prj_new-production");
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
	"VERCEL_ENV",
	"VERCEL_OIDC_TOKEN",
	"VERCEL_PROJECT_ID",
	"VERCEL_TARGET_ENV",
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
