import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initAgentPondEnvironment } from "@agentpond/core";
import { type ExportResult, ExportResultCode } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BasicTracerProvider,
	InMemorySpanExporter,
	type ReadableSpan,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Files, FilesError } from "files-sdk";
import { memory } from "files-sdk/memory";
import {
	FilesObjectStore,
	filesSdkConfigFromRuntimeEnv,
	getFilesSdkProvider,
	listFilesSdkBucketProviders,
	listFilesSdkProviders,
} from "../src/index.js";
import {
	createFilesSpanExporter,
	createFilesSpanExporterFromRuntimeEnv,
} from "../src/otel.js";

async function readableSpans(): Promise<ReadableSpan[]> {
	const collector = new InMemorySpanExporter();
	const provider = new BasicTracerProvider({
		resource: resourceFromAttributes({
			"service.name": "files-sdk-exporter-test",
		}),
		spanProcessors: [new SimpleSpanProcessor(collector)],
	});
	const span = provider
		.getTracer("files-sdk-exporter-test")
		.startSpan("files span");
	span.end();
	const spans = [...collector.getFinishedSpans()];
	await provider.shutdown();
	return spans;
}

test("FilesObjectStore implements JSON reads, writes, and sorted prefix lists", async () => {
	const files = new Files({ adapter: memory() });
	const store = new FilesObjectStore(files);

	await store.putJson("traces/z.json", { id: "z" });
	await store.putJson("traces/a.json", { id: "a" });
	await store.putJson("other/b.json", { id: "b" });

	assert.deepEqual(await store.getJson("traces/a.json"), { id: "a" });
	assert.deepEqual(await store.listKeys("traces/"), [
		"traces/a.json",
		"traces/z.json",
	]);
	assert.equal((await files.head("traces/a.json")).type, "application/json");
});

test("FilesObjectStore.fromAdapter applies retries and timeout defaults", async () => {
	const adapter = memory();
	const upload = adapter.upload;
	let attempts = 0;
	adapter.upload = async (...args) => {
		attempts += 1;
		if (attempts < 3) {
			throw new FilesError("Provider", "temporary failure");
		}
		return upload(...args);
	};
	const store = FilesObjectStore.fromAdapter(adapter, {
		retries: 2,
		timeout: 1_000,
	});

	await store.putJson("retry.json", { ok: true });

	assert.equal(attempts, 3);
	assert.deepEqual(await store.getJson("retry.json"), { ok: true });
});

test("FilesObjectStore readiness runs once for concurrent operations", async () => {
	let readinessCalls = 0;
	const store = FilesObjectStore.fromAdapter(memory(), {
		beforeFirstOperation: async () => {
			readinessCalls += 1;
			await Promise.resolve();
		},
	});

	await Promise.all([
		store.putJson("a.json", { id: "a" }),
		store.putJson("b.json", { id: "b" }),
		store.listKeys(""),
	]);
	assert.equal(readinessCalls, 1);
});

test("FilesObjectStore memoizes readiness failures", async () => {
	const failure = new Error("bucket is public");
	let readinessCalls = 0;
	const store = FilesObjectStore.fromAdapter(memory(), {
		beforeFirstOperation: () => {
			readinessCalls += 1;
			throw failure;
		},
	});

	await assert.rejects(store.listKeys(""), (error) => error === failure);
	await assert.rejects(
		store.putJson("a.json", { id: "a" }),
		(error) => error === failure,
	);
	assert.equal(readinessCalls, 1);
});

test("FilesObjectStore reports invalid JSON with the object key", async () => {
	const files = new Files({ adapter: memory() });
	const store = new FilesObjectStore(files);
	await files.upload("broken.json", "{");

	await assert.rejects(
		store.getJson("broken.json"),
		/"broken\.json".*valid JSON/,
	);
	await assert.rejects(
		store.putJson("undefined.json", undefined),
		/not JSON serializable/,
	);
});

test("FilesObjectStore persists JSON through the Files SDK filesystem adapter", async () => {
	const root = mkdtempSync(join(tmpdir(), "agentpond-files-sdk-fs-store-"));
	const store = FilesObjectStore.fromConfig({ provider: "fs", root });

	await store.putJson("traces/z.json", { id: "z" });
	await store.putJson("traces/a.json", { id: "a" });

	assert.deepEqual(await store.getJson("traces/a.json"), { id: "a" });
	assert.deepEqual(await store.listKeys("traces/"), [
		"traces/a.json",
		"traces/z.json",
	]);
});

