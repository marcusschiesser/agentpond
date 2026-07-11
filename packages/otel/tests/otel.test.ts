import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	configFromEnv,
	FileSystemObjectStore,
	initAgentPondEnvironment,
	MemoryObjectStore,
} from "@agentpond/core";
import { OITracer } from "@arizeai/openinference-core";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { getActiveTraceId, startActiveObservation } from "@langfuse/tracing";
import { type ExportResult, ExportResultCode } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
	BasicTracerProvider,
	BatchSpanProcessor,
	InMemorySpanExporter,
	type ReadableSpan,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { main } from "../../../apps/cli/src/index.js";
import { AgentPondSpanExporter } from "../src/index.js";

async function readableSpans(): Promise<ReadableSpan[]> {
	const collector = new InMemorySpanExporter();
	const provider = new BasicTracerProvider({
		resource: resourceFromAttributes({ "service.name": "otel-exporter-test" }),
		spanProcessors: [new SimpleSpanProcessor(collector)],
	});
	const span = provider
		.getTracer("agentpond-exporter-test", "1.0.0")
		.startSpan("test generation", {
			attributes: {
				"openinference.span.kind": "LLM",
				"test.attribute": "preserved",
			},
		});
	span.end();
	const spans = [...collector.getFinishedSpans()];
	await provider.shutdown();
	return spans;
}

function exportSpans(
	exporter: AgentPondSpanExporter,
	spans: ReadableSpan[],
): Promise<ExportResult> {
	return new Promise((resolve) => exporter.export(spans, resolve));
}

async function captureStdout(fn: () => Promise<void>): Promise<string> {
	const consoleLog = console.log;
	const chunks: string[] = [];
	console.log = (...args: unknown[]) => {
		chunks.push(`${args.map(String).join(" ")}\n`);
	};
	try {
		await fn();
	} finally {
		console.log = consoleLog;
	}
	return chunks.join("");
}

test("exports OTLP resource spans directly to the AgentPond object layout", async () => {
	const store = new MemoryObjectStore();
	const exporter = new AgentPondSpanExporter({
		store,
		projectId: "project-a",
		prefix: "prefix",
	});
	const spans = await readableSpans();

	const result = await exportSpans(exporter, spans);

	assert.equal(result.code, ExportResultCode.SUCCESS);
	const keys = await store.listKeys("prefix/otel/project-a/");
	assert.equal(keys.length, 1);
	assert.match(
		keys[0],
		/^prefix\/otel\/project-a\/\d{4}\/\d{2}\/\d{2}\/\d{2}\/\d{2}\/[0-9a-f-]+\.json$/,
	);
	assert.deepEqual(await store.listKeys("prefix/project-a/manifests/"), []);

	const resourceSpans = await store.getJson<
		Array<{
			resource: { attributes: Array<{ key: string; value: unknown }> };
			scopeSpans: Array<{
				scope: { name: string; version?: string };
				spans: Array<{
					traceId: string;
					spanId: string;
					name: string;
					startTimeUnixNano: string;
					endTimeUnixNano: string;
					attributes: Array<{ key: string; value: unknown }>;
				}>;
			}>;
		}>
	>(keys[0]);
	const resourceSpan = resourceSpans[0];
	const storedSpan = resourceSpan.scopeSpans[0].spans[0];
	assert.equal(
		resourceSpan.scopeSpans[0].scope.name,
		"agentpond-exporter-test",
	);
	assert.equal(resourceSpan.scopeSpans[0].scope.version, "1.0.0");
	assert.equal(storedSpan.traceId, spans[0].spanContext().traceId);
	assert.equal(storedSpan.spanId, spans[0].spanContext().spanId);
	assert.equal(storedSpan.name, "test generation");
	assert.match(storedSpan.startTimeUnixNano, /^\d+$/);
	assert.match(storedSpan.endTimeUnixNano, /^\d+$/);
	assert.deepEqual(
		storedSpan.attributes.find(
			(attribute) => attribute.key === "openinference.span.kind",
		),
		{
			key: "openinference.span.kind",
			value: { stringValue: "LLM" },
		},
	);
	assert.ok(
		resourceSpan.resource.attributes.some(
			(attribute) => attribute.key === "service.name",
		),
	);
	await exporter.shutdown();
});

test("empty exports succeed without writing an object", async () => {
	const store = new MemoryObjectStore();
	const exporter = new AgentPondSpanExporter({
		store,
		projectId: "project-a",
	});

	const result = await exportSpans(exporter, []);

	assert.equal(result.code, ExportResultCode.SUCCESS);
	assert.deepEqual(store.writes, []);
	await exporter.shutdown();
});

