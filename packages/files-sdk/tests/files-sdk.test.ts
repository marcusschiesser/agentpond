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
import { Files } from "files-sdk";
import { memory } from "files-sdk/memory";
import {
	FilesObjectStore,
	filesSdkConfigFromRuntimeEnv,
} from "../src/index.js";
import { createFilesSpanExporter } from "../src/otel.js";

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

	writeFileSync(
		environment.envFilePath,
		"FILES_SDK_PROVIDER=fs\nAGENTPOND_FILES_BUCKET=agentpond\n",
	);
	assert.throws(
		() => FilesObjectStore.fromEnvironment(environment),
		/not bucket-backed/,
	);

	writeFileSync(
		environment.envFilePath,
		"FILES_SDK_PROVIDER=bun-s3\nAGENTPOND_FILES_BUCKET=agentpond\n",
	);
	assert.throws(
		() => FilesObjectStore.fromEnvironment(environment),
		/not supported by AgentPond's Node\.js runtime/,
	);
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
	assert.throws(
		() =>
			filesSdkConfigFromRuntimeEnv({
				FILES_SDK_PROVIDER: "minio",
				AGENTPOND_FILES_BUCKET: "agentpond",
			}),
		/requires FILES_SDK_ENDPOINT/,
	);
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
