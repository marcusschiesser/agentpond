import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import {
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BasicTracerProvider,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Files } from "files-sdk";
import { minio } from "files-sdk/minio";
import { main } from "../../../apps/cli/src/index.js";
import { createFilesSpanExporter } from "../src/otel.js";

const bucket = "agentpond";
const endpoint = "http://127.0.0.1:9000";
const projectId = "files-sdk-minio-e2e";
const repositoryRoot = realpathSync(
	join(dirname(fileURLToPath(import.meta.url)), "../../.."),
);

const managedEnvironmentVariables = [
	"AGENTPOND_FILES_BUCKET",
	"AGENTPOND_PREFIX",
	"AGENTPOND_PROJECT_ID",
	"FILES_SDK_ENDPOINT",
	"FILES_SDK_PROVIDER",
	"FILES_SDK_ROOT",
	"MINIO_ACCESS_KEY_ID",
	"MINIO_SECRET_ACCESS_KEY",
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

async function availablePort(): Promise<number> {
	const server = createServer();
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const port = address.port;
	server.close();
	await once(server, "close");
	return port;
}

async function waitForHealth(
	url: string,
	child: ChildProcess,
	stderr: () => string,
): Promise<void> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) {
			throw new Error(
				`ingest service exited with ${child.exitCode}: ${stderr()}`,
			);
		}
		try {
			const response = await fetch(url);
			if (response.ok) return;
		} catch {
			// The server has not bound its port yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`ingest service did not become healthy: ${stderr()}`);
}

async function stopChild(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) return;
	child.kill("SIGTERM");
	await once(child, "exit");
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
	let files: Files<ReturnType<typeof minio>> | undefined;
	const storedKeys: string[] = [];

	try {
		for (const name of managedEnvironmentVariables) {
			delete process.env[name];
		}
		process.env.MINIO_ACCESS_KEY_ID = "minio";
		process.env.MINIO_SECRET_ACCESS_KEY = "minio123";

		files = new Files({
			adapter: minio({
				bucket,
				endpoint,
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
					"test.storage.provider": "minio",
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
			"--provider",
			"minio",
			"--bucket",
			bucket,
			"--endpoint",
			endpoint,
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

test("ingests an OTLP trace over HTTP through Files SDK and syncs it back through the CLI", {
	timeout: 60_000,
}, async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-http-minio-e2e-")),
	);
	const prefix = `e2e/${randomUUID()}`;
	const httpProjectId = "files-sdk-http-minio-e2e";
	const objectPrefix = `${prefix}/otel/${httpProjectId}/`;
	const traceId = randomBytes(16).toString("hex");
	const spanId = randomBytes(8).toString("hex");
	const originalExitCode = process.exitCode;
	const originalEnvironment = new Map(
		managedEnvironmentVariables.map((name) => [name, process.env[name]]),
	);
	const port = await availablePort();
	let stderr = "";
	let child: ChildProcess | undefined;
	let files: Files<ReturnType<typeof minio>> | undefined;
	const storedKeys: string[] = [];

	try {
		for (const name of managedEnvironmentVariables) {
			delete process.env[name];
		}
		process.env.MINIO_ACCESS_KEY_ID = "minio";
		process.env.MINIO_SECRET_ACCESS_KEY = "minio123";

		files = new Files({
			adapter: minio({ bucket, endpoint }),
			retries: 3,
			timeout: 10_000,
		});
		child = spawn(
			process.execPath,
			["--import", "tsx", join(repositoryRoot, "apps/ingest/src/index.ts")],
			{
				cwd: repositoryRoot,
				env: {
					...process.env,
					AGENTPOND_FILES_BUCKET: bucket,
					AGENTPOND_PREFIX: prefix,
					AGENTPOND_PROJECT_ID: httpProjectId,
					FILES_SDK_ENDPOINT: endpoint,
					FILES_SDK_PROVIDER: "minio",
					HOST: "127.0.0.1",
					LANGFUSE_PUBLIC_KEY: "pk-agentpond",
					LANGFUSE_SECRET_KEY: "sk-agentpond",
					MINIO_ACCESS_KEY_ID: "minio",
					MINIO_SECRET_ACCESS_KEY: "minio123",
					PORT: String(port),
				},
				stdio: ["ignore", "ignore", "pipe"],
			},
		);
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});
		await waitForHealth(`http://127.0.0.1:${port}/health`, child, () => stderr);

		const response = await fetch(
			`http://127.0.0.1:${port}/api/public/otel/v1/traces`,
			{
				method: "POST",
				headers: {
					authorization: `Basic ${Buffer.from(
						"pk-agentpond:sk-agentpond",
					).toString("base64")}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					resourceSpans: [
						{
							resource: {
								attributes: [
									{
										key: "service.name",
										value: { stringValue: "agentpond-http-minio-e2e" },
									},
								],
							},
							scopeSpans: [
								{
									scope: { name: "agentpond-http-minio-e2e" },
									spans: [
										{
											traceId,
											spanId,
											name: "HTTP Files SDK MinIO E2E trace",
											startTimeUnixNano: "1781395200000000000",
											endTimeUnixNano: "1781395201000000000",
										},
									],
								},
							],
						},
					],
				}),
			},
		);
		assert.equal(response.status, 200, await response.text());

		for await (const file of files.listAll({ prefix: objectPrefix })) {
			storedKeys.push(file.key);
		}
		assert.equal(storedKeys.length, 1);

		process.chdir(root);
		const initialized = (await runCliJson([
			"env",
			"init",
			"http-minio-e2e",
			"--provider",
			"minio",
			"--bucket",
			bucket,
			"--endpoint",
			endpoint,
		])) as { envFile: string };
		const environmentFile = readFileSync(initialized.envFile, "utf8")
			.replace(
				/^AGENTPOND_PROJECT_ID=.*$/m,
				`AGENTPOND_PROJECT_ID=${httpProjectId}`,
			)
			.replace(/^AGENTPOND_PREFIX=.*$/m, `AGENTPOND_PREFIX=${prefix}`);
		writeFileSync(initialized.envFile, environmentFile, "utf8");

		await runCliJson(["env", "use", "http-minio-e2e"]);
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
			[{ id: traceId, name: "HTTP Files SDK MinIO E2E trace" }],
		);
	} finally {
		process.chdir(cwd);
		if (child) await stopChild(child);
		if (files && storedKeys.length > 0) {
			const deleted = await files.delete(storedKeys);
			assert.deepEqual(deleted.errors ?? [], []);
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