test("a batched exporter invocation writes multiple spans in one object", async () => {
	const store = new MemoryObjectStore();
	const exporter = new AgentPondSpanExporter({
		store,
		projectId: "project-a",
	});
	const provider = new BasicTracerProvider({
		resource: resourceFromAttributes({ "service.name": "batched-export-test" }),
		spanProcessors: [new BatchSpanProcessor(exporter)],
	});
	const tracer = provider.getTracer("batched-export-test");

	tracer.startSpan("first span").end();
	tracer.startSpan("second span").end();
	await provider.forceFlush();

	const keys = await store.listKeys("otel/project-a/");
	assert.equal(keys.length, 1);
	const resourceSpans = await store.getJson<
		Array<{ scopeSpans?: Array<{ spans?: unknown[] }> }>
	>(keys[0]);
	const storedSpanCount = resourceSpans.reduce(
		(resourceCount, resourceSpan) =>
			resourceCount +
			(resourceSpan.scopeSpans ?? []).reduce(
				(scopeCount, scopeSpan) => scopeCount + (scopeSpan.spans?.length ?? 0),
				0,
			),
		0,
	);
	assert.equal(storedSpanCount, 2);
	await provider.shutdown();
});

test("storage failures are returned through the exporter callback", async () => {
	class FailingStore extends MemoryObjectStore {
		override async putJson(): Promise<void> {
			throw new Error("object store unavailable");
		}
	}

	const exporter = new AgentPondSpanExporter({
		store: new FailingStore(),
		projectId: "project-a",
	});
	const result = await exportSpans(exporter, await readableSpans());

	assert.equal(result.code, ExportResultCode.FAILED);
	assert.match(result.error?.message ?? "", /object store unavailable/);
	await exporter.shutdown();
});

test("serialization failures are returned through the exporter callback", async () => {
	const store = new MemoryObjectStore();
	const exporter = new AgentPondSpanExporter({
		store,
		projectId: "project-a",
	});

	const result = await exportSpans(exporter, [{} as ReadableSpan]);

	assert.equal(result.code, ExportResultCode.FAILED);
	assert.ok(result.error);
	assert.deepEqual(store.writes, []);
	await exporter.shutdown();
});

