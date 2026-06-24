import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	configFromEnv,
	FileSystemObjectStore,
	initAgentPondEnvironment,
	listAgentPondEnvironments,
	resolveAgentPondEnvironment,
	selectAgentPondEnvironment,
} from "@agentpond/core";

test("config defaults to the dev environment DuckDB cache", () => {
	const originalCwd = process.cwd();
	const originalStore = process.env.AGENTPOND_STORE;
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-"));

	try {
		delete process.env.AGENTPOND_STORE;
		process.chdir(cwd);

		assert.equal(
			configFromEnv().dbPath,
			join(process.cwd(), ".agentpond", "envs", "dev", "cache.duckdb"),
		);
		assert.equal(configFromEnv().environment?.name, "dev");
		assert.equal(configFromEnv().environment?.storeType, "s3");
	} finally {
		process.chdir(originalCwd);
		if (originalStore === undefined) {
			delete process.env.AGENTPOND_STORE;
		} else {
			process.env.AGENTPOND_STORE = originalStore;
		}
	}
});

test("config keeps explicit path override precedence", () => {
	assert.equal(
		configFromEnv({ dbPath: "/tmp/agentpond-override.duckdb" }).dbPath,
		"/tmp/agentpond-override.duckdb",
	);
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
		assert.match(productionFile, /LANGFUSE_BASE_URL=http:\/\/localhost:4318/);
		assert.match(productionFile, /AGENTPOND_STORE=s3/);
		assert.match(productionFile, /# S3 bucket/);
		assert.match(productionFile, /AGENTPOND_S3_BUCKET=agentpond/);
		assert.match(productionFile, /AGENTPOND_S3_PREFIX=/);
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
		assert.equal(
			configFromEnv({ envName: "production" }).s3.endpoint,
			"http://localhost:9000",
		);
		assert.equal(
			configFromEnv({ envName: "production" }).s3.accessKeyId,
			"minio",
		);
		assert.equal(
			configFromEnv({ envName: "production" }).s3.secretAccessKey,
			"minio123",
		);
	} finally {
		process.chdir(originalCwd);
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

test("environment file values are loaded below process env and flags", () => {
	const originalCwd = process.cwd();
	const originalProject = process.env.AGENTPOND_PROJECT_ID;
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-"));
	try {
		delete process.env.AGENTPOND_PROJECT_ID;
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
			configFromEnv({
				envName: "production",
				dbPath: "/tmp/override.duckdb",
			}).dbPath,
			"/tmp/override.duckdb",
		);
	} finally {
		process.chdir(originalCwd);
		if (originalProject === undefined) {
			delete process.env.AGENTPOND_PROJECT_ID;
		} else {
			process.env.AGENTPOND_PROJECT_ID = originalProject;
		}
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
