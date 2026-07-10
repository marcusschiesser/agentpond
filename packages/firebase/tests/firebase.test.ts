import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	type AuthConfig,
	eventTypes,
	MemoryObjectStore,
	sinkFromStore,
} from "@agentpond/core";
import { AgentPondCache } from "@agentpond/duckdb";
import {
	BasicTracerProvider,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import {
	createFirebaseIngestFunction,
	createFirebaseSpanExporter,
	FirebaseStorageObjectStore,
	firebaseAuthFromRuntimeEnv,
	firebaseCliProjectConfigFromCwd,
	firebaseCliProjectConfigFromCwdIfAvailable,
	firebaseFunctionsSourceDirectories,
	isFirebaseProjectDirectory,
} from "../src/index.js";

const auth: AuthConfig = {
	projectId: "project-a",
	publicKey: "pk",
	secretKey: "sk",
};

const testProject = {
	projectId: "demo-project",
	root: process.cwd(),
};

function authHeader(): string {
	return `Basic ${Buffer.from("pk:sk").toString("base64")}`;
}

test("Firebase storage ignores Firebase env bucket and prefix settings", async () => {
	const originalEnv = saveEnv(FIREBASE_ENV_KEYS);
	try {
		clearEnv(FIREBASE_ENV_KEYS);

		process.env.AGENTPOND_PREFIX = "prod/agentpond";
		process.env.AGENTPOND_FIREBASE_STORAGE_BUCKET = "custom-bucket";

		const objects = new Map<string, string>();
		await withFakeFirebaseProject(objects, async ({ selectedBuckets }) => {
			const store = FirebaseStorageObjectStore.fromConfig();
			await store.toSink().writeEvents({
				projectId: "project-a",
				events: [
					{
						id: "event-firebase-env-prefix",
						timestamp: "2026-06-14T00:00:00.000Z",
						type: eventTypes.TRACE_CREATE,
						body: { id: "trace-firebase-env-prefix" },
					},
				],
			});

			assert.deepEqual(selectedBuckets, [undefined]);
			assert.equal(
				(await store.listKeys("agentpond/project-a/")).length > 0,
				true,
			);
			assert.equal(
				(await store.listKeys("prod/agentpond/project-a/")).length,
				0,
			);
		});
	} finally {
		restoreEnv(originalEnv);
	}
});

test("Firebase CLI project config reads .firebaserc from cwd", () => {
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-firebase-project-"));
	assert.equal(isFirebaseProjectDirectory(cwd), false);
	assert.equal(firebaseCliProjectConfigFromCwdIfAvailable(cwd), undefined);
	writeFileSync(
		join(cwd, ".firebaserc"),
		JSON.stringify({ projects: { default: "demo-project" } }),
		"utf8",
	);

	assert.equal(isFirebaseProjectDirectory(cwd), true);
	assert.deepEqual(firebaseCliProjectConfigFromCwd(cwd), {
		projectId: "demo-project",
		root: cwd,
	});
	assert.deepEqual(firebaseCliProjectConfigFromCwdIfAvailable(cwd), {
		projectId: "demo-project",
		root: cwd,
	});
});

test("Firebase CLI project config walks up to Firebase project roots", () => {
	const root = mkdtempSync(join(tmpdir(), "agentpond-firebase-monorepo-"));
	const cwd = join(root, "packages", "functions");
	mkdirSync(cwd, { recursive: true });
	writeFileSync(join(root, "firebase.json"), JSON.stringify({ functions: [] }));

	assert.equal(isFirebaseProjectDirectory(cwd), true);
	assert.deepEqual(
		firebaseCliProjectConfigFromCwd(cwd, {
			GOOGLE_CLOUD_PROJECT: "env-project",
		} as NodeJS.ProcessEnv),
		{
			projectId: "env-project",
			root,
		},
	);
});

test("Firebase CLI project config finds Functions source directories", () => {
	const root = mkdtempSync(join(tmpdir(), "agentpond-firebase-functions-"));
	writeFileSync(
		join(root, "firebase.json"),
		JSON.stringify({
			functions: [
				{ source: "packages/functions" },
				{ source: "packages/worker" },
			],
		}),
		"utf8",
	);

	assert.deepEqual(firebaseFunctionsSourceDirectories(root), [
		join(root, "packages/functions"),
		join(root, "packages/worker"),
	]);
});

test("Firebase CLI project config reads Firebase config storage buckets", () => {
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-firebase-env-project-"));
	writeFileSync(join(cwd, "firebase.json"), JSON.stringify({ functions: [] }));

	assert.deepEqual(
		firebaseCliProjectConfigFromCwd(cwd, {
			FIREBASE_CONFIG: JSON.stringify({
				projectId: "firebase-config-project",
				storageBucket: "firebase-config-project.firebasestorage.app",
			}),
			GCLOUD_PROJECT: "gcloud-project",
		} as NodeJS.ProcessEnv),
		{
			projectId: "firebase-config-project",
			root: cwd,
			bucket: "firebase-config-project.firebasestorage.app",
		},
	);
});

test("Firebase CLI project config reads Firebase standard env project ids", () => {
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-firebase-env-project-"));
	writeFileSync(join(cwd, "firebase.json"), JSON.stringify({ functions: [] }));

	assert.deepEqual(
		firebaseCliProjectConfigFromCwd(cwd, {
			GCLOUD_PROJECT: "gcloud-project",
		} as NodeJS.ProcessEnv),
		{
			projectId: "gcloud-project",
			root: cwd,
		},
	);
	assert.deepEqual(
		firebaseCliProjectConfigFromCwd(cwd, {
			GCP_PROJECT: "gcp-project",
		} as NodeJS.ProcessEnv),
		{
			projectId: "gcp-project",
			root: cwd,
		},
	);
});

test("Firebase CLI project config rejects missing Firebase projects", () => {
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-no-firebase-project-"));

	assert.throws(
		() => firebaseCliProjectConfigFromCwd(cwd),
		/.firebaserc or firebase.json/,
	);
});

test("Firebase CLI project config rejects Firebase roots without project ids", () => {
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-firebase-no-project-"));
	writeFileSync(join(cwd, "firebase.json"), JSON.stringify({ functions: [] }));

	assert.throws(
		() => firebaseCliProjectConfigFromCwd(cwd, {}),
		/Could not determine Firebase project id/,
	);
});

test("Firebase CLI store reads the default bucket from the initialized project", async () => {
	await withFakeFirebaseProject(
		new Map(),
		async ({ initializedApps, selectedBuckets }) => {
			await FirebaseStorageObjectStore.fromCliProject(testProject);

			assert.deepEqual(initializedApps, [
				{
					projectId: "demo-project",
				},
			]);
			assert.deepEqual(selectedBuckets, [
				"demo-project.appspot.com",
				"demo-project.firebasestorage.app",
			]);
		},
	);
});

test("Firebase CLI store initializes the default app when only named apps exist", async () => {
	await withFakeFirebaseProject(
		new Map(),
		async ({ initializedApps }) => {
			await FirebaseStorageObjectStore.fromCliProject(testProject);

			assert.deepEqual(initializedApps, [
				{ name: "existing-named-app" },
				{ projectId: "demo-project" },
			]);
		},
		{ existingApps: [{ name: "existing-named-app" }] },
	);
});

test("Firebase CLI store loads Firebase Admin from a configured Functions source", async () => {
	await withFakeFirebaseProject(
		new Map(),
		async ({ root, initializedApps }) => {
			await FirebaseStorageObjectStore.fromCliProject({
				projectId: "demo-project",
				root,
			});

			assert.deepEqual(initializedApps, [{ projectId: "demo-project" }]);
		},
		{
			firebaseAdminDirectory: join("packages", "functions", "node_modules"),
			functionsSource: "packages/functions",
		},
	);
});

test("Firebase CLI store reports how to install Firebase Admin", async () => {
	const originalCwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-firebase-admin-missing-"));
	try {
		writeFileSync(
			join(root, "firebase.json"),
			JSON.stringify({ functions: [{ source: "packages/functions" }] }),
			"utf8",
		);
		mkdirSync(join(root, "packages", "functions"), { recursive: true });
		process.chdir(root);

		await assert.rejects(
			FirebaseStorageObjectStore.fromCliProject({
				projectId: "demo-project",
				root,
			}),
			/Install firebase-admin in a declared Functions source package, or add firebase-admin to this workspace's devDependencies/,
		);
	} finally {
		process.chdir(originalCwd);
	}
});

test("Firebase programmatic store uses an already initialized app by default", async () => {
	await withFakeFirebaseProject(new Map(), async ({ initializedApps }) => {
		FirebaseStorageObjectStore.fromConfig();

		assert.deepEqual(initializedApps, []);
	});
});

test("Firebase programmatic store passes custom buckets to initialized storage", async () => {
	await withFakeFirebaseProject(
		new Map(),
		async ({ initializedApps, selectedBuckets }) => {
			FirebaseStorageObjectStore.fromConfig({ bucket: "custom-bucket" });

			assert.deepEqual(initializedApps, []);
			assert.deepEqual(selectedBuckets, ["custom-bucket"]);
		},
	);
});

test("Firebase span exporter derives the default app project and bucket and syncs its trace", async () => {
	const objects = new Map<string, string>();
	await withFakeFirebaseProject(
		objects,
		async ({ selectedBuckets }) => {
			const exporter = createFirebaseSpanExporter();
			const traceId = await emitTestSpan(exporter);

			const objectKeys = [...objects.keys()];
			assert.equal(selectedBuckets[0], "demo-project.firebasestorage.app");
			assert.equal(objectKeys.length, 1);
			assert.match(
				objectKeys[0],
				/^agentpond\/otel\/demo-project\/\d{4}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/[0-9a-f-]+\.json$/,
			);

			const store = FirebaseStorageObjectStore.fromConfig({
				bucket: "demo-project.firebasestorage.app",
			});
			const db = new AgentPondCache(
				join(
					mkdtempSync(join(tmpdir(), "agentpond-firebase-exporter-")),
					"cache.duckdb",
				),
			);
			try {
				const syncResult = await db.syncFromStore({
					store,
					projectId: "demo-project",
					prefix: "agentpond/",
				});
				const traces = await db.query<{ id: string; name: string }>(
					"select id, name from traces",
				);
				assert.equal(syncResult.objectsProcessed, 1);
				assert.deepEqual(traces, [
					{ id: traceId, name: "firebase direct span" },
				]);
			} finally {
				await db.close();
			}
		},
		{
			defaultAppOptions: {
				projectId: "demo-project",
				storageBucket: "demo-project.firebasestorage.app",
			},
		},
	);
});

test("Firebase span exporter supports a custom object prefix", async () => {
	const objects = new Map<string, string>();
	await withFakeFirebaseProject(
		objects,
		async () => {
			await emitTestSpan(createFirebaseSpanExporter({ prefix: "custom" }));

			assert.equal(
				[...objects.keys()].some((key) =>
					key.startsWith("custom/otel/demo-project/"),
				),
				true,
			);
			assert.equal(
				[...objects.keys()].some((key) => key.startsWith("agentpond/")),
				false,
			);
		},
		{
			defaultAppOptions: {
				projectId: "demo-project",
				storageBucket: "demo-project.firebasestorage.app",
			},
		},
	);
});

test("Firebase span exporter requires an initialized default app", async () => {
	await withFakeFirebaseProject(
		new Map(),
		async () => {
			assert.throws(
				() => createFirebaseSpanExporter(),
				/default Firebase app.*initializeApp\(\)/i,
			);
		},
		{ defaultAppOptions: null },
	);
});

test("Firebase span exporter reports how to install Firebase Admin", () => {
	const originalCwd = process.cwd();
	const root = mkdtempSync(
		join(tmpdir(), "agentpond-firebase-exporter-missing-"),
	);
	try {
		process.chdir(root);
		assert.throws(
			() => createFirebaseSpanExporter(),
			/install firebase-admin.*initializeApp\(\)/i,
		);
	} finally {
		process.chdir(originalCwd);
	}
});

test("Firebase span exporter requires the default app project id", async () => {
	await withFakeFirebaseProject(
		new Map(),
		async () => {
			assert.throws(() => createFirebaseSpanExporter(), /no projectId/);
		},
		{ defaultAppOptions: { storageBucket: "demo-project.appspot.com" } },
	);
});

test("Firebase span exporter requires the default app storage bucket", async () => {
	await withFakeFirebaseProject(
		new Map(),
		async () => {
			assert.throws(() => createFirebaseSpanExporter(), /no storageBucket/);
		},
		{ defaultAppOptions: { projectId: "demo-project" } },
	);
});

test("Firebase storage object store writes, reads, and lists JSON objects", async () => {
	const objects = new Map<string, string>();
	await withFakeFirebaseProject(objects, async () => {
		const store = await FirebaseStorageObjectStore.fromCliProject(testProject);

		await store.putJson("project-a/trace/trace-1/event.json", { ok: true });
		await store.putJson("project-a/trace/trace-2/event.json", { ok: 2 });

		assert.deepEqual(
			await store.getJson("project-a/trace/trace-1/event.json"),
			{
				ok: true,
			},
		);
		assert.deepEqual(await store.listKeys("project-a/trace/"), [
			"project-a/trace/trace-1/event.json",
			"project-a/trace/trace-2/event.json",
		]);
	});
});

test("Firebase CLI store ignores missing alternate default buckets", async () => {
	const objects = new Map<string, string>([
		["project-a/trace/trace-1/event.json", JSON.stringify({ ok: true })],
	]);
	await withFakeFirebaseProject(
		objects,
		async () => {
			const store =
				await FirebaseStorageObjectStore.fromCliProject(testProject);

			assert.deepEqual(await store.listKeys("project-a/trace/"), [
				"project-a/trace/trace-1/event.json",
			]);
			assert.deepEqual(
				await store.getJson("project-a/trace/trace-1/event.json"),
				{ ok: true },
			);
		},
		{ missingBuckets: new Set(["demo-project.firebasestorage.app"]) },
	);
});

test("Firebase CLI store reads from the alternate bucket when it has objects", async () => {
	const alternateObjects = new Map<string, string>([
		["agentpond/otel/project-a/2026/01/01/00/object.json", JSON.stringify({})],
		["project-a/trace/trace-1/event.json", JSON.stringify({ ok: true })],
	]);
	await withFakeFirebaseProject(
		new Map(),
		async () => {
			const store =
				await FirebaseStorageObjectStore.fromCliProject(testProject);

			assert.deepEqual(await store.listKeys("project-a/trace/"), [
				"project-a/trace/trace-1/event.json",
			]);
			assert.deepEqual(
				await store.getJson("project-a/trace/trace-1/event.json"),
				{ ok: true },
			);
		},
		{
			bucketObjects: new Map([
				["demo-project.firebasestorage.app", alternateObjects],
			]),
		},
	);
});

test("Firebase store sink writes under the default agentpond prefix", async () => {
	const objects = new Map<string, string>();
	await withFakeFirebaseProject(objects, async () => {
		const store = await FirebaseStorageObjectStore.fromCliProject(testProject);

		await store.toSink().writeEvents({
			projectId: "project-a",
			events: [
				{
					id: "event-firebase-prefix",
					timestamp: "2026-06-14T00:00:00.000Z",
					type: eventTypes.TRACE_CREATE,
					body: { id: "trace-firebase-prefix" },
				},
			],
		});

		assert.equal(
			(await store.listKeys("agentpond/project-a/")).length > 0,
			true,
		);
	});
});

test("Firebase store sink uses programmatic prefix overrides", async () => {
	const objects = new Map<string, string>();
	await withFakeFirebaseProject(objects, async () => {
		const store = FirebaseStorageObjectStore.fromConfig({
			prefix: "custom",
		});

		await store.toSink().writeEvents({
			projectId: "project-a",
			events: [
				{
					id: "event-firebase-custom-prefix",
					timestamp: "2026-06-14T00:00:00.000Z",
					type: eventTypes.TRACE_CREATE,
					body: { id: "trace-firebase-custom-prefix" },
				},
			],
		});

		assert.equal((await store.listKeys("custom/project-a/")).length > 0, true);
		assert.equal((await store.listKeys("agentpond/project-a/")).length, 0);
	});
});

test("Firebase store sink ignores sink prefix overrides", async () => {
	const objects = new Map<string, string>();
	await withFakeFirebaseProject(objects, async () => {
		const store = FirebaseStorageObjectStore.fromConfig({
			prefix: "factory",
		});

		await store.toSink({ prefix: "custom" }).writeEvents({
			projectId: "project-a",
			events: [
				{
					id: "event-firebase-custom-prefix",
					timestamp: "2026-06-14T00:00:00.000Z",
					type: eventTypes.TRACE_CREATE,
					body: { id: "trace-firebase-custom-prefix" },
				},
			],
		});

		assert.equal((await store.listKeys("factory/project-a/")).length > 0, true);
		assert.equal((await store.listKeys("custom/project-a/")).length, 0);
	});
});

test("Firebase ingest function accepts store and default function-prefixed paths", async () => {
	const store = new MemoryObjectStore();
	const fn = createFirebaseIngestFunction({ auth, store });
	const res = createResponse();

	await fn(
		{
			method: "POST",
			originalUrl: "/agentPondIngest/api/public/ingestion?batch=1",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
			},
			rawBody: JSON.stringify({
				batch: [
					{
						id: "event-firebase-1",
						timestamp: "2026-06-14T00:00:00.000Z",
						type: eventTypes.TRACE_CREATE,
						body: { id: "trace-firebase-1", name: "Firebase Trace" },
					},
				],
			}),
		},
		res,
	);

	assert.equal(res.statusCode, 207);
	assert.deepEqual(JSON.parse(res.body).successes, [
		{ id: "event-firebase-1", status: 201 },
	]);
	assert.equal((await store.listKeys("project-a/")).length > 0, true);
});

