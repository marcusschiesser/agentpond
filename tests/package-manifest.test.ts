import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { getProvider, PROVIDER_NAMES } from "files-sdk/providers";

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
	"packages/files-sdk",
	"packages/firebase",
	"packages/supabase",
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

test("turnkey applications ship every supported Files SDK provider peer dependency", () => {
	const supportedConfigFields = new Set([
		"bucket",
		"container",
		"endpoint",
		"region",
	]);
	const providers = PROVIDER_NAMES.map((name) => getProvider(name)).filter(
		(provider) =>
			provider !== undefined &&
			provider.slug !== "bun-s3" &&
			provider.env.config?.some(
				(field) => field === "bucket" || field === "container",
			) === true &&
			provider.env.config.every((field) => supportedConfigFields.has(field)),
	);
	const requiredPeerDependencies = [
		...new Set(providers.flatMap((provider) => provider.peerDeps)),
	].sort();

	assert.ok(providers.length > 0, "Files SDK must expose bucket providers");
	for (const packagePath of ["apps/cli", "apps/ingest"]) {
		const manifest = readManifest(packagePath);
		const missingDependencies = requiredPeerDependencies.filter(
			(name) => manifest.dependencies?.[name] === undefined,
		);
		assert.deepEqual(
			missingDependencies,
			[],
			`${manifest.name} must ship every Files SDK bucket provider peer dependency`,
		);
		assert.ok(
			manifest.dependencies?.["files-sdk"],
			`${manifest.name} must ship Files SDK`,
		);
	}
});
