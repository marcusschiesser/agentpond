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
import { MemoryObjectStore } from "@agentpond/core";
import { AgentPondSpanExporter } from "@agentpond/otel";
import * as vercelPackage from "@agentpond/vercel";
import {
	createVercelSpanExporter,
	selectVercelEnvironment,
	type VercelBlobConfig,
	type VercelProcessRunner,
	vercelAgentPondProjectId,
	vercelBlobConfigFromEnv,
	vercelBlobConfigFromRuntimeEnv,
	vercelCliProjectConfigFromCwd,
	vercelEnvironmentContextFromCwdIfAvailable,
	vercelProjectCandidateDirectory,
	vercelProvider,
} from "@agentpond/vercel";
import { vercelBlobAdapterOptions } from "../src/blob.js";

test("Vercel Blob runtime config leaves OIDC resolution to the SDK", () => {
	const originalEnv = saveEnv(VERCEL_ENV_KEYS);

	try {
		clearEnv(VERCEL_ENV_KEYS);

		assert.deepEqual(vercelBlobConfigFromRuntimeEnv(), {
			access: "private",
		});

		process.env.AGENTPOND_BLOB_ACCESS = "public";
		process.env.BLOB_READ_WRITE_TOKEN = "rw-token";
		process.env.BLOB_STORE_ID = "store_123";
		process.env.VERCEL_OIDC_TOKEN = "oidc-token";

		assert.deepEqual(vercelBlobConfigFromRuntimeEnv(), {
			access: "public",
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

test("Vercel Blob uses private overwrite-safe stable keys", () => {
	assert.deepEqual(
		vercelBlobAdapterOptions({
			access: "private",
			token: "rw-token",
			storeId: "store_123",
			oidcToken: "oidc-token",
		}),
		{
			access: "private",
			addRandomSuffix: false,
			allowOverwrite: true,
			token: "rw-token",
			storeId: "store_123",
			oidcToken: "oidc-token",
		},
	);
});

test("Vercel retains its exporter factory without exporting its old store", () => {
	assert.equal("VercelBlobObjectStore" in vercelPackage, false);
	assert.equal(typeof vercelPackage.createVercelSpanExporter, "function");
});

test("Vercel span exporter scopes projects by project and target", () => {
	const originalEnv = saveEnv(VERCEL_ENV_KEYS);
	try {
		clearEnv(VERCEL_ENV_KEYS);
		process.env.VERCEL_PROJECT_ID = "prj_demo";
		process.env.VERCEL_TARGET_ENV = "staging";
		process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_demo";

		assert.equal(
			vercelAgentPondProjectId("prj_demo", "staging"),
			"prj_demo-staging",
		);
		assert.ok(
			createVercelSpanExporter({ retries: 0, timeout: 1_000 }) instanceof
				AgentPondSpanExporter,
		);
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
	let resolvedConfig: VercelBlobConfig | undefined;
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
		{
			run,
			createStore(config) {
				resolvedConfig = config;
				return new MemoryObjectStore();
			},
		},
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
	assert.deepEqual(resolvedConfig, {
		access: "private",
		token: undefined,
		storeId: "store_demo",
		oidcToken: "oidc_demo",
	});
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