test("Firebase ingest function infers custom function path prefixes", async () => {
	const store = new MemoryObjectStore();
	const fn = createFirebaseIngestFunction({
		auth,
		store,
	});
	const res = createResponse();

	await fn(
		{
			method: "POST",
			originalUrl: "/telemetryIngest/api/public/ingestion?batch=1",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
			},
			rawBody: JSON.stringify({ batch: [] }),
		},
		res,
	);

	assert.equal(res.statusCode, 207);
	assert.deepEqual(JSON.parse(res.body), { successes: [], errors: [] });
});

test("Firebase ingest function accepts explicit path prefix overrides", async () => {
	const store = new MemoryObjectStore();
	const fn = createFirebaseIngestFunction({
		auth,
		store,
		pathPrefix: "/customIngest",
	});
	const res = createResponse();

	await fn(
		{
			method: "POST",
			originalUrl: "/customIngest/api/public/ingestion?batch=1",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
			},
			rawBody: JSON.stringify({ batch: [] }),
		},
		res,
	);

	assert.equal(res.statusCode, 207);
	assert.deepEqual(JSON.parse(res.body), { successes: [], errors: [] });
});

test("Firebase ingest function accepts direct API paths and sink", async () => {
	const store = new MemoryObjectStore();
	const fn = createFirebaseIngestFunction({
		auth,
		sink: sinkFromStore(store),
	});
	const res = createResponse();

	await fn(
		{
			method: "POST",
			url: "/api/public/otel/v1/traces",
			headers: {
				authorization: authHeader(),
				"content-type": "application/json",
			},
			rawBody: JSON.stringify({ resourceSpans: [] }),
		},
		res,
	);

	assert.equal(res.statusCode, 200);
	assert.deepEqual(JSON.parse(res.body), {});
});