test("forceFlush and shutdown wait for concurrent object writes", async () => {
	let releaseWrites: () => void = () => undefined;
	const writesReleased = new Promise<void>((resolve) => {
		releaseWrites = resolve;
	});
	let startedWrites = 0;
	let markWritesStarted: () => void = () => undefined;
	const writesStarted = new Promise<void>((resolve) => {
		markWritesStarted = resolve;
	});

	class DelayedStore extends MemoryObjectStore {
		override async putJson(key: string, value: unknown): Promise<void> {
			startedWrites += 1;
			if (startedWrites === 2) markWritesStarted();
			await writesReleased;
			await super.putJson(key, value);
		}
	}

	const store = new DelayedStore();
	const exporter = new AgentPondSpanExporter({
		store,
		projectId: "project-a",
	});
	const spans = await readableSpans();
	const results: ExportResult[] = [];
	exporter.export(spans, (result) => results.push(result));
	exporter.export(spans, (result) => results.push(result));
	await writesStarted;

	let flushed = false;
	const flush = exporter.forceFlush().then(() => {
		flushed = true;
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(flushed, false);

	releaseWrites();
	await flush;
	assert.equal(flushed, true);
	assert.deepEqual(
		results.map((result) => result.code),
		[ExportResultCode.SUCCESS, ExportResultCode.SUCCESS],
	);
	assert.equal((await store.listKeys("otel/project-a/")).length, 2);

	const firstShutdown = exporter.shutdown();
	const secondShutdown = exporter.shutdown();
	assert.equal(firstShutdown, secondShutdown);
	await firstShutdown;
	const afterShutdown = await exportSpans(exporter, spans);
	assert.equal(afterShutdown.code, ExportResultCode.FAILED);
	assert.match(afterShutdown.error?.message ?? "", /shut down/);
	assert.equal((await store.listKeys("otel/project-a/")).length, 2);
});

test("Langfuse and OpenInference traces export to object storage and sync through the CLI", async () => {
	const originalCwd = process.cwd();
	const originalExitCode = process.exitCode;
	const root = mkdtempSync(join(tmpdir(), "agentpond-direct-otel-"));
	const environmentName = "direct-object-store";
	let langfuseTraceId: string | undefined;
	try {
		process.chdir(root);
		process.exitCode = undefined;
		initAgentPondEnvironment(environmentName, {
			cwd: root,
			storeType: "local",
		});
		const config = configFromEnv({ cwd: root, envName: environmentName });
		assert.ok(config.environment);
		const store = FileSystemObjectStore.fromEnvironment(config.environment);

		const langfuseExporter = new AgentPondSpanExporter({
			store,
			projectId: config.projectId,
			prefix: config.prefix,
		});
		const langfuseProcessor = new LangfuseSpanProcessor({
			exporter: langfuseExporter,
			flushAt: 1,
		});
		const langfuseSdk = new NodeSDK({
			spanProcessors: [langfuseProcessor],
		});
		langfuseSdk.start();
		try {
			await startActiveObservation("direct Langfuse trace", async (trace) => {
				langfuseTraceId = getActiveTraceId();
				trace.update({
					input: { question: "Can traces skip the ingestion service?" },
				});
				await startActiveObservation(
					"direct Langfuse generation",
					async (generation) => {
						generation.update({
							model: "gpt-test",
							input: [{ role: "user", content: "Answer directly" }],
							output: { answer: "Yes, by using the object-store exporter." },
						});
					},
					{ asType: "generation" },
				);
				trace.update({
					output: { answer: "The trace was stored without HTTP ingestion." },
				});
			});
		} finally {
			await langfuseProcessor.forceFlush();
			await langfuseSdk.shutdown();
		}
		assert.ok(langfuseTraceId);

		const openInferenceExporter = new AgentPondSpanExporter({
			store,
			projectId: config.projectId,
			prefix: config.prefix,
		});
		const openInferenceProvider = new BasicTracerProvider({
			spanProcessors: [new SimpleSpanProcessor(openInferenceExporter)],
		});
		const openInferenceTracer = new OITracer({
			tracer: openInferenceProvider.getTracer(
				"openinference.instrumentation.openai",
			),
		});
		const openInferenceSpan = openInferenceTracer.startSpan(
			"direct OpenInference generation",
			{
				attributes: {
					"openinference.span.kind": "LLM",
					"input.mime_type": "application/json",
					"input.value": JSON.stringify({ prompt: "Answer directly" }),
					"output.mime_type": "application/json",
					"output.value": JSON.stringify({ answer: "Stored directly" }),
				},
			},
		);
		const openInferenceTraceId = openInferenceSpan.spanContext().traceId;
		openInferenceSpan.end();
		await openInferenceProvider.shutdown();

		const otelKeys = await store.listKeys(`otel/${config.projectId}/`);
		assert.equal(otelKeys.length, 3);
		assert.deepEqual(
			await store.listKeys(`${config.projectId}/manifests/`),
			[],
		);

		const syncOutput = await captureStdout(() =>
			main(["node", "agentpond", "sync", "--env", environmentName, "--json"], {
				updateCheck: false,
			}),
		);
		const syncResult = JSON.parse(syncOutput) as {
			objectsProcessed: number;
			eventsProcessed: number;
		};
		assert.equal(process.exitCode, undefined);
		assert.equal(syncResult.objectsProcessed, 3);
		assert.ok(syncResult.eventsProcessed >= 5);

		const langfuseTraceOutput = await captureStdout(() =>
			main(
				[
					"node",
					"agentpond",
					"traces",
					"get",
					langfuseTraceId ?? "",
					"--env",
					environmentName,
					"--json",
				],
				{ updateCheck: false },
			),
		);
		const langfuseTraces = JSON.parse(langfuseTraceOutput) as Array<{
			id: string;
			name: string;
			input_json: string;
			output_json: string;
		}>;
		assert.equal(langfuseTraces.length, 1);
		assert.equal(langfuseTraces[0].id, langfuseTraceId);
		assert.equal(langfuseTraces[0].name, "direct Langfuse trace");
		assert.deepEqual(JSON.parse(langfuseTraces[0].input_json), {
			question: "Can traces skip the ingestion service?",
		});
		assert.deepEqual(JSON.parse(langfuseTraces[0].output_json), {
			answer: "The trace was stored without HTTP ingestion.",
		});

		const langfuseObservationsOutput = await captureStdout(() =>
			main(
				[
					"node",
					"agentpond",
					"observations",
					"list",
					"--traceId",
					langfuseTraceId ?? "",
					"--env",
					environmentName,
					"--json",
				],
				{ updateCheck: false },
			),
		);
		const langfuseObservations = JSON.parse(
			langfuseObservationsOutput,
		) as Array<{
			name: string;
			type: string;
			parent_observation_id: string | null;
			input_json: string | null;
			output_json: string | null;
		}>;
		const generation = langfuseObservations.find(
			(observation) => observation.name === "direct Langfuse generation",
		);
		assert.ok(generation);
		assert.equal(generation.type, "generation-create");
		assert.ok(generation.parent_observation_id);
		assert.deepEqual(JSON.parse(generation.input_json ?? "null"), [
			{ role: "user", content: "Answer directly" },
		]);
		assert.deepEqual(JSON.parse(generation.output_json ?? "null"), {
			answer: "Yes, by using the object-store exporter.",
		});

		const openInferenceObservationsOutput = await captureStdout(() =>
			main(
				[
					"node",
					"agentpond",
					"observations",
					"list",
					"--traceId",
					openInferenceTraceId,
					"--env",
					environmentName,
					"--json",
				],
				{ updateCheck: false },
			),
		);
		const openInferenceObservations = JSON.parse(
			openInferenceObservationsOutput,
		) as Array<{ type: string; name: string; metadata_json: string }>;
		assert.equal(openInferenceObservations.length, 1);
		assert.equal(openInferenceObservations[0].type, "generation-create");
		assert.equal(
			openInferenceObservations[0].name,
			"direct OpenInference generation",
		);
		assert.equal(
			JSON.parse(openInferenceObservations[0].metadata_json)[
				"openinference.span.kind"
			],
			"LLM",
		);
	} finally {
		process.chdir(originalCwd);
		process.exitCode = originalExitCode;
	}
});
