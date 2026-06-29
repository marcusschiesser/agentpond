import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("published CLI package only declares publishable workspace runtime dependencies", () => {
	const manifest = JSON.parse(
		readFileSync(join(process.cwd(), "apps", "cli", "package.json"), "utf8"),
	) as {
		dependencies?: Record<string, string>;
	};
	const privateWorkspaceDeps = Object.keys(manifest.dependencies ?? {})
		.filter((name) => name.startsWith("@agentpond/"))
		.filter((name) => {
			const packageName = name.replace("@agentpond/", "");
			const dependencyManifest = JSON.parse(
				readFileSync(
					join(process.cwd(), "packages", packageName, "package.json"),
					"utf8",
				),
			) as {
				private?: boolean;
			};
			return dependencyManifest.private === true;
		});

	assert.deepEqual(privateWorkspaceDeps, []);
});

test("core package does not declare cloud provider SDK dependencies", () => {
	const manifest = JSON.parse(
		readFileSync(
			join(process.cwd(), "packages", "core", "package.json"),
			"utf8",
		),
	) as {
		dependencies?: Record<string, string>;
	};

	assert.equal(manifest.dependencies?.["@aws-sdk/client-s3"], undefined);
	assert.equal(manifest.dependencies?.["@google-cloud/storage"], undefined);
});

test("ingest package does not declare transport or provider dependencies", () => {
	const manifest = JSON.parse(
		readFileSync(
			join(process.cwd(), "packages", "ingest", "package.json"),
			"utf8",
		),
	) as {
		dependencies?: Record<string, string>;
	};

	assert.equal(manifest.dependencies?.fastify, undefined);
	assert.equal(manifest.dependencies?.["@agentpond/aws"], undefined);
	assert.equal(manifest.dependencies?.["@agentpond/google"], undefined);
	assert.equal(manifest.dependencies?.["@aws-sdk/client-s3"], undefined);
	assert.equal(manifest.dependencies?.["@google-cloud/storage"], undefined);
});

test("Fastify and provider SDK dependencies live in adapter packages", () => {
	const fastifyManifest = JSON.parse(
		readFileSync(
			join(process.cwd(), "packages", "fastify-ingest", "package.json"),
			"utf8",
		),
	) as {
		dependencies?: Record<string, string>;
	};
	const awsManifest = JSON.parse(
		readFileSync(
			join(process.cwd(), "packages", "aws", "package.json"),
			"utf8",
		),
	) as {
		dependencies?: Record<string, string>;
	};
	const googleManifest = JSON.parse(
		readFileSync(
			join(process.cwd(), "packages", "google", "package.json"),
			"utf8",
		),
	) as {
		dependencies?: Record<string, string>;
	};

	assert.equal(typeof fastifyManifest.dependencies?.fastify, "string");
	assert.equal(
		typeof awsManifest.dependencies?.["@aws-sdk/client-s3"],
		"string",
	);
	assert.equal(
		typeof googleManifest.dependencies?.["@google-cloud/storage"],
		"string",
	);
});
