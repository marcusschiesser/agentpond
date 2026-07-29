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
	initAgentPondEnvironment,
	listAgentPondEnvironments,
	MemoryObjectStore,
	parseEnvFile,
	resolveAgentPondEnvironment,
	selectAgentPondEnvironment,
	sinkFromStore,
} from "@agentpond/core";

function initRemoteEnvironment(name: string) {
	return initAgentPondEnvironment(name, {
		filesSdk: { provider: "s3", bucket: "agentpond" },
	});
}

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
	} finally {
		process.chdir(originalCwd);
		restoreEnv(originalEnv);
	}
});

test("generated remote environment files contain only Files SDK storage settings", () => {
	const originalCwd = process.cwd();
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-"));
	try {
		process.chdir(cwd);
		const dev = initAgentPondEnvironment("dev");
		const production = initAgentPondEnvironment("production", {
			filesSdk: {
				provider: "minio",
				bucket: "agentpond",
				endpoint: "http://localhost:9000",
				region: "us-east-1",
			},
		});
		const productionFile = readFileSync(production.envFilePath, "utf8");

		assert.equal(existsSync(dev.envFilePath), false);
		assert.deepEqual(Object.keys(parseEnvFile(production.envFilePath)).sort(), [
			"AGENTPOND_FILES_BUCKET",
			"AGENTPOND_PREFIX",
			"AGENTPOND_PROJECT_ID",
			"FILES_SDK_ENDPOINT",
			"FILES_SDK_PROVIDER",
			"FILES_SDK_REGION",
		]);
		assert.match(productionFile, /AGENTPOND_PREFIX=/);
		assert.match(productionFile, /FILES_SDK_PROVIDER=minio/);
		assert.match(productionFile, /AGENTPOND_FILES_BUCKET=agentpond/);
		assert.match(productionFile, /FILES_SDK_ENDPOINT=http:\/\/localhost:9000/);
		assert.match(productionFile, /FILES_SDK_REGION=us-east-1/);
	} finally {
		process.chdir(originalCwd);
	}
});

test("generated environment files persist Files SDK provider and bucket", () => {
	const originalCwd = process.cwd();
	const originalEnv = saveEnv(CONFIG_ENV_KEYS);
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-files-sdk-"));
	try {
		clearEnv(CONFIG_ENV_KEYS);
		process.chdir(cwd);
		const environment = initAgentPondEnvironment("files-env", {
			filesSdk: {
				provider: "r2",
				bucket: "agentpond",
			},
		});
		const content = readFileSync(environment.envFilePath, "utf8");

		assert.match(content, /FILES_SDK_PROVIDER=r2/);
		assert.match(content, /AGENTPOND_FILES_BUCKET=agentpond/);
		assert.match(content, /AGENTPOND_PROJECT_ID=default-project/);
		assert.match(content, /AGENTPOND_PREFIX=/);
		assert.throws(
			() => initAgentPondEnvironment("invalid-files-env"),
			/require a Files SDK provider/,
		);
		assert.throws(
			() =>
				initAgentPondEnvironment("invalid-files-bucket", {
					filesSdk: { provider: "r2", bucket: "bucket\nINJECTED=value" },
				}),
			/bucket must be a single-line value/,
		);
	} finally {
		process.chdir(originalCwd);
		restoreEnv(originalEnv);
	}
});

test("generated environment files persist Files SDK filesystem roots", () => {
	const originalCwd = process.cwd();
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-files-sdk-fs-"));
	const storageRoot = join(cwd, ".agentpond", "envs", "local", "objects");
	try {
		process.chdir(cwd);
		const environment = initAgentPondEnvironment("local", {
			filesSdk: {
				provider: "fs",
				root: storageRoot,
			},
		});
		const content = readFileSync(environment.envFilePath, "utf8");

		assert.match(content, /FILES_SDK_PROVIDER=fs/);
		assert.match(content, new RegExp(`FILES_SDK_ROOT=${storageRoot}`));
		assert.doesNotMatch(content, /AGENTPOND_FILES_BUCKET=/);
		assert.throws(
			() =>
				initAgentPondEnvironment("invalid-files-root", {
					filesSdk: { provider: "fs", root: "objects\nINJECTED=value" },
				}),
			/root must be a single-line value/,
		);
	} finally {
		process.chdir(originalCwd);
	}
});

test("generated environment files persist Azure Blob containers", () => {
	const originalCwd = process.cwd();
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-files-sdk-azure-"));
	try {
		process.chdir(cwd);
		const environment = initAgentPondEnvironment("azure", {
			filesSdk: {
				provider: "azure",
				container: "agentpond",
			},
		});
		const content = readFileSync(environment.envFilePath, "utf8");

		assert.match(content, /FILES_SDK_PROVIDER=azure/);
		assert.match(content, /AGENTPOND_FILES_CONTAINER=agentpond/);
		assert.doesNotMatch(content, /AGENTPOND_FILES_BUCKET=/);
		assert.throws(
			() =>
				initAgentPondEnvironment("invalid-files-container", {
					filesSdk: {
						provider: "azure",
						container: "objects\nINJECTED=value",
					},
				}),
			/container must be a single-line value/,
		);
	} finally {
		process.chdir(originalCwd);
	}
});

test("config uses only the shared AgentPond prefix", () => {
	const originalCwd = process.cwd();
	const originalEnv = saveEnv(CONFIG_ENV_KEYS);
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-"));
	try {
		clearEnv(CONFIG_ENV_KEYS);
		process.chdir(cwd);
		const env = initRemoteEnvironment("production");
		writeFileSync(
			env.envFilePath,
			[
				"FILES_SDK_PROVIDER=gcs",
				"AGENTPOND_FILES_BUCKET=trace-bucket",
				"AGENTPOND_PREFIX=prod",
				"AGENTPOND_S3_PREFIX=ignored-s3",
				"AGENTPOND_GCS_PREFIX=ignored-gcs",
				"",
			].join("\n"),
			"utf8",
		);
		const config = configFromEnv({ envName: "production" });

		assert.equal(config.prefix, "prod/");
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
		const env = initRemoteEnvironment("production");
		writeFileSync(
			env.envFilePath,
			[
				"FILES_SDK_PROVIDER=s3",
				"AGENTPOND_PROJECT_ID=file-project",
				"AGENTPOND_FILES_BUCKET=file-bucket",
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
	writeFileSync(
		join(cwd, "pnpm-workspace.yaml"),
		"packages:\n  - packages/*\n",
	);
	mkdirSync(join(cwd, ".agentpond", "envs", "dev"), { recursive: true });
	mkdirSync(join(cwd, ".agentpond", "envs"), { recursive: true });
	writeFileSync(join(cwd, ".agentpond", "envs", "production.env"), "");

	assert.deepEqual(listAgentPondEnvironments(packageDir), [
		"dev",
		"production",
	]);
});

test("sinkFromStore writes accepted ingestion events to object storage", async () => {
	const store = new MemoryObjectStore();
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

const CONFIG_ENV_KEYS = [
	"AGENTPOND_PROJECT_ID",
	"AGENTPOND_PREFIX",
	"AGENTPOND_FILES_BUCKET",
	"AGENTPOND_FILES_CONTAINER",
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
	"FILES_SDK_PROVIDER",
	"FILES_SDK_ENDPOINT",
	"FILES_SDK_REGION",
	"FILES_SDK_ROOT",
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