test("FilesObjectStore validates persistent Files SDK environment settings", () => {
	const root = mkdtempSync(join(tmpdir(), "agentpond-files-sdk-env-"));
	const environment = initAgentPondEnvironment("production", {
		cwd: root,
		filesSdk: { provider: "s3", bucket: "agentpond" },
	});

	writeFileSync(environment.envFilePath, "AGENTPOND_FILES_BUCKET=agentpond\n");
	assert.throws(
		() => FilesObjectStore.fromEnvironment(environment),
		/FILES_SDK_PROVIDER/,
	);

	writeFileSync(environment.envFilePath, "FILES_SDK_PROVIDER=fs\n");
	assert.throws(
		() => FilesObjectStore.fromEnvironment(environment),
		/requires FILES_SDK_ROOT/,
	);

	const fsRoot = join(root, ".agentpond", "envs", "local", "objects");
	writeFileSync(
		environment.envFilePath,
		`FILES_SDK_PROVIDER=fs\nFILES_SDK_ROOT=${fsRoot}\n`,
	);
	assert.doesNotThrow(() => FilesObjectStore.fromEnvironment(environment));

	writeFileSync(
		environment.envFilePath,
		"FILES_SDK_PROVIDER=bun-s3\nAGENTPOND_FILES_BUCKET=agentpond\n",
	);
	assert.throws(
		() => FilesObjectStore.fromEnvironment(environment),
		/not supported by AgentPond's Node\.js runtime/,
	);
});

test("FilesObjectStore does not replace persistent settings with ambient storage config", () => {
	const root = mkdtempSync(
		join(tmpdir(), "agentpond-files-sdk-persistent-env-"),
	);
	const environment = initAgentPondEnvironment("production", {
		cwd: root,
		filesSdk: { provider: "s3", bucket: "agentpond" },
	});
	const originalProvider = process.env.FILES_SDK_PROVIDER;
	const originalBucket = process.env.AGENTPOND_FILES_BUCKET;
	try {
		process.env.FILES_SDK_PROVIDER = "r2";
		process.env.AGENTPOND_FILES_BUCKET = "ambient-bucket";
		writeFileSync(
			environment.envFilePath,
			"AGENTPOND_STORE=s3\nAGENTPOND_S3_BUCKET=legacy-bucket\n",
		);

		assert.throws(
			() => FilesObjectStore.fromEnvironment(environment),
			/FILES_SDK_PROVIDER/,
		);
	} finally {
		if (originalProvider === undefined) {
			delete process.env.FILES_SDK_PROVIDER;
		} else {
			process.env.FILES_SDK_PROVIDER = originalProvider;
		}
		if (originalBucket === undefined) {
			delete process.env.AGENTPOND_FILES_BUCKET;
		} else {
			process.env.AGENTPOND_FILES_BUCKET = originalBucket;
		}
	}
});

test("FilesObjectStore parses runtime endpoint and region configuration", () => {
	assert.deepEqual(
		filesSdkConfigFromRuntimeEnv({
			FILES_SDK_PROVIDER: "minio",
			AGENTPOND_FILES_BUCKET: "agentpond",
			FILES_SDK_ENDPOINT: "http://localhost:9000",
			FILES_SDK_REGION: "us-east-1",
		}),
		{
			provider: "minio",
			bucket: "agentpond",
			endpoint: "http://localhost:9000",
			region: "us-east-1",
		},
	);
	assert.deepEqual(
		filesSdkConfigFromRuntimeEnv({
			FILES_SDK_PROVIDER: "fs",
			FILES_SDK_ROOT: "/tmp/agentpond-files",
		}),
		{
			provider: "fs",
			root: "/tmp/agentpond-files",
		},
	);
	assert.deepEqual(
		filesSdkConfigFromRuntimeEnv({
			FILES_SDK_PROVIDER: "azure",
			AGENTPOND_FILES_CONTAINER: "agentpond",
			AZURE_STORAGE_CONNECTION_STRING: "not-read-by-agentpond",
		}),
		{
			provider: "azure",
			container: "agentpond",
		},
	);
	assert.throws(
		() => filesSdkConfigFromRuntimeEnv({ FILES_SDK_PROVIDER: "azure" }),
		/requires AGENTPOND_FILES_CONTAINER/,
	);
	assert.throws(
		() => filesSdkConfigFromRuntimeEnv({ FILES_SDK_PROVIDER: "fs" }),
		/requires FILES_SDK_ROOT/,
	);
	assert.throws(
		() =>
			filesSdkConfigFromRuntimeEnv({
				FILES_SDK_PROVIDER: "minio",
				AGENTPOND_FILES_BUCKET: "agentpond",
			}),
		/requires FILES_SDK_ENDPOINT/,
	);
});

