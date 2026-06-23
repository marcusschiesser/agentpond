import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("published CLI package does not declare private workspace runtime dependencies", () => {
	const manifest = JSON.parse(
		readFileSync(join(process.cwd(), "apps", "cli", "package.json"), "utf8"),
	) as {
		dependencies?: Record<string, string>;
	};
	const privateWorkspaceDeps = Object.keys(manifest.dependencies ?? {}).filter(
		(name) => name.startsWith("@agentpond/"),
	);

	assert.deepEqual(privateWorkspaceDeps, []);
});
