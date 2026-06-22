import { performance } from "node:perf_hooks";
import { S3ObjectStore } from "@agentpond/core";
import { AgentPondDuckDb } from "@agentpond/duckdb";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { buildServer } from "../../../apps/ingest/src/server.js";
import {
	assertEmptyPrefix,
	buildConfig,
	configureLangfuseEnv,
	parseArgs,
	runIdFromPrefix,
} from "./args.js";
import { generateLoad } from "./load.js";
import {
	createLoadProgressLogger,
	createSyncProgressLogger,
	logStep,
} from "./progress.js";
import { collectStorageStats } from "./storage-stats.js";
import { countTraces, formatSyncTiming, roundMs, timeSync } from "./sync.js";

async function main(argv = process.argv.slice(2)): Promise<void> {
	const args = parseArgs(argv);
	const config = buildConfig(args);
	const store = new S3ObjectStore(config.s3);

	logStep(
		`starting Langfuse sync benchmark with ${args.traces} traces and prefix ${args.prefix}`,
	);
	await assertEmptyPrefix(store, args.prefix);
	logStep("confirmed S3 prefix is empty");

	process.env.NODE_ENV = "test";
	const server = buildServer({ config, store });
	const address = await server.listen({ host: "127.0.0.1", port: 0 });
	configureLangfuseEnv(address, args);
	logStep(`started in-process ingestion server at ${address}`);

	const sdk = new NodeSDK({
		spanProcessors: [new LangfuseSpanProcessor()],
	});
	const db = new AgentPondDuckDb(args.dbPath);

	let generatedTraces = 0;
	const ingestionStarted = performance.now();
	try {
		sdk.start();
		generatedTraces = await generateLoad(
			args.traces,
			createLoadProgressLogger(),
		);
		logStep("flushing OpenTelemetry spans");
		await sdk.shutdown();
		logStep(
			`finished ingestion in ${roundMs(performance.now() - ingestionStarted)}ms`,
		);

		const ingestionDurationMs = performance.now() - ingestionStarted;
		logStep("collecting S3 manifest and object size stats");
		const storage = await collectStorageStats(
			store,
			args.prefix,
			args.projectId,
		);
		logStep(
			`storage contains ${storage.manifestCount} manifests and ${storage.objectCount} objects`,
		);
		logStep("starting initial DuckDB sync");
		const firstSync = await timeSync(
			db,
			store,
			args,
			createSyncProgressLogger("initial"),
		);
		logStep("starting no-op DuckDB sync");
		const secondSync = await timeSync(
			db,
			store,
			args,
			createSyncProgressLogger("noop"),
		);
		const traceCount = await countTraces(db);

		if (generatedTraces !== args.traces) {
			throw new Error(
				`Generated ${generatedTraces} traces, expected ${args.traces}`,
			);
		}
		if (firstSync.result.manifestsProcessed === 0) {
			throw new Error("Initial sync processed zero manifests");
		}
		if (secondSync.result.manifestsProcessed !== 0) {
			throw new Error(
				`No-op sync processed ${secondSync.result.manifestsProcessed} manifests`,
			);
		}
		if (traceCount !== args.traces) {
			throw new Error(
				`DuckDB contains ${traceCount} traces, expected ${args.traces}`,
			);
		}

		printResult({
			runId: runIdFromPrefix(args.prefix),
			requestedTraceCount: args.traces,
			generatedTraceCount: generatedTraces,
			s3Prefix: args.prefix,
			dbPath: args.dbPath,
			...storage,
			timings: {
				ingestionGenerateAndSendMs: roundMs(ingestionDurationMs),
				initialSync: formatSyncTiming(firstSync),
				noopSync: formatSyncTiming(secondSync),
			},
		});
	} finally {
		await db.close();
		await server.close();
	}
}

function printResult(value: unknown): void {
	console.log(
		JSON.stringify(
			value,
			(_key, item) => (typeof item === "bigint" ? item.toString() : item),
			2,
		),
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