test("Firebase ingest function rejects both store and sink", () => {
	assert.throws(
		() =>
			createFirebaseIngestFunction({
				store: new MemoryObjectStore(),
				sink: sinkFromStore(new MemoryObjectStore()),
			}),
		/AgentPond ingest options cannot include both store and sink/,
	);
});

test("Firebase auth reads Google project fallbacks from runtime env", () => {
	const runtimeEnv = {
		LANGFUSE_PUBLIC_KEY: "pk-runtime",
		LANGFUSE_SECRET_KEY: "sk-runtime",
		GCP_PROJECT: "gcp-project",
		GCLOUD_PROJECT: "gcloud-project",
	};

	assert.deepEqual(firebaseAuthFromRuntimeEnv(runtimeEnv), {
		projectId: "gcloud-project",
		publicKey: "pk-runtime",
		secretKey: "sk-runtime",
	});
});

test("Firebase emulator env still writes to the configured Firebase store", async () => {
	const originalEnv = saveEnv(FIREBASE_ENV_KEYS);
	const store = new MemoryObjectStore();
	const fn = createFirebaseIngestFunction({ auth, store });
	const res = createResponse();
	try {
		process.env.FUNCTIONS_EMULATOR = "true";

		await fn(
			{
				method: "POST",
				url: "/agentPondIngest/api/public/ingestion",
				headers: {
					authorization: authHeader(),
					"content-type": "application/json",
				},
				rawBody: JSON.stringify({ batch: [] }),
			},
			res,
		);

		assert.equal(res.statusCode, 207);
		assert.deepEqual(JSON.parse(res.body), { successes: [], errors: [] });
	} finally {
		restoreEnv(originalEnv);
	}
});

