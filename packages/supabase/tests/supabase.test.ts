import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createSupabaseSpanExporter,
	type SupabaseProcessRunner,
	SupabaseStorageObjectStore,
	selectSupabaseEnvironment,
	supabaseCliProjectConfigFromCwd,
	supabaseCliProjectConfigFromCwdIfAvailable,
	supabaseEnvironmentContextFromCwdIfAvailable,
	supabaseProjectDirectory,
	supabaseProjectRefFromUrl,
	supabaseProvider,
	supabaseSecretKeyForProject,
	supabaseSecretKeyFromEnv,
	supabaseStorageConfigFromEnv,
	validateSupabaseProjectRef,
} from "@agentpond/supabase";
import {
	BasicTracerProvider,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import type { SupabaseClient } from "@supabase/supabase-js";

const PROJECT_REF = "abcdefghijklmnopqrst";
const OTHER_PROJECT_REF = "bcdefghijklmnopqrstu";
const SECRET_KEY = "sb_secret_agentpond_test";
const PUBLISHABLE_KEY = "sb_publishable_agentpond_test";

test("Supabase runtime configuration applies secret precedence", () => {
	assert.deepEqual(
		supabaseStorageConfigFromEnv({
			SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
			SUPABASE_SECRET_KEY: SECRET_KEY,
			SUPABASE_SECRET_KEYS: JSON.stringify({
				default: "sb_secret_dictionary_test",
			}),
			SUPABASE_SERVICE_ROLE_KEY: legacyKey("service_role"),
		}),
		{
			url: `https://${PROJECT_REF}.supabase.co`,
			secretKey: SECRET_KEY,
			bucket: "agentpond",
			prefix: "",
		},
	);

	assert.equal(
		supabaseSecretKeyFromEnv({
			SUPABASE_SECRET_KEYS: JSON.stringify({
				default: "sb_secret_dictionary_test",
			}),
			SUPABASE_SERVICE_ROLE_KEY: legacyKey("service_role"),
		}),
		"sb_secret_dictionary_test",
	);
	const legacy = legacyKey("service_role");
	assert.equal(
		supabaseSecretKeyFromEnv({ SUPABASE_SERVICE_ROLE_KEY: legacy }),
		legacy,
	);
});

test("Supabase runtime configuration rejects malformed secret dictionaries", () => {
	assert.throws(
		() => supabaseSecretKeyFromEnv({ SUPABASE_SECRET_KEYS: "not-json" }),
		/SUPABASE_SECRET_KEYS must contain a JSON object/,
	);
	assert.throws(
		() =>
			supabaseSecretKeyFromEnv({
				SUPABASE_SECRET_KEYS: JSON.stringify({ default: 42 }),
			}),
		/SUPABASE_SECRET_KEYS\.default must be a non-empty string/,
	);
});

test("Supabase storage rejects publishable and anonymous credentials", () => {
	for (const secretKey of [
		PUBLISHABLE_KEY,
		legacyKey("anon"),
		"sb_secret_********",
		"sb_secret_prefix····",
	]) {
		assert.throws(
			() =>
				SupabaseStorageObjectStore.fromConfig({
					url: `https://${PROJECT_REF}.supabase.co`,
					secretKey,
				}),
			/secret key or legacy service-role key/,
		);
	}
});

test("Supabase hosted URLs derive and validate project refs", () => {
	assert.equal(
		supabaseProjectRefFromUrl(`https://${PROJECT_REF}.supabase.co/`),
		PROJECT_REF,
	);
	assert.equal(validateSupabaseProjectRef(PROJECT_REF), PROJECT_REF);
	assert.throws(
		() => supabaseProjectRefFromUrl("https://localhost:54321"),
		/provide projectId explicitly/,
	);
	assert.throws(
		() => validateSupabaseProjectRef("too-short"),
		/exactly 20 lowercase letters/,
	);
});

test("Supabase project detection resolves nested linked and unlinked projects", () => {
	const root = supabaseProjectRoot("agentpond-supabase-project-");
	const nested = join(root, "functions", "chat");
	mkdirSync(nested, { recursive: true });

	assert.equal(supabaseProjectDirectory(nested), root);
	assert.equal(supabaseCliProjectConfigFromCwdIfAvailable(nested), undefined);
	assert.throws(
		() => supabaseCliProjectConfigFromCwd(nested),
		/supabase link --project-ref/,
	);
	assert.equal(
		supabaseProvider.openProject({ cwd: nested })?.projectLabel,
		"unlinked",
	);

	linkSupabaseProject(root, PROJECT_REF);
	assert.deepEqual(supabaseCliProjectConfigFromCwd(nested), {
		projectRef: PROJECT_REF,
		root,
	});
	assert.equal(
		supabaseProvider.openProject({ cwd: nested })?.projectLabel,
		PROJECT_REF,
	);
});

test("Supabase environment selection delegates to supabase link", async () => {
	const root = supabaseProjectRoot("agentpond-supabase-select-");
	const requests: unknown[] = [];
	const run: SupabaseProcessRunner = async (request) => {
		requests.push(request);
		return { exitCode: 0, stderr: "", stdout: "" };
	};

	assert.equal(
		await selectSupabaseEnvironment(PROJECT_REF, { cwd: root }, { run }),
		PROJECT_REF,
	);
	assert.deepEqual(requests, [
		{
			args: ["link", "--project-ref", PROJECT_REF],
			cwd: root,
			stdio: "inherit",
		},
	]);
});

test("Supabase CLI key resolution prefers modern secrets and falls back to service_role", async () => {
	const root = supabaseProjectRoot("agentpond-supabase-keys-");
	const project = { projectRef: PROJECT_REF, root };
	const legacy = legacyKey("service_role");
	const outputs = [
		JSON.stringify([
			{ name: "service_role", type: "legacy", api_key: legacy },
			{ name: "default", type: "secret", api_key: SECRET_KEY },
		]),
		JSON.stringify([
			{ name: "anon", type: "legacy", api_key: legacyKey("anon") },
			{ name: "service_role", type: "legacy", api_key: legacy },
		]),
	];
	const requests: Array<{ args: readonly string[]; cwd: string }> = [];
	const run: SupabaseProcessRunner = async (request) => {
		requests.push(request);
		return { exitCode: 0, stderr: "", stdout: outputs.shift() ?? "[]" };
	};

	assert.equal(await supabaseSecretKeyForProject(project, { run }), SECRET_KEY);
	assert.equal(await supabaseSecretKeyForProject(project, { run }), legacy);
	assert.deepEqual(requests[0], {
		args: [
			"projects",
			"api-keys",
			"--project-ref",
			PROJECT_REF,
			"--output",
			"json",
			"--reveal",
		],
		cwd: root,
		stdio: "capture",
	});
});

test("Supabase CLI failures never include captured secrets", async () => {
	const root = supabaseProjectRoot("agentpond-supabase-redaction-");
	const exposed = "sb_secret_must_never_be_logged";
	for (const result of [
		{ exitCode: 1, stderr: `failure ${exposed}`, stdout: exposed },
		{ exitCode: 0, stderr: "", stdout: `{broken ${exposed}` },
	]) {
		const run: SupabaseProcessRunner = async () => result;
		await assert.rejects(
			() =>
				supabaseSecretKeyForProject({ projectRef: PROJECT_REF, root }, { run }),
			(error: Error) => !error.message.includes(exposed),
		);
	}
});

test("Supabase Storage validates private buckets lazily and only once", async () => {
	const storage = new MockSupabaseStorage();
	const store = SupabaseStorageObjectStore.fromClient(mockClient(storage));
	assert.equal(storage.getBucketCalls, 0);

	await store.putJson("one.json", { ok: true });
	assert.equal(storage.getBucketCalls, 1);
	assert.deepEqual(await store.getJson("one.json"), { ok: true });
	assert.equal(storage.getBucketCalls, 1);
	assert.deepEqual(storage.uploadOptions[0], {
		cacheControl: "0",
		contentType: "application/json",
		upsert: true,
	});
});

test("Supabase Storage rejects missing and public buckets", async () => {
	const missing = new MockSupabaseStorage({ missing: true });
	await assert.rejects(
		() =>
			SupabaseStorageObjectStore.fromClient(mockClient(missing)).listKeys(""),
		/bucket "agentpond" does not exist/,
	);

	const publicStorage = new MockSupabaseStorage({ public: true });
	await assert.rejects(
		() =>
			SupabaseStorageObjectStore.fromClient(mockClient(publicStorage)).putJson(
				"one.json",
				{},
			),
		/bucket "agentpond" must be private/,
	);
});

test("Supabase Storage recursively paginates and returns stable keys", async () => {
	const storage = new MockSupabaseStorage();
	for (let index = 104; index >= 0; index -= 1) {
		storage.objects.set(
			`otel/${PROJECT_REF}/root-${String(index).padStart(3, "0")}.json`,
			JSON.stringify(index),
		);
	}
	storage.objects.set(
		`otel/${PROJECT_REF}/nested/second.json`,
		JSON.stringify(2),
	);
	storage.objects.set("unrelated/object.json", JSON.stringify(false));
	const store = SupabaseStorageObjectStore.fromClient(mockClient(storage));

	const keys = await store.listKeys(`otel/${PROJECT_REF}/`);
	assert.equal(keys.length, 106);
	assert.equal(keys[0], `otel/${PROJECT_REF}/nested/second.json`);
	assert.equal(keys.at(-1), `otel/${PROJECT_REF}/root-104.json`);
	assert.ok(
		storage.listRequests.some(
			(request) =>
				request.path === `otel/${PROJECT_REF}` && request.offset === 100,
		),
	);
});

test("Supabase environment contexts use project refs for overrides and cache paths", async () => {
	const root = supabaseProjectRoot("agentpond-supabase-context-");
	linkSupabaseProject(root, PROJECT_REF);
	const storage = new MockSupabaseStorage();
	const run: SupabaseProcessRunner = async () => ({
		exitCode: 0,
		stderr: "",
		stdout: JSON.stringify([
			{ name: "default", type: "secret", api_key: SECRET_KEY },
		]),
	});
	const context = supabaseEnvironmentContextFromCwdIfAvailable(
		{ cwd: root, envName: OTHER_PROJECT_REF },
		{ run },
	);
	assert.ok(context);
	assert.equal(context.kind, "supabase");
	assert.equal(context.config.projectId, OTHER_PROJECT_REF);
	assert.equal(context.config.environment?.name, OTHER_PROJECT_REF);
	assert.equal(
		context.config.dbPath,
		join(root, ".agentpond", "envs", OTHER_PROJECT_REF, "cache.duckdb"),
	);
	assert.equal(context.config.prefix, "");
	assert.equal(context.rootDir, root);
	assert.equal(context.usesAgentPondDevServer, false);
	assert.match(
		supabaseProvider.instrumentationPrompt,
		/agentpond Storage bucket/,
	);
	assert.doesNotMatch(supabaseProvider.instrumentationPrompt, /EdgeRuntime/);

	const original = SupabaseStorageObjectStore.fromConfig;
	SupabaseStorageObjectStore.fromConfig = (() =>
		SupabaseStorageObjectStore.fromClient(
			mockClient(storage),
		)) as typeof SupabaseStorageObjectStore.fromConfig;
	try {
		const resolved = await context.resolveStorage();
		assert.equal(resolved.projectId, OTHER_PROJECT_REF);
		assert.equal(resolved.prefix, "");
	} finally {
		SupabaseStorageObjectStore.fromConfig = original;
	}
});

test("Supabase exporter writes to otel/<project-ref> with no bucket prefix", async () => {
	const storage = new MockSupabaseStorage();
	const exporter = createSupabaseSpanExporter({
		client: mockClient(storage),
	});
	const provider = new BasicTracerProvider({
		spanProcessors: [new SimpleSpanProcessor(exporter)],
	});
	provider.getTracer("supabase-test").startSpan("test span").end();
	await provider.forceFlush();

	const keys = [...storage.objects.keys()];
	assert.equal(keys.length, 1);
	assert.match(
		keys[0],
		new RegExp(`^otel/${PROJECT_REF}/\\d{4}/\\d{2}/\\d{2}/`),
	);
	await provider.shutdown();
});

test("Supabase exporter accepts an explicit project ref for custom URLs", () => {
	const storage = new MockSupabaseStorage();
	assert.ok(
		createSupabaseSpanExporter({
			client: mockClient(
				storage,
				SECRET_KEY,
				"https://supabase.internal.example",
			),
			projectId: PROJECT_REF,
		}),
	);
	assert.throws(
		() =>
			createSupabaseSpanExporter({
				client: mockClient(
					storage,
					SECRET_KEY,
					"https://supabase.internal.example",
				),
			}),
		/provide projectId explicitly/,
	);
});

type MockStorageOptions = {
	missing?: boolean;
	public?: boolean;
};

class MockSupabaseStorage {
	readonly listRequests: Array<{ offset: number; path: string }> = [];
	readonly objects = new Map<string, string>();
	readonly uploadOptions: unknown[] = [];
	getBucketCalls = 0;

	constructor(private readonly options: MockStorageOptions = {}) {}

	getBucket = async () => {
		this.getBucketCalls += 1;
		if (this.options.missing) {
			return {
				data: null,
				error: { message: "Bucket not found", statusCode: 404 },
			};
		}
		return { data: { public: Boolean(this.options.public) }, error: null };
	};

	from = () => ({
		upload: async (path: string, body: string, options: unknown) => {
			this.uploadOptions.push(options);
			this.objects.set(path, body);
			return { data: { path }, error: null };
		},
		download: async (path: string) => {
			const body = this.objects.get(path);
			return body === undefined
				? {
						data: null,
						error: { message: "Object not found", statusCode: 404 },
					}
				: { data: new Blob([body]), error: null };
		},
		list: async (path: string, options: { limit: number; offset: number }) => {
			this.listRequests.push({ path, offset: options.offset });
			const entries = immediateStorageEntries(this.objects, path);
			return {
				data: entries.slice(options.offset, options.offset + options.limit),
				error: null,
			};
		},
	});
}

function mockClient(
	storage: MockSupabaseStorage,
	key = SECRET_KEY,
	url = `https://${PROJECT_REF}.supabase.co`,
): SupabaseClient {
	return {
		storage,
		supabaseKey: key,
		supabaseUrl: url,
	} as unknown as SupabaseClient;
}

function immediateStorageEntries(
	objects: Map<string, string>,
	directory: string,
): Array<{ id: string | null; metadata: unknown; name: string }> {
	const base = directory ? `${directory}/` : "";
	const entries = new Map<
		string,
		{ id: string | null; metadata: unknown; name: string }
	>();
	for (const key of objects.keys()) {
		if (!key.startsWith(base)) continue;
		const remainder = key.slice(base.length);
		const [name, ...rest] = remainder.split("/");
		if (!name) continue;
		entries.set(
			name,
			rest.length > 0
				? { id: null, metadata: null, name }
				: { id: `id-${name}`, metadata: {}, name },
		);
	}
	return [...entries.values()].sort((left, right) =>
		left.name.localeCompare(right.name),
	);
}

function supabaseProjectRoot(prefix: string): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	mkdirSync(join(root, "supabase"), { recursive: true });
	writeFileSync(join(root, "supabase", "config.toml"), 'project_id = "test"\n');
	return root;
}

function linkSupabaseProject(root: string, projectRef: string): void {
	mkdirSync(join(root, "supabase", ".temp"), { recursive: true });
	writeFileSync(
		join(root, "supabase", ".temp", "project-ref"),
		`${projectRef}\n`,
	);
}

function legacyKey(role: string): string {
	return [
		base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
		base64Url(JSON.stringify({ role })),
		"signature",
	].join(".");
}

function base64Url(value: string): string {
	return Buffer.from(value, "utf8")
		.toString("base64")
		.replace(/=/g, "")
		.replace(/\+/g, "-")
		.replace(/\//g, "_");
}
