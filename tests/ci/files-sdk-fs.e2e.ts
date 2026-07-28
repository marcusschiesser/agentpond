import assert from "node:assert/strict";
import {
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseEnvFile } from "@agentpond/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BasicTracerProvider,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { main } from "../../apps/cli/src/index.js";
import { createFilesSpanExporterFromRuntimeEnv } from "../../packages/files-sdk/src/otel.js";

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

async function runCliJson(args: string[]): Promise<unknown> {
	process.exitCode = undefined;
	const output = await captureStdout(() =>
		main(["node", "agentpond", ...args, "--json"], { updateCheck: false }),
	);
	assert.equal(process.exitCode, undefined);
	return JSON.parse(output);
}

test("exports a trace through Files SDK fs and syncs it back through the CLI", async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-files-sdk-fs-e2e-")),
	);
	const storageRoot = join(root, ".agentpond", "envs", "local", "objects");
	const projectId = "files-sdk-fs-e2e";
	const prefix = "e2e/fs";
	const originalExitCode = process.exitCode;

	try {
		process.chdir(root);
		const initialized = (await runCliJson([
			"env",
			"init",
			"local",
			"--provider",
			"fs",
			"--root",
			storageRoot,
		])) as { envFile: string };
		const environmentFile = readFileSync(initialized.envFile, "utf8")
			.replace(
				/^AGENTPOND_PROJECT_ID=.*$/m,
				`AGENTPOND_PROJECT_ID=${projectId}`,
			)
			.replace(/^AGENTPOND_PREFIX=.*$/m, `AGENTPOND_PREFIX=${prefix}`);
		writeFileSync(initialized.envFile, environmentFile, "utf8");

		const exporter = createFilesSpanExporterFromRuntimeEnv({
			env: parseEnvFile(initialized.envFile),
		});
		const provider = new BasicTracerProvider({
			resource: resourceFromAttributes({
				"service.name": "agentpond-files-sdk-fs-e2e",
			}),
			spanProcessors: [new SimpleSpanProcessor(exporter)],
		});
		const span = provider
			.getTracer("agentpond-files-sdk-fs-e2e")
			.startSpan("Files SDK filesystem E2E trace", {
				attributes: {
					"openinference.span.kind": "LLM",
					"test.storage.provider": "fs",
				},
			});
		const traceId = span.spanContext().traceId;
		span.end();
		await provider.forceFlush();
		await provider.shutdown();

		await runCliJson(["env", "use", "local"]);
		const sync = (await runCliJson(["sync"])) as {
			eventsProcessed: number;
			objectsProcessed: number;
		};
		assert.equal(sync.objectsProcessed, 1);
		assert.equal(sync.eventsProcessed, 2);

		const traces = (await runCliJson(["traces", "get", traceId])) as Array<{
			id: string;
			name: string;
		}>;
		assert.deepEqual(
			traces.map(({ id, name }) => ({ id, name })),
			[{ id: traceId, name: "Files SDK filesystem E2E trace" }],
		);
	} finally {
		process.chdir(cwd);
		rmSync(root, { recursive: true, force: true });
		process.exitCode = originalExitCode;
	}
});