function createBucket(objects: Map<string, string>, missing = false) {
	return {
		file: (name: string) => ({
			save: async (data: string, options: { contentType: string }) => {
				if (missing) throw missingBucketError();
				assert.equal(options.contentType, "application/json");
				objects.set(name, data);
			},
			download: async () => {
				if (missing) throw missingBucketError();
				return [Buffer.from(objects.get(name) ?? "", "utf8")];
			},
		}),
		getFiles: async ({ prefix }: { prefix: string }) => {
			if (missing) throw missingBucketError();
			return [
				[...objects.keys()]
					.filter((key) => key.startsWith(prefix))
					.map((name) => ({ name })),
			];
		},
	};
}

async function withFakeFirebaseProject<T>(
	objects: Map<string, string>,
	run: (context: {
		root: string;
		initializedApps: unknown[];
		selectedBuckets: Array<string | undefined>;
	}) => Promise<T>,
	options: {
		bucketObjects?: Map<string, Map<string, string>>;
		defaultAppOptions?: { projectId?: string; storageBucket?: string } | null;
		firebaseAdminDirectory?: string;
		existingApps?: unknown[];
		functionsSource?: string;
		missingBuckets?: Set<string>;
	} = {},
): Promise<T> {
	const originalCwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-fake-firebase-"));
	const selectedBuckets: Array<string | undefined> = [];
	const initializedApps = [...(options.existingApps ?? [])];
	const firebaseApps = [...(options.existingApps ?? [])];
	if (options.defaultAppOptions) {
		firebaseApps.push({
			name: "[DEFAULT]",
			options: options.defaultAppOptions,
		});
	}
	const firebaseAdminRoot = join(
		root,
		options.firebaseAdminDirectory ?? "node_modules",
		"firebase-admin",
	);
	mkdirSync(firebaseAdminRoot, { recursive: true });
	writeFileSync(
		join(root, ".firebaserc"),
		JSON.stringify({ projects: { default: "demo-project" } }),
		"utf8",
	);
	if (options.functionsSource) {
		writeFileSync(
			join(root, "firebase.json"),
			JSON.stringify({ functions: [{ source: options.functionsSource }] }),
			"utf8",
		);
	}
	writeFileSync(
		join(firebaseAdminRoot, "app.js"),
		`
exports.getApps = () => globalThis.__agentpondFirebaseTest.apps;
exports.initializeApp = (options) => {
	globalThis.__agentpondFirebaseTest.initializedApps.push(options ?? {});
	globalThis.__agentpondFirebaseTest.apps.push({
		name: "[DEFAULT]",
		options: options ?? {},
	});
};
`,
		"utf8",
	);
	writeFileSync(
		join(firebaseAdminRoot, "storage.js"),
		`
exports.getStorage = () => globalThis.__agentpondFirebaseTest.storage;
`,
		"utf8",
	);

	(
		globalThis as typeof globalThis & {
			__agentpondFirebaseTest?: {
				apps: unknown[];
				initializedApps: unknown[];
				storage: { bucket: (name?: string) => ReturnType<typeof createBucket> };
			};
		}
	).__agentpondFirebaseTest = {
		apps: firebaseApps,
		initializedApps,
		storage: {
			bucket: (name?: string) => {
				selectedBuckets.push(name);
				const bucketObjects =
					name === undefined
						? objects
						: (options.bucketObjects?.get(name) ?? objects);
				return createBucket(
					bucketObjects,
					name !== undefined && options.missingBuckets?.has(name) === true,
				);
			},
		},
	};

	try {
		process.chdir(root);
		return await run({ root, initializedApps, selectedBuckets });
	} finally {
		process.chdir(originalCwd);
		delete (globalThis as { __agentpondFirebaseTest?: unknown })
			.__agentpondFirebaseTest;
	}
}

