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
import {
	configFromEnv,
	configFromRuntimeEnv,
	eventTypes,
	FileSystemObjectStore,
	initAgentPondEnvironment,
	listAgentPondEnvironments,
	resolveAgentPondEnvironment,
	selectAgentPondEnvironment,
	sinkForConfig,
	sinkForRuntimeEnv,
	sinkFromStore,
} from "@agentpond/core";

test("config defaults to the dev environment DuckDB cache", () => {
	const originalCwd = process.cwd();
	const originalEnv = saveEnv(CONFIG_ENV_KEYS);
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-"));

	try {
		clearEnv(CONFIG_ENV_KEYS);
		process.chdir(cwd);

		assert.equal(
			configFromEnv().dbPath,
			join(process.cwd(), ".agentpond", "envs", "dev", "cache.duckdb"),
		);
		assert.equal(configFromEnv().environment?.name, "dev");
		assert.equal(configFromEnv().environment?.storeType, "s3");
	} finally {
		process.chdir(originalCwd);
		restoreEnv(originalEnv);
	}
});

test("generated environment files document defaults and S3 settings", () => {
	const originalCwd = process.cwd();
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-"));
	try {
		process.chdir(cwd);
		const dev = initAgentPondEnvironment("dev");
		const production = initAgentPondEnvironment("production");
		const productionFile = readFileSync(production.envFilePath, "utf8");

		assert.equal(existsSync(dev.envFilePath), false);

		assert.match(productionFile, /# Storage backend/);
		assert.match(
			productionFile,
			/OTEL_EXPORTER_OTLP_ENDPOINT=http:\/\/localhost:4318\/api\/public\/otel/,
		);
		assert.match(
			productionFile,
			/OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http:\/\/localhost:4318\/api\/public\/otel\/v1\/traces/,
		);
		assert.match(productionFile, /OTEL_EXPORTER_OTLP_PROTOCOL=http\/json/);
		assert.match(productionFile, /LANGFUSE_BASE_URL=http:\/\/localhost:4318/);
		assert.match(productionFile, /AGENTPOND_STORE=s3/);
		assert.match(productionFile, /AGENTPOND_PREFIX=/);
		assert.match(productionFile, /# S3 bucket/);
		assert.match(productionFile, /AGENTPOND_S3_BUCKET=agentpond/);
		assert.doesNotMatch(productionFile, /AGENTPOND_S3_PREFIX=/);
		assert.match(
			productionFile,
			/Local MinIO endpoint from docker-compose\.yml/,
		);
		assert.match(
			productionFile,
			/AGENTPOND_S3_ENDPOINT=http:\/\/localhost:9000/,
		);
		assert.match(productionFile, /AGENTPOND_S3_REGION=us-east-1/);
		assert.match(productionFile, /AGENTPOND_S3_ACCESS_KEY_ID=minio/);
		assert.match(productionFile, /AGENTPOND_S3_SECRET_ACCESS_KEY=minio123/);
		assert.match(productionFile, /Use true for MinIO/);
		assert.match(productionFile, /AGENTPOND_S3_FORCE_PATH_STYLE=true/);
		assert.match(productionFile, /S3-compatible providers/);
		assert.match(
			productionFile,
			/# AGENTPOND_S3_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED/,
		);
		assert.match(
			productionFile,
			/# AGENTPOND_S3_RESPONSE_CHECKSUM_VALIDATION=WHEN_REQUIRED/,
		);
	} finally {
		process.chdir(originalCwd);
	}
});

test("generated environment files document local, GCS, and Vercel settings", () => {
	const originalCwd = process.cwd();
	const originalEnv = saveEnv(CONFIG_ENV_KEYS);
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-"));
	try {
		clearEnv(CONFIG_ENV_KEYS);
		process.chdir(cwd);
		const local = initAgentPondEnvironment("local-env", { storeType: "local" });
		const gcs = initAgentPondEnvironment("gcs-env", { storeType: "gcs" });
		const vercel = initAgentPondEnvironment("vercel-env", {
			storeType: "vercel",
		});
		const localFile = readFileSync(local.envFilePath, "utf8");
		const gcsFile = readFileSync(gcs.envFilePath, "utf8");
		const vercelFile = readFileSync(vercel.envFilePath, "utf8");

		assert.match(localFile, /AGENTPOND_STORE=local/);
		assert.match(localFile, /AGENTPOND_PREFIX=/);
		assert.doesNotMatch(localFile, /AGENTPOND_S3_BUCKET/);
		assert.doesNotMatch(localFile, /AGENTPOND_S3_REQUEST_CHECKSUM/);
		assert.doesNotMatch(localFile, /AGENTPOND_S3_RESPONSE_CHECKSUM/);
		assert.match(gcsFile, /AGENTPOND_STORE=gcs/);
		assert.match(gcsFile, /AGENTPOND_PREFIX=/);
		assert.match(gcsFile, /AGENTPOND_GCS_BUCKET=agentpond/);
		assert.doesNotMatch(gcsFile, /AGENTPOND_GCS_PREFIX=/);
		assert.doesNotMatch(gcsFile, /AGENTPOND_S3_REQUEST_CHECKSUM/);
		assert.doesNotMatch(gcsFile, /AGENTPOND_S3_RESPONSE_CHECKSUM/);
		assert.match(gcsFile, /Application Default Credentials/);
		assert.match(vercelFile, /AGENTPOND_STORE=vercel/);
		assert.match(vercelFile, /AGENTPOND_PREFIX=/);
		assert.match(vercelFile, /AGENTPOND_BLOB_ACCESS=private/);
		assert.match(vercelFile, /BLOB_READ_WRITE_TOKEN=/);
		assert.match(vercelFile, /BLOB_STORE_ID=/);
		assert.match(vercelFile, /VERCEL_OIDC_TOKEN=/);
		assert.doesNotMatch(vercelFile, /AGENTPOND_S3_BUCKET/);
		assert.doesNotMatch(vercelFile, /AGENTPOND_GCS_BUCKET/);
		assert.equal(configFromEnv({ envName: "local-env" }).prefix, "");
		assert.equal(
			configFromEnv({ envName: "gcs-env" }).environment?.storeType,
			"gcs",
		);
		assert.equal(
			configFromEnv({ envName: "vercel-env" }).environment?.storeType,
			"vercel",
		);
		assert.equal(configFromEnv({ envName: "gcs-env" }).prefix, "");
	} finally {
		process.chdir(originalCwd);
		restoreEnv(originalEnv);
	}
});

test("config accepts cloud store values and rejects unknown stores", () => {
	const originalCwd = process.cwd();
	const originalEnv = saveEnv(CONFIG_ENV_KEYS);
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-"));
	try {
		clearEnv(CONFIG_ENV_KEYS);
		process.chdir(cwd);
		const env = initAgentPondEnvironment("production", { storeType: "gcs" });
		writeFileSync(
			env.envFilePath,
			[
				"AGENTPOND_STORE=gcs",
				"AGENTPOND_GCS_BUCKET=trace-bucket",
				"AGENTPOND_PREFIX=prod",
				"",
			].join("\n"),
			"utf8",
		);
		const config = configFromEnv({ envName: "production" });

		assert.equal(config.environment?.storeType, "gcs");
		assert.equal(config.prefix, "prod/");

		writeFileSync(
			env.envFilePath,
			[
				"AGENTPOND_STORE=vercel",
				"AGENTPOND_BLOB_ACCESS=private",
				"AGENTPOND_PREFIX=prod",
				"",
			].join("\n"),
			"utf8",
		);
		assert.equal(
			configFromEnv({ envName: "production" }).environment?.storeType,
			"vercel",
		);

		process.env.AGENTPOND_STORE = "azure";
		assert.throws(
			() => configFromEnv({ envName: "production" }),
			/AGENTPOND_STORE must be "local", "s3", "gcs", or "vercel"/,
		);
	} finally {
		process.chdir(originalCwd);
		restoreEnv(originalEnv);
	}
});

test("config reads legacy provider-specific prefixes as fallbacks", () => {
	const originalCwd = process.cwd();
	const originalEnv = saveEnv(CONFIG_ENV_KEYS);
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-"));
	try {
		clearEnv(CONFIG_ENV_KEYS);
		process.chdir(cwd);
		const s3Env = initAgentPondEnvironment("s3-env");
		writeFileSync(
			s3Env.envFilePath,
			["AGENTPOND_STORE=s3", "AGENTPOND_S3_PREFIX=legacy-s3", ""].join("\n"),
			"utf8",
		);
		const gcsEnv = initAgentPondEnvironment("gcs-env");
		writeFileSync(
			gcsEnv.envFilePath,
			["AGENTPOND_STORE=gcs", "AGENTPOND_GCS_PREFIX=legacy-gcs", ""].join("\n"),
			"utf8",
		);

		assert.equal(configFromEnv({ envName: "s3-env" }).prefix, "legacy-s3/");
		assert.equal(configFromEnv({ envName: "gcs-env" }).prefix, "legacy-gcs/");
	} finally {
		process.chdir(originalCwd);
		restoreEnv(originalEnv);
	}
});

test("local environments use the shared object-store prefix", () => {
	const originalCwd = process.cwd();
	const originalEnv = saveEnv(CONFIG_ENV_KEYS);
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-"));
	try {
		clearEnv(CONFIG_ENV_KEYS);
		process.chdir(cwd);
		const env = initAgentPondEnvironment("local-env", { storeType: "local" });
		writeFileSync(
			env.envFilePath,
			["AGENTPOND_STORE=local", "AGENTPOND_PREFIX=local-prefix", ""].join("\n"),
			"utf8",
		);
		const config = configFromEnv({ envName: "local-env" });

		assert.equal(config.prefix, "local-prefix/");
	} finally {
		process.chdir(originalCwd);
		restoreEnv(originalEnv);
	}
});

test("environment selection and explicit --env names resolve separate caches", () => {
	const originalCwd = process.cwd();
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-"));
	try {
		process.chdir(cwd);
		selectAgentPondEnvironment("staging");

		assert.equal(resolveAgentPondEnvironment().name, "staging");
		assert.equal(
			configFromEnv().dbPath,
			join(process.cwd(), ".agentpond", "envs", "staging", "cache.duckdb"),
		);
		assert.equal(
			configFromEnv({ envName: "production" }).dbPath,
			join(process.cwd(), ".agentpond", "envs", "production", "cache.duckdb"),
		);
	} finally {
		process.chdir(originalCwd);
	}
});

test("environment resolution can use the pnpm workspace root from a nested package", () => {
	const root = mkdtempSync(join(tmpdir(), "agentpond-workspace-"));
	const nested = join(root, "packages", "functions");
	mkdirSync(nested, { recursive: true });
	writeFileSync(
		join(root, "pnpm-workspace.yaml"),
		"packages:\n  - packages/*\n",
	);
	const environment = resolveAgentPondEnvironment({
		name: "dev",
		cwd: nested,
	});

	assert.equal(environment.envDir, join(root, ".agentpond", "envs", "dev"));
	assert.equal(
		environment.dbPath,
		join(root, ".agentpond", "envs", "dev", "cache.duckdb"),
	);
});

test("config can resolve the DuckDB cache from the workspace root", () => {
	const originalCwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-config-workspace-")),
	);
	const nested = join(root, "packages", "functions");
	mkdirSync(nested, { recursive: true });
	writeFileSync(
		join(root, "pnpm-workspace.yaml"),
		"packages:\n  - packages/*\n",
	);
	try {
		process.chdir(nested);
		const config = configFromEnv();

		assert.equal(config.environment?.agentpondDir, join(root, ".agentpond"));
		assert.equal(
			config.dbPath,
			join(root, ".agentpond", "envs", "dev", "cache.duckdb"),
		);
	} finally {
		process.chdir(originalCwd);
	}
});

test("environment resolution accepts common workspace root markers", () => {
	const cases = [
		{
			name: "pnpm-yml",
			file: "pnpm-workspace.yml",
			content: "packages:\n  - packages/*\n",
		},
		{
			name: "package-workspaces-array",
			file: "package.json",
			content: JSON.stringify({ workspaces: ["packages/*"] }),
		},
		{
			name: "package-workspaces-object",
			file: "package.json",
			content: JSON.stringify({ workspaces: { packages: ["packages/*"] } }),
		},
		{
			name: "turbo",
			file: "turbo.json",
			content: JSON.stringify({ tasks: {} }),
		},
	];

	for (const testCase of cases) {
		const root = mkdtempSync(join(tmpdir(), `agentpond-${testCase.name}-`));
		const nested = join(root, "packages", "functions");
		mkdirSync(nested, { recursive: true });
		writeFileSync(join(root, testCase.file), testCase.content);

		assert.equal(
			resolveAgentPondEnvironment({
				name: "dev",
				cwd: nested,
			}).envDir,
			join(root, ".agentpond", "envs", "dev"),
		);
	}
});

test("workspace root environment resolution falls back to cwd outside a pnpm workspace", () => {
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-no-workspace-"));
	const environment = resolveAgentPondEnvironment({
		name: "dev",
		cwd,
	});

	assert.equal(
		environment.dbPath,
		join(cwd, ".agentpond", "envs", "dev", "cache.duckdb"),
	);
});

test("environment file values are loaded below process env", () => {
	const originalCwd = process.cwd();
	const originalEnv = saveEnv(CONFIG_ENV_KEYS);
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-"));
	try {
		clearEnv(CONFIG_ENV_KEYS);
		process.chdir(cwd);
		const env = initAgentPondEnvironment("production");
		writeFileSync(
			env.envFilePath,
			[
				"AGENTPOND_STORE=s3",
				"AGENTPOND_PROJECT_ID=file-project",
				"AGENTPOND_S3_BUCKET=file-bucket",
				"",
			].join("\n"),
			"utf8",
		);

		assert.equal(
			configFromEnv({ envName: "production" }).projectId,
			"file-project",
		);
		process.env.AGENTPOND_PROJECT_ID = "process-project";
		assert.equal(
			configFromEnv({ envName: "production" }).projectId,
			"process-project",
		);
		assert.equal(
			configFromEnv({ envName: "production" }).dbPath,
			join(process.cwd(), ".agentpond", "envs", "production", "cache.duckdb"),
		);
	} finally {
		process.chdir(originalCwd);
		restoreEnv(originalEnv);
	}
});

test("runtime config reads process env only", () => {
	const originalCwd = process.cwd();
	const originalEnv = saveEnv(CONFIG_ENV_KEYS);
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-runtime-config-"));
	try {
		clearEnv(CONFIG_ENV_KEYS);
		process.chdir(cwd);
		const env = initAgentPondEnvironment("dev");
		writeFileSync(
			env.envFilePath,
			[
				"AGENTPOND_PROJECT_ID=file-project",
				"AGENTPOND_PREFIX=file-prefix",
				"LANGFUSE_PUBLIC_KEY=pk-file",
				"LANGFUSE_SECRET_KEY=sk-file",
				"",
			].join("\n"),
			"utf8",
		);
		process.env.AGENTPOND_PROJECT_ID = "runtime-project";
		process.env.AGENTPOND_PREFIX = "runtime-prefix";
		process.env.LANGFUSE_PUBLIC_KEY = "pk-runtime";
		process.env.LANGFUSE_SECRET_KEY = "sk-runtime";

		assert.deepEqual(configFromRuntimeEnv(), {
			projectId: "runtime-project",
			prefix: "runtime-prefix/",
			auth: {
				projectId: "runtime-project",
				publicKey: "pk-runtime",
				secretKey: "sk-runtime",
			},
		});
	} finally {
		process.chdir(originalCwd);
		restoreEnv(originalEnv);
	}
});

test("environment list finds env files and directories", () => {
	const originalCwd = process.cwd();
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-"));
	try {
		process.chdir(cwd);
		initAgentPondEnvironment("dev");
		mkdirSync(join(cwd, ".agentpond", "envs", "staging"), {
			recursive: true,
		});

		assert.deepEqual(listAgentPondEnvironments(), ["dev", "staging"]);
	} finally {
		process.chdir(originalCwd);
	}
});

test("environment list resolves from the workspace root", () => {
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-workspace-"));
	const packageDir = join(cwd, "packages", "app");
	mkdirSync(packageDir, { recursive: true });
	writeFileSync(join(cwd, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
	mkdirSync(join(cwd, ".agentpond", "envs", "dev"), { recursive: true });
	mkdirSync(join(cwd, ".agentpond", "envs"), { recursive: true });
	writeFileSync(join(cwd, ".agentpond", "envs", "production.env"), "");

	assert.deepEqual(listAgentPondEnvironments(packageDir), [
		"dev",
		"production",
	]);
});

test("filesystem object store writes, reads, lists, and rejects escapes", async () => {
	const root = mkdtempSync(join(tmpdir(), "agentpond-store-"));
	const store = new FileSystemObjectStore(root);

	await store.putJson("project-a/trace/trace-1/event.json", { ok: true });
	await store.putJson("project-a/trace/trace-2/event.json", { ok: 2 });

	assert.deepEqual(await store.getJson("project-a/trace/trace-1/event.json"), {
		ok: true,
	});
	assert.deepEqual(await store.listKeys("project-a/trace/"), [
		"project-a/trace/trace-1/event.json",
		"project-a/trace/trace-2/event.json",
	]);
	await assert.rejects(
		() => store.putJson("../outside.json", { bad: true }),
		/Object key escapes store root/,
	);
});

test("sinkFromStore writes accepted ingestion events to object storage", async () => {
	const store = new FileSystemObjectStore(
		mkdtempSync(join(tmpdir(), "agentpond-sink-")),
	);
	const sink = sinkFromStore(store, { prefix: "prefix/" });

	await sink.writeEvents({
		projectId: "project-a",
		events: [
			{
				id: "event-sink-1",
				timestamp: "2026-06-14T00:00:00.000Z",
				type: eventTypes.TRACE_CREATE,
				body: { id: "trace-sink-1", name: "Sink Trace" },
			},
		],
	});

	assert.equal((await store.listKeys("prefix/project-a/trace/")).length, 1);
	assert.equal((await store.listKeys("prefix/project-a/manifests/")).length, 1);
});

test("sinkForConfig wraps the configured object store factory", async () => {
	const originalCwd = process.cwd();
	const originalEnv = saveEnv(CONFIG_ENV_KEYS);
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-sink-config-"));
	const store = new FileSystemObjectStore(
		mkdtempSync(join(tmpdir(), "agentpond-sink-factory-")),
	);
	try {
		clearEnv(CONFIG_ENV_KEYS);
		process.chdir(cwd);
		const env = initAgentPondEnvironment("gcs-env", { storeType: "gcs" });
		writeFileSync(
			env.envFilePath,
			[
				"AGENTPOND_STORE=gcs",
				"AGENTPOND_PROJECT_ID=project-a",
				"AGENTPOND_GCS_BUCKET=agentpond",
				"",
			].join("\n"),
			"utf8",
		);
		const config = configFromEnv({ envName: "gcs-env" });
		const sink = sinkForConfig(config, { gcs: () => store });

		await sink.writeOtelResourceSpans({
			projectId: config.projectId,
			resourceSpans: [{ resource: {}, scopeSpans: [] }],
		});

		assert.equal((await store.listKeys("otel/project-a/")).length, 1);
	} finally {
		process.chdir(originalCwd);
		restoreEnv(originalEnv);
	}
});

test("sinkForRuntimeEnv wraps runtime object store factories", async () => {
	const s3Store = new FileSystemObjectStore(
		mkdtempSync(join(tmpdir(), "agentpond-runtime-s3-")),
	);
	const gcsStore = new FileSystemObjectStore(
		mkdtempSync(join(tmpdir(), "agentpond-runtime-gcs-")),
	);
	const projectId = "project-a";

	await sinkForRuntimeEnv(
		{
			gcs: () => gcsStore,
			s3: () => s3Store,
		},
		{ AGENTPOND_PREFIX: "runtime" },
	).writeOtelResourceSpans({
		projectId,
		resourceSpans: [{ resource: {}, scopeSpans: [] }],
	});
	await sinkForRuntimeEnv(
		{
			gcs: () => gcsStore,
			s3: () => s3Store,
		},
		{ AGENTPOND_STORE: "gcs", AGENTPOND_PREFIX: "runtime" },
	).writeOtelResourceSpans({
		projectId,
		resourceSpans: [{ resource: {}, scopeSpans: [] }],
	});

	assert.equal((await s3Store.listKeys("runtime/otel/project-a/")).length, 1);
	assert.equal((await gcsStore.listKeys("runtime/otel/project-a/")).length, 1);
	assert.throws(
		() =>
			sinkForRuntimeEnv(
				{
					gcs: () => gcsStore,
					s3: () => s3Store,
				},
				{ AGENTPOND_STORE: "local" },
			),
		/AGENTPOND_STORE must be "s3", "gcs", or "vercel"/,
	);
});

const CONFIG_ENV_KEYS = [
	"AGENTPOND_PROJECT_ID",
	"AGENTPOND_PREFIX",
	"AGENTPOND_STORE",
	"AGENTPOND_S3_BUCKET",
	"AGENTPOND_S3_ENDPOINT",
	"AGENTPOND_S3_REGION",
	"AGENTPOND_S3_ACCESS_KEY_ID",
	"AGENTPOND_S3_SECRET_ACCESS_KEY",
	"AGENTPOND_S3_FORCE_PATH_STYLE",
	"AGENTPOND_S3_REQUEST_CHECKSUM_CALCULATION",
	"AGENTPOND_S3_RESPONSE_CHECKSUM_VALIDATION",
	"AGENTPOND_S3_PREFIX",
	"AGENTPOND_GCS_BUCKET",
	"AGENTPOND_GCS_PREFIX",
	"AGENTPOND_FIREBASE_STORAGE_BUCKET",
	"AGENTPOND_BLOB_ACCESS",
	"LANGFUSE_BASE_URL",
	"LANGFUSE_PUBLIC_KEY",
	"LANGFUSE_SECRET_KEY",
	"AWS_ACCESS_KEY_ID",
	"AWS_SECRET_ACCESS_KEY",
	"AWS_REGION",
	"GOOGLE_CLOUD_PROJECT",
	"GCLOUD_PROJECT",
	"GCP_PROJECT",
	"BLOB_READ_WRITE_TOKEN",
	"BLOB_STORE_ID",
	"VERCEL_OIDC_TOKEN",
] as const;

type ConfigEnvKey = (typeof CONFIG_ENV_KEYS)[number];
type EnvSnapshot = Map<ConfigEnvKey, string | undefined>;

function saveEnv(keys: readonly ConfigEnvKey[]): EnvSnapshot {
	return new Map(keys.map((key) => [key, process.env[key]]));
}

function clearEnv(keys: readonly ConfigEnvKey[]): void {
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
