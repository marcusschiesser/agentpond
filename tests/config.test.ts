import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configFromEnv } from "@agentpond/core";

test("config defaults DuckDB cache to the current working directory", () => {
	const originalCwd = process.cwd();
	const originalDb = process.env.AGENTPOND_DB;
	const cwd = mkdtempSync(join(tmpdir(), "agentpond-config-"));

	try {
		delete process.env.AGENTPOND_DB;
		process.chdir(cwd);

		assert.equal(
			configFromEnv().dbPath,
			join(process.cwd(), ".agentpond", "cache.duckdb"),
		);
	} finally {
		process.chdir(originalCwd);
		if (originalDb === undefined) {
			delete process.env.AGENTPOND_DB;
		} else {
			process.env.AGENTPOND_DB = originalDb;
		}
	}
});

test("config keeps DuckDB path override precedence", () => {
	const originalDb = process.env.AGENTPOND_DB;

	try {
		process.env.AGENTPOND_DB = "/tmp/agentpond-env.duckdb";

		assert.equal(configFromEnv().dbPath, "/tmp/agentpond-env.duckdb");
		assert.equal(
			configFromEnv({ dbPath: "/tmp/agentpond-override.duckdb" }).dbPath,
			"/tmp/agentpond-override.duckdb",
		);
	} finally {
		if (originalDb === undefined) {
			delete process.env.AGENTPOND_DB;
		} else {
			process.env.AGENTPOND_DB = originalDb;
		}
	}
});