test("FilesObjectStore parses Netlify and Oracle configuration", () => {
	assert.deepEqual(
		filesSdkConfigFromRuntimeEnv({
			FILES_SDK_PROVIDER: "netlify-blobs",
			AGENTPOND_FILES_STORE_NAME: "agentpond",
		}),
		{
			provider: "netlify-blobs",
			storeName: "agentpond",
		},
	);
	assert.deepEqual(
		filesSdkConfigFromRuntimeEnv({
			FILES_SDK_PROVIDER: "oracle-cloud",
			AGENTPOND_FILES_BUCKET: "agentpond",
			AGENTPOND_FILES_NAMESPACE: "example-namespace",
			FILES_SDK_REGION: "eu-madrid-1",
		}),
		{
			provider: "oracle-cloud",
			bucket: "agentpond",
			namespace: "example-namespace",
			region: "eu-madrid-1",
		},
	);
});

test("Files SDK provider contracts reflect adapter-required configuration", () => {
	assert.throws(
		() =>
			filesSdkConfigFromRuntimeEnv({
				FILES_SDK_PROVIDER: "akamai",
				AGENTPOND_FILES_BUCKET: "agentpond",
			}),
		/requires FILES_SDK_REGION/,
	);
	assert.deepEqual(
		filesSdkConfigFromRuntimeEnv({
			FILES_SDK_PROVIDER: "backblaze-b2",
			AGENTPOND_FILES_BUCKET: "agentpond",
			FILES_SDK_REGION: "us-west-002",
		}),
		{
			provider: "backblaze-b2",
			bucket: "agentpond",
			region: "us-west-002",
		},
	);
	assert.throws(
		() =>
			filesSdkConfigFromRuntimeEnv({
				FILES_SDK_PROVIDER: "oracle-cloud",
				AGENTPOND_FILES_BUCKET: "agentpond",
				FILES_SDK_REGION: "eu-madrid-1",
			}),
		/requires AGENTPOND_FILES_NAMESPACE/,
	);

	const supportedProviders = listFilesSdkProviders().map(({ slug }) => slug);
	const bucketProviders = listFilesSdkBucketProviders().map(({ slug }) => slug);
	assert.deepEqual(getFilesSdkProvider("fs").configFields, ["root"]);
	assert.deepEqual(getFilesSdkProvider("azure").configFields, ["container"]);
	assert.deepEqual(getFilesSdkProvider("netlify-blobs").configFields, [
		"storeName",
	]);
	assert.deepEqual(getFilesSdkProvider("oracle-cloud").configFields, [
		"bucket",
		"namespace",
		"region",
	]);
	assert.throws(
		() => getFilesSdkProvider("ftp"),
		/requires unsupported configuration field "host"/,
	);
	assert.throws(
		() => getFilesSdkProvider("sftp"),
		/requires unsupported configuration field "host"/,
	);
	assert.throws(
		() => getFilesSdkProvider("webdav"),
		/requires unsupported configuration field "baseUrl"/,
	);
	assert.ok(supportedProviders.includes("fs"));
	assert.ok(supportedProviders.includes("azure"));
	assert.ok(supportedProviders.includes("box"));
	assert.ok(supportedProviders.includes("akamai"));
	assert.ok(supportedProviders.includes("backblaze-b2"));
	assert.ok(supportedProviders.includes("ibm-cos"));
	assert.ok(supportedProviders.includes("netlify-blobs"));
	assert.ok(supportedProviders.includes("oracle-cloud"));
	assert.ok(!supportedProviders.includes("ftp"));
	assert.ok(!supportedProviders.includes("sftp"));
	assert.ok(!supportedProviders.includes("webdav"));
	assert.ok(!supportedProviders.includes("memory"));
	assert.ok(!supportedProviders.includes("bun-s3"));
	assert.ok(!supportedProviders.includes("convex"));
	assert.ok(!bucketProviders.includes("fs"));
	assert.ok(!bucketProviders.includes("azure"));
	assert.ok(bucketProviders.includes("oracle-cloud"));
});

