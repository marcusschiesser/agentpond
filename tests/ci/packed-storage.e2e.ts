import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("packed storage integrations install with Firebase Admin and Storage 8", {
	timeout: 300_000,
}, () => {
	const root = mkdtempSync(join(tmpdir(), "agentpond-packed-storage-"));
	const repository = process.cwd();
	try {
		for (const name of [
			"core",
			"otel",
			"ingest",
			"files-sdk",
			"firebase",
			"supabase",
			"vercel",
		]) {
			execFileSync("pnpm", ["pack", "--pack-destination", root], {
				cwd: resolve(repository, "packages", name),
				stdio: "pipe",
			});
		}
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ private: true, type: "module" }),
		);
		const tarballs = readdirSync(root).filter((name) => name.endsWith(".tgz"));
		assert.equal(tarballs.length, 7);
		execFileSync(
			"npm",
			[
				"install",
				"--ignore-scripts",
				"--no-audit",
				"--no-fund",
				...tarballs.map((name) => join(root, name)),
				"firebase-admin@14.5.0",
				"@google-cloud/storage@8.4.0",
			],
			{ cwd: root, stdio: "pipe", timeout: 240_000 },
		);
		const lock = JSON.parse(
			readFileSync(join(root, "package-lock.json"), "utf8"),
		) as {
			packages: Record<string, { version?: string }>;
		};
		const storage = Object.entries(lock.packages).filter(([path]) =>
			path.endsWith("node_modules/@google-cloud/storage"),
		);
		assert.ok(storage.length > 0);
		for (const [path, entry] of storage) {
			assert.match(
				entry.version ?? "",
				/^8\./,
				`${path} must not install Storage 7`,
			);
		}
		const files = Object.entries(lock.packages).filter(([path]) =>
			path.endsWith("node_modules/files-sdk"),
		);
		assert.ok(files.length > 0);
		for (const [path, entry] of files) {
			assert.equal(entry.version, "3.1.0", path);
		}
		writeFileSync(
			join(root, "smoke.mjs"),
			`
import assert from "node:assert/strict";
import { Files } from "files-sdk";
import { memory } from "files-sdk/memory";
import { FilesObjectStore } from "@agentpond/files-sdk";
import { createFilesSpanExporter } from "@agentpond/files-sdk/otel";
import { createFirebaseSpanExporter } from "@agentpond/firebase";
import { createSupabaseSpanExporter } from "@agentpond/supabase";
import { createVercelSpanExporter } from "@agentpond/vercel";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { firebaseStorage } from "files-sdk/firebase-storage";
const store = FilesObjectStore.fromFiles(new Files({ adapter: memory() }));
await store.putJson("traces/a.json", { traceId: "packed-trace" });
await store.putJson("other/b.json", { other: true });
assert.deepEqual(await store.getJson("traces/a.json"), { traceId: "packed-trace" });
assert.deepEqual(await store.listKeys("traces/"), ["traces/a.json"]);
for (const exporter of [createFilesSpanExporter, createFirebaseSpanExporter, createSupabaseSpanExporter, createVercelSpanExporter]) {
  assert.equal(typeof exporter, "function");
}
const app = initializeApp({ projectId: "packed-test", storageBucket: "packed-test.appspot.com" });
try {
  const bucket = getStorage(app).bucket();
  const files = new Files({ adapter: firebaseStorage({ app: bucket }) });
  assert.ok(files);
} finally {
  await deleteApp(app);
}
`,
		);
		execFileSync(process.execPath, ["smoke.mjs"], { cwd: root, stdio: "pipe" });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
