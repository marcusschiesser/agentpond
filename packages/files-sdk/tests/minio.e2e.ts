import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BasicTracerProvider,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Files } from "files-sdk";
import { s3 } from "files-sdk/s3";
import { main } from "../../../apps/cli/src/index.js";
import { createFilesSpanExporter } from "../src/otel.js";

const bucket = "agentpond";
const endpoint = "http://127.0.0.1:9000";
const projectId = "files-sdk-minio-e2e";

const managedEnvironmentVariables = [
	"AGENTPOND_FILES_BUCKET",
	"AGENTPOND_PREFIX",
	"AGENTPOND_PROJECT_ID",
	"AGENTPOND_STORE",
	"AWS_ACCESS_KEY_ID",
	"AWS_EC2_METADATA_DISABLED",
	"AWS_ENDPOINT_URL_S3",
	"AWS_REGION",
	"AWS_SECRET_ACCESS_KEY",
	"FILES_SDK_PROVIDER",
] as const;

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

test("exports a trace through Files SDK to MinIO and syncs it back through the CLI", {
	timeout: 60_000,
}, async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-files-sdk-minio-e2e-")),
	);
	const prefix = `e2e/${randomUUID()}`;
	const objectPrefix = `${prefix}/otel/${projectId}/`;
	const originalExitCode = process.exitCode;
	const originalEnvironment = new Map(
		managedEnvironmentVariables.map((name) => [name, process.env[name]]),
	);
	let files: Files<ReturnType<typeof s3>> | undefined;
	const storedKeys: string[] = [];

	try {
		for (const name of managedEnvironmentVariables) {
			delete process.env[name];
		}
		process.env.AWS_ACCESS_KEY_ID = "minio";
		process.env.AWS_SECRET_ACCESS_KEY = "minio123";
		process.env.AWS_REGION = "us-east-1";
		process.env.AWS_ENDPOINT_URL_S3 = endpoint;
		process.env.AWS_EC2_METADATA_DISABLED = "true";

		files = new Files({
			adapter: s3({
				bucket,
				endpoint,
				forcePathStyle: true,
				region: "us-east-1",
			}),
			retries: 3,
			timeout: 10_000,
		});
		const exporter = createFilesSpanExporter({
			files,
			projectId,
			prefix,
		});
		const provider = new BasicTracerProvider({
			resource: resourceFromAttributes({
				"service.name": "agentpond-files-sdk-minio-e2e",
			}),
			spanProcessors: [new SimpleSpanProcessor(exporter)],
		});
		const span = provider
			.getTracer("agentpond-files-sdk-minio-e2e")
			.startSpan("Files SDK MinIO E2E trace", {
				attributes: {
					"openinference.span.kind": "LLM",
					"test.storage.provider": "s3-on-minio",
				},
			});
		const traceId = span.spanContext().traceId;
		span.end();
		await provider.forceFlush();
		await provider.shutdown();

		for await (const file of files.listAll({ prefix: objectPrefix })) {
			storedKeys.push(file.key);
		}
		assert.equal(storedKeys.length, 1);
		assert.match(
			storedKeys[0],
			new RegExp(
				`^${objectPrefix}\\d{4}/\\d{2}/\\d{2}/\\d{2}/\\d{2}/[0-9a-f-]+\\.json$`,
			),
		);

		process.chdir(root);
		const initialized = (await runCliJson([
			"env",
			"init",
			"minio-e2e",
			"--store",
			"files-sdk",
			"--provider",
			"s3",
			"--bucket",
			bucket,
		])) as { envFile: string };
		const environmentFile = readFileSync(initialized.envFile, "utf8")
			.replace(
				/^AGENTPOND_PROJECT_ID=.*$/m,
				`AGENTPOND_PROJECT_ID=${projectId}`,
			)
			.replace(/^AGENTPOND_PREFIX=.*$/m, `AGENTPOND_PREFIX=${prefix}`);
		writeFileSync(initialized.envFile, environmentFile, "utf8");

		await runCliJson(["env", "use", "minio-e2e"]);
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
			[{ id: traceId, name: "Files SDK MinIO E2E trace" }],
		);
	} finally {
		process.chdir(cwd);
		if (files && storedKeys.length > 0) {
			const deleted = await files.delete(storedKeys);
			assert.deepEqual(deleted.errors ?? [], []);
			const remainingKeys: string[] = [];
			for await (const file of files.listAll({ prefix: objectPrefix })) {
				remainingKeys.push(file.key);
			}
			assert.deepEqual(remainingKeys, []);
		}
		rmSync(root, { recursive: true, force: true });
		for (const [name, value] of originalEnvironment) {
			if (value === undefined) {
				delete process.env[name];
			} else {
				process.env[name] = value;
			}
		}
		process.exitCode = originalExitCode;
	}
});