async function emitTestSpan(
	exporter: ReturnType<typeof createFirebaseSpanExporter>,
): Promise<string> {
	const provider = new BasicTracerProvider({
		spanProcessors: [new SimpleSpanProcessor(exporter)],
	});
	const span = provider
		.getTracer("agentpond-firebase-test")
		.startSpan("firebase direct span");
	const traceId = span.spanContext().traceId;
	span.end();
	await provider.forceFlush();
	await provider.shutdown();
	return traceId;
}

function missingBucketError(): Error & { code: number } {
	const error = new Error("No such bucket") as Error & { code: number };
	error.code = 404;
	return error;
}

function createResponse() {
	return {
		statusCode: 200,
		headers: {} as Record<string, string>,
		body: "",
		status(code: number) {
			this.statusCode = code;
			return this;
		},
		set(headers: Record<string, string>) {
			this.headers = { ...this.headers, ...headers };
			return this;
		},
		send(body: string) {
			this.body = body;
			return this;
		},
	};
}

const FIREBASE_ENV_KEYS = [
	"AGENTPOND_FIREBASE_STORAGE_BUCKET",
	"AGENTPOND_PREFIX",
	"FUNCTIONS_EMULATOR",
] as const;

type FirebaseEnvKey = (typeof FIREBASE_ENV_KEYS)[number];
type EnvSnapshot = Map<FirebaseEnvKey, string | undefined>;

function saveEnv(keys: readonly FirebaseEnvKey[]): EnvSnapshot {
	return new Map(keys.map((key) => [key, process.env[key]]));
}

function clearEnv(keys: readonly FirebaseEnvKey[]): void {
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