test("createFilesSpanExporter uses AgentPond runtime project and prefix", async () => {
	const files = new Files({ adapter: memory() });
	const originalProjectId = process.env.AGENTPOND_PROJECT_ID;
	const originalPrefix = process.env.AGENTPOND_PREFIX;
	process.env.AGENTPOND_PROJECT_ID = "files-project";
	process.env.AGENTPOND_PREFIX = "shared";
	try {
		const exporter = createFilesSpanExporter({ files });
		const spans = await readableSpans();
		const result = await new Promise<ExportResult>((resolve) =>
			exporter.export(spans, resolve),
		);

		assert.equal(result.code, ExportResultCode.SUCCESS);
		const keys: string[] = [];
		for await (const file of files.listAll({
			prefix: "shared/otel/files-project/",
		})) {
			keys.push(file.key);
		}
		assert.equal(keys.length, 1);
		assert.match(
			keys[0],
			/^shared\/otel\/files-project\/\d{4}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/[0-9a-f-]+\.json$/,
		);
		await exporter.shutdown();
	} finally {
		if (originalProjectId === undefined) {
			delete process.env.AGENTPOND_PROJECT_ID;
		} else {
			process.env.AGENTPOND_PROJECT_ID = originalProjectId;
		}
		if (originalPrefix === undefined) {
			delete process.env.AGENTPOND_PREFIX;
		} else {
			process.env.AGENTPOND_PREFIX = originalPrefix;
		}
	}
});

test("createFilesSpanExporter accepts a store without ambient project configuration", async () => {
	const adapter = memory();
	const store = FilesObjectStore.fromAdapter(adapter);
	const originalProjectId = process.env.AGENTPOND_PROJECT_ID;
	const originalPrefix = process.env.AGENTPOND_PREFIX;
	delete process.env.AGENTPOND_PROJECT_ID;
	delete process.env.AGENTPOND_PREFIX;
	try {
		const exporter = createFilesSpanExporter({
			store,
			projectId: "explicit-project",
			prefix: "explicit-prefix",
		});
		const spans = await readableSpans();
		const result = await new Promise<ExportResult>((resolve) =>
			exporter.export(spans, resolve),
		);

		assert.equal(result.code, ExportResultCode.SUCCESS);
		const keys = await store.listKeys("explicit-prefix/otel/explicit-project/");
		assert.equal(keys.length, 1);
		await exporter.shutdown();
	} finally {
		if (originalProjectId === undefined) {
			delete process.env.AGENTPOND_PROJECT_ID;
		} else {
			process.env.AGENTPOND_PROJECT_ID = originalProjectId;
		}
		if (originalPrefix === undefined) {
			delete process.env.AGENTPOND_PREFIX;
		} else {
			process.env.AGENTPOND_PREFIX = originalPrefix;
		}
	}
});

test("createFilesSpanExporterFromRuntimeEnv loads the filesystem adapter", async () => {
	const root = mkdtempSync(join(tmpdir(), "agentpond-files-sdk-runtime-fs-"));
	const exporter = createFilesSpanExporterFromRuntimeEnv({
		env: {
			FILES_SDK_PROVIDER: "fs",
			FILES_SDK_ROOT: root,
			AGENTPOND_PROJECT_ID: "runtime-files-project",
			AGENTPOND_PREFIX: "runtime-files-prefix",
		},
	});
	const spans = await readableSpans();
	const result = await new Promise<ExportResult>((resolve) =>
		exporter.export(spans, resolve),
	);

	assert.equal(result.code, ExportResultCode.SUCCESS);
	const store = FilesObjectStore.fromConfig({ provider: "fs", root });
	const keys = await store.listKeys(
		"runtime-files-prefix/otel/runtime-files-project/",
	);
	assert.equal(keys.length, 1);
	assert.match(keys[0], /[0-9a-f-]+\.json$/);
	await exporter.shutdown();
});
