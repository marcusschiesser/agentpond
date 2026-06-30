import { performance } from "node:perf_hooks";
import { S3ObjectStore } from "@agentpond/aws";
import { sinkFromStore } from "@agentpond/core";
import { AgentPondCache } from "@agentpond/duckdb";
import { buildServer } from "@agentpond/fastify-ingest";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
	assertEmptyPrefix,
	buildConfig,
	configureLangfuseEnv,
	parseArgs,
	runIdFromPrefix,
} from "./args.js";
import { expectedSpanCount, generateLoad } from "./load.js";
import {
	createLoadProgressLogger,
	createSyncProgressLogger,
	logSeparator,
	logStep,
} from "./progress.js";
import { collectStorageStats } from "./storage-stats.js";
import { countTraces, formatDuration, timeSync } from "./sync.js";

async function main(argv = process.argv.slice(2)): Promise<void> {
	const args = parseArgs(argv);
	const config = buildConfig(args);
	const store = new S3ObjectStore(args.s3);

	logStep(
		`starting Langfuse sync benchmark with ${args.traces} traces and prefix ${args.prefix}`,
	);
	await assertEmptyPrefix(store, args.prefix);
	logStep("confirmed S3 prefix is empty");

	process.env.NODE_ENV = "test";
	const server = buildServer({ config, sink: sinkFromStore(store) });
	const address = await server.listen({ host: "127.0.0.1", port: 0 });
	configureLangfuseEnv(address, args);
	logStep(`started in-process ingestion server at ${address}`);

	const expectedSpans = expectedSpanCount(args.traces);
	configureOtelQueue(expectedSpans);
	logStep(`configured OpenTelemetry span queue for ${expectedSpans} spans`);

	const spanProcessor = new LangfuseSpanProcessor();
	const sdk = new NodeSDK({
		spanProcessors: [spanProcessor],
	});
	const db = new AgentPondCache(args.dbPath);

	let generatedTraces = 0;
	const ingestionStarted = performance.now();
	try {
		logSeparator("Tracing");
		sdk.start();
		generatedTraces = await generateLoad(
			args.traces,
			createLoadProgressLogger(),
			async () => spanProcessor.forceFlush(),
		);
		await sdk.shutdown();
		logStep(
			`tracing finished in ${formatDuration(performance.now() - ingestionStarted)}`,
		);

		logStep("collecting S3 object size stats");
		const storage = await collectStorageStats(
			store,
			args.prefix,
			args.projectId,
		);
		logStep(
			`storage contains ${storage.objectCount} OTEL objects and ${storage.manifestCount} non-OTEL manifests`,
		);
		logSeparator("Initial Sync");
		const firstSync = await timeSync(
			db,
			store,
			args,
			createSyncProgressLogger("initial"),
		);
		logStep(
			`initial sync finished in ${formatDuration(firstSync.durationMs)}: ` +
				`${firstSync.result.objectsProcessed} objects, ` +
				`${firstSync.result.eventsProcessed} events`,
		);
		logSeparator("No-op Sync");
		const secondSync = await timeSync(
			db,
			store,
			args,
			createSyncProgressLogger("noop"),
		);
		logStep(
			`no-op sync finished in ${formatDuration(secondSync.durationMs)}: ` +
				`${secondSync.result.objectsProcessed} objects, ` +
				`${secondSync.result.eventsProcessed} events`,
		);
		const traceCount = await countTraces(db);

		if (generatedTraces !== args.traces) {
			throw new Error(
				`Generated ${generatedTraces} traces, expected ${args.traces}`,
			);
		}
		if (firstSync.result.objectsProcessed === 0) {
			throw new Error("Initial sync processed zero objects");
		}
		if (secondSync.result.objectsProcessed !== 0) {
			throw new Error(
				`No-op sync processed ${secondSync.result.objectsProcessed} objects`,
			);
		}
		if (traceCount !== args.traces) {
			throw new Error(
				`DuckDB contains ${traceCount} traces, expected ${args.traces}`,
			);
		}
		logStep(
			`completed run ${runIdFromPrefix(args.prefix)}: ${traceCount} traces synced to ${args.dbPath}`,
		);
	} finally {
		await db.close();
		await server.close();
	}
}

function configureOtelQueue(expectedSpans: number): void {
	const configured = Number.parseInt(
		process.env.OTEL_BSP_MAX_QUEUE_SIZE ?? "",
		10,
	);
	if (Number.isFinite(configured) && configured >= expectedSpans) return;
	process.env.OTEL_BSP_MAX_QUEUE_SIZE = String(expectedSpans);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
