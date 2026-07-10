import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

type PackageManifest = {
	name: string;
	private?: boolean;
	description?: string;
	license?: string;
	files?: string[];
	types?: string;
	repository?: {
		directory?: string;
	};
	exports?: {
		"."?: {
			types?: string;
			import?: string;
		};
	};
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
};

const publishablePackages = [
	"packages/core",
	"packages/otel",
	"packages/ingest",
	"packages/fastify-ingest",
	"packages/aws",
	"packages/firebase",
	"packages/google",
	"packages/vercel",
	"packages/duckdb",
] as const;

function readManifest(packagePath: string): PackageManifest {
	return JSON.parse(
		readFileSync(join(process.cwd(), packagePath, "package.json"), "utf8"),
	) as PackageManifest;
}

test("publishable packages declare npm-ready dist exports", () => {
	for (const packagePath of publishablePackages) {
		const manifest = readManifest(packagePath);

		assert.notEqual(
			manifest.private,
			true,
			`${manifest.name} must be publishable`,
		);
		assert.equal(
			typeof manifest.description,
			"string",
			`${manifest.name} must declare a description`,
		);
		assert.notEqual(
			manifest.description?.trim(),
			"",
			`${manifest.name} must declare a non-empty description`,
		);
		assert.equal(manifest.license, "MIT", `${manifest.name} must use MIT`);
		assert.equal(
			manifest.repository?.directory,
			packagePath,
			`${manifest.name} must declare its repository directory`,
		);
		assert.deepEqual(
			manifest.files,
			["dist"],
			`${manifest.name} must publish only dist files`,
		);
		assert.equal(
			manifest.types,
			"./dist/index.d.ts",
			`${manifest.name} must expose dist types`,
		);
		assert.equal(
			manifest.exports?.["."]?.types,
			"./dist/index.d.ts",
			`${manifest.name} must export dist types`,
		);
		assert.equal(
			manifest.exports?.["."]?.import,
			"./dist/index.js",
			`${manifest.name} must export dist ESM`,
		);
	}
});

test("publishable packages do not depend on private workspace packages", () => {
	for (const packagePath of publishablePackages) {
		const manifest = readManifest(packagePath);
		const runtimeDependencyNames = [
			...Object.keys(manifest.dependencies ?? {}),
			...Object.keys(manifest.peerDependencies ?? {}),
			...Object.keys(manifest.optionalDependencies ?? {}),
		];
		const privateWorkspaceDeps = runtimeDependencyNames
			.filter((name) => name.startsWith("@agentpond/"))
			.filter((name) => {
				const packageName = name.replace("@agentpond/", "");
				return readManifest(`packages/${packageName}`).private === true;
			});

		assert.deepEqual(
			privateWorkspaceDeps,
			[],
			`${manifest.name} must not depend on private workspace packages`,
		);
	}
});
