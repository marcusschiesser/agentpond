import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	type AgentPondConfig,
	type AgentPondStorageContext,
	acquireDevServerLock,
	eventTypes,
	type IngestionEvent,
	initAgentPondEnvironment,
	MemoryObjectStore,
	type ObjectStore,
} from "@agentpond/core";
import { AgentPondCache } from "@agentpond/duckdb";
import {
	FIREBASE_INSTRUMENTATION_PROMPT,
	FirebaseStorageObjectStore,
	firebaseProvider,
} from "@agentpond/firebase";
import { VERCEL_INSTRUMENTATION_PROMPT } from "@agentpond/vercel";
import { configForCommand } from "../src/command-support.js";
import {
	createDevLoggerOptions,
	listenOnAvailablePort,
} from "../src/commands/dev.js";
import {
	agentPondInitHeader,
	installSkillsWithBundledCli,
	MANUAL_SETUP_URL,
	type SkillsInstallRequest,
	type SkillsProcessRequest,
} from "../src/commands/init.js";
import { environmentContextForCommand } from "../src/environment-context.js";
import { CLI_VERSION, createOtelTraceId, main } from "../src/index.js";
import { manualTraceResourceSpans } from "../src/otel-trace.js";
import { writeEventsAndSyncCache } from "../src/sync-write.js";
import {
	checkForCliUpdate,
	isNewerVersion,
	shouldCheckForUpdates,
} from "../src/update-check.js";

async function captureStdout(fn: () => Promise<void>): Promise<string> {
	const consoleLog = console.log;
	const consoleTable = console.table;
	const chunks: string[] = [];
	console.log = (...args: unknown[]) => {
		chunks.push(`${args.map(String).join(" ")}\n`);
	};
	console.table = (tabularData?: unknown) => {
		chunks.push(`${JSON.stringify(tabularData)}\n`);
	};
	try {
		await fn();
	} finally {
		console.log = consoleLog;
		console.table = consoleTable;
	}
	return chunks.join("");
}

async function captureStderr(fn: () => Promise<void>): Promise<string> {
	const consoleError = console.error;
	const chunks: string[] = [];
	console.error = (...args: unknown[]) => {
		chunks.push(`${args.map(String).join(" ")}\n`);
	};
	try {
		await fn();
	} finally {
		console.error = consoleError;
	}
	return chunks.join("");
}

async function captureProcessStdout(fn: () => Promise<void>): Promise<string> {
	const write = process.stdout.write;
	const chunks: string[] = [];
	process.stdout.write = ((chunk: string | Uint8Array) => {
		chunks.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
	try {
		await fn();
	} finally {
		process.stdout.write = write;
	}
	return chunks.join("");
}

function testConfig(dbPath: string): AgentPondConfig {
	return {
		projectId: "default-project",
		dbPath,
		prefix: "",
	};
}

function testStorageContext(
	config: AgentPondConfig,
	store: ObjectStore,
): AgentPondStorageContext {
	return {
		store,
		projectId: config.projectId,
		prefix: config.prefix,
	};
}

function devDbPath(root: string): string {
	return join(root, ".agentpond", "envs", "dev", "cache.duckdb");
}

test("CLI init installs AgentPond skills for a nested Firebase project", async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-init-firebase-")),
	);
	const nested = join(root, "packages", "functions");
	const originalExitCode = process.exitCode;
	let request: SkillsInstallRequest | undefined;
	process.exitCode = undefined;
	try {
		mkdirSync(nested, { recursive: true });
		writeFileSync(
			join(root, ".firebaserc"),
			JSON.stringify({ projects: { default: "firebase-demo" } }),
			"utf8",
		);
		writeFileSync(
			join(root, "firebase.json"),
			JSON.stringify({ functions: { source: "packages/functions" } }),
			"utf8",
		);
		process.chdir(nested);

		const output = await captureStdout(() =>
			main(["node", "agentpond", "init"], {
				installSkills: async (installRequest) => {
					request = installRequest;
				},
			}),
		);

		assert.equal(process.exitCode, undefined);
		assert.deepEqual(request, {
			cwd: root,
			source: "marcusschiesser/agentpond",
			skills: ["agentpond-instrumentation", "agentpond"],
		});
		assert.equal(
			output,
			[
				agentPondInitHeader({
					displayName: "Firebase",
					projectLabel: "firebase-demo",
				}),
				"AgentPond skills ready for Firebase project: firebase-demo",
				"",
				"Paste this prompt into your coding agent:",
				"",
				FIREBASE_INSTRUMENTATION_PROMPT,
				"",
			].join("\n"),
		);
		assert.equal(existsSync(join(root, ".agentpond")), false);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI init detects a Firebase project from its root", async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-init-firebase-root-")),
	);
	const originalExitCode = process.exitCode;
	let installCwd: string | undefined;
	process.exitCode = undefined;
	try {
		writeFileSync(
			join(root, ".firebaserc"),
			JSON.stringify({ projects: { default: "firebase-root-demo" } }),
			"utf8",
		);
		process.chdir(root);

		await captureStdout(() =>
			main(["node", "agentpond", "init"], {
				installSkills: async (request) => {
					installCwd = request.cwd;
				},
			}),
		);

		assert.equal(process.exitCode, undefined);
		assert.equal(installCwd, root);
		assert.equal(existsSync(join(root, ".agentpond")), false);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI init follows Firebase CLI global active project selections", async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-init-firebase-active-")),
	);
	const configHome = mkdtempSync(
		join(tmpdir(), "agentpond-cli-init-firebase-config-"),
	);
	const originalConfigHome = process.env.XDG_CONFIG_HOME;
	const originalExitCode = process.exitCode;
	let installCwd: string | undefined;
	process.exitCode = undefined;
	try {
		mkdirSync(join(configHome, "configstore"), { recursive: true });
		writeFileSync(join(root, "firebase.json"), "{}", "utf8");
		writeFileSync(
			join(configHome, "configstore", "firebase-tools.json"),
			JSON.stringify({ activeProjects: { [root]: "firebase-active-demo" } }),
			"utf8",
		);
		process.env.XDG_CONFIG_HOME = configHome;
		process.chdir(root);

		const output = await captureStdout(() =>
			main(["node", "agentpond", "init"], {
				installSkills: async (request) => {
					installCwd = request.cwd;
				},
			}),
		);

		assert.equal(process.exitCode, undefined);
		assert.equal(installCwd, root);
		assert.match(
			output,
			/AgentPond skills ready for Firebase project: firebase-active-demo/,
		);
	} finally {
		if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = originalConfigHome;
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI init rejects unsupported projects without creating files", async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-init-non-firebase-")),
	);
	const originalExitCode = process.exitCode;
	let installerCalled = false;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "init"], {
				installSkills: async () => {
					installerCalled = true;
				},
			}),
		);

		assert.equal(process.exitCode, 2);
		assert.equal(installerCalled, false);
		assert.equal(
			stderr,
			[
				"Automatic AgentPond setup supports Firebase and Vercel projects.",
				"",
				"For AWS, Google Cloud, and other deployment setups, see:",
				MANUAL_SETUP_URL,
				"",
			].join("\n"),
		);
		assert.doesNotMatch(stderr, /local.*deployment/i);
		assert.equal(existsSync(join(root, ".agentpond")), false);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI init installs AgentPond skills for a linked Vercel project", async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-init-vercel-")),
	);
	const nested = join(root, "apps", "web");
	const originalExitCode = process.exitCode;
	let request: SkillsInstallRequest | undefined;
	process.exitCode = undefined;
	try {
		mkdirSync(join(root, ".vercel"), { recursive: true });
		mkdirSync(nested, { recursive: true });
		writeFileSync(
			join(root, ".vercel", "project.json"),
			JSON.stringify({ projectId: "prj_demo", projectName: "demo-web" }),
			"utf8",
		);
		process.chdir(nested);

		const output = await captureStdout(() =>
			main(["node", "agentpond", "init"], {
				installSkills: async (installRequest) => {
					request = installRequest;
				},
			}),
		);

		assert.equal(process.exitCode, undefined);
		assert.deepEqual(request, {
			cwd: root,
			source: "marcusschiesser/agentpond",
			skills: ["agentpond-instrumentation", "agentpond"],
		});
		assert.match(output, /AgentPond skills ready for Vercel project: demo-web/);
		assert.match(output, /createVercelSpanExporter/);
		assert.match(output, /do not add an ingestion route/);
		assert.equal(output.includes(VERCEL_INSTRUMENTATION_PROMPT), true);
		assert.equal(existsSync(join(root, ".agentpond")), false);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI init can force Vercel setup before the project is linked", async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-init-vercel-unlinked-")),
	);
	const originalExitCode = process.exitCode;
	let installCwd: string | undefined;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main(["node", "agentpond", "init", "--platform", "vercel"], {
				installSkills: async (request) => {
					installCwd = request.cwd;
				},
			}),
		);

		assert.equal(process.exitCode, undefined);
		assert.equal(installCwd, root);
		assert.match(output, /Vercel project: unlinked/);
		assert.equal(existsSync(join(root, ".agentpond")), false);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI init reports a missing explicitly selected provider project", async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-init-firebase-missing-")),
	);
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "init", "--platform", "firebase"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /No Firebase project was detected/);
		assert.equal(existsSync(join(root, ".agentpond")), false);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI init validates platform names against the provider registry", async () => {
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "init", "--platform", "unknown"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /--platform must be firebase or vercel/);
	} finally {
		process.exitCode = originalExitCode;
	}
});

test("CLI init requires an active Firebase project", async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-init-no-project-")),
	);
	const originalExitCode = process.exitCode;
	const originalProjectEnv = {
		FIREBASE_CONFIG: process.env.FIREBASE_CONFIG,
		GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
		GCP_PROJECT: process.env.GCP_PROJECT,
		GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
	};
	let installerCalled = false;
	process.exitCode = undefined;
	try {
		delete process.env.FIREBASE_CONFIG;
		delete process.env.GCLOUD_PROJECT;
		delete process.env.GCP_PROJECT;
		delete process.env.GOOGLE_CLOUD_PROJECT;
		writeFileSync(join(root, "firebase.json"), "{}", "utf8");
		process.chdir(root);

		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "init"], {
				installSkills: async () => {
					installerCalled = true;
				},
			}),
		);

		assert.equal(process.exitCode, 2);
		assert.equal(installerCalled, false);
		assert.match(stderr, /agentpond env use <alias-or-project-id>/);
		assert.equal(existsSync(join(root, ".agentpond")), false);
	} finally {
		for (const [key, value] of Object.entries(originalProjectEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI init rejects JSON output before installing skills", async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-init-json-")),
	);
	const originalExitCode = process.exitCode;
	let installerCalled = false;
	process.exitCode = undefined;
	try {
		writeFileSync(
			join(root, ".firebaserc"),
			JSON.stringify({ projects: { default: "firebase-demo" } }),
			"utf8",
		);
		process.chdir(root);

		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "init", "--json"], {
				installSkills: async () => {
					installerCalled = true;
				},
			}),
		);

		assert.equal(process.exitCode, 2);
		assert.equal(installerCalled, false);
		assert.match(stderr, /--json is not supported by npx agentpond init/);
		assert.equal(existsSync(join(root, ".agentpond")), false);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI init does not print a prompt when skill installation fails", async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-init-install-error-")),
	);
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		writeFileSync(
			join(root, ".firebaserc"),
			JSON.stringify({ projects: { default: "firebase-demo" } }),
			"utf8",
		);
		process.chdir(root);

		const output = await captureStdout(async () => {
			const stderr = await captureStderr(() =>
				main(["node", "agentpond", "init"], {
					installSkills: async () => {
						throw new Error("skill installation failed");
					},
				}),
			);
			assert.match(stderr, /skill installation failed/);
		});

		assert.equal(process.exitCode, 1);
		assert.equal(
			output,
			[
				agentPondInitHeader({
					displayName: "Firebase",
					projectLabel: "firebase-demo",
				}),
				"",
			].join("\n"),
		);
		assert.equal(existsSync(join(root, ".agentpond")), false);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI init invokes the bundled Skills CLI directly without agent flags", async () => {
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-skills-install-"));
	let processRequest: SkillsProcessRequest | undefined;
	await installSkillsWithBundledCli(
		{
			cwd: root,
			source: "marcusschiesser/agentpond",
			skills: ["agentpond-instrumentation", "agentpond"],
		},
		{
			cliPath: "/package/skills/bin/cli.mjs",
			run: async (request) => {
				processRequest = request;
				for (const skill of ["agentpond-instrumentation", "agentpond"]) {
					const skillDir = join(root, ".agents", "skills", skill);
					mkdirSync(skillDir, { recursive: true });
					writeFileSync(join(skillDir, "SKILL.md"), "---\n---\n", "utf8");
				}
				return 0;
			},
		},
	);

	assert.deepEqual(processRequest, {
		command: process.execPath,
		args: [
			"/package/skills/bin/cli.mjs",
			"add",
			"marcusschiesser/agentpond",
			"--skill",
			"agentpond-instrumentation",
			"--skill",
			"agentpond",
		],
		cwd: root,
	});
	assert.equal(processRequest?.args.includes("--agent"), false);
	assert.equal(processRequest?.args.includes("--yes"), false);
});

test("CLI init treats a cancelled Skills installation as incomplete", async () => {
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-skills-cancelled-"));

	await assert.rejects(
		installSkillsWithBundledCli(
			{ cwd: root, source: "test/source", skills: ["agentpond"] },
			{
				cliPath: "/package/skills/bin/cli.mjs",
				run: async () => 0,
			},
		),
		/installation was cancelled or did not complete.*agentpond/,
	);
});

test("CLI trace creation builds a Langfuse-compatible OTEL root span", () => {
	const resourceSpans = manualTraceResourceSpans(
		{
			name: "Manual Trace",
			userId: "user-1",
			sessionId: "session-1",
			input: '{"prompt":"hello"}',
			output: "done",
			metadata: '{"plan":"pro","attempt":2}',
		},
		"0123456789abcdef0123456789abcdef",
		"2026-06-14T11:03:19.419Z",
	) as Array<{
		scopeSpans: Array<{
			spans: Array<{
				traceId: string;
				spanId: string;
				name: string;
				startTimeUnixNano: string;
				endTimeUnixNano: string;
				attributes: Array<{
					key: string;
					value: {
						stringValue?: string;
						doubleValue?: number;
						boolValue?: boolean;
					};
				}>;
			}>;
		}>;
	}>;

	const span = resourceSpans[0].scopeSpans[0].spans[0];
	const attributes = new Map(
		span.attributes.map((attribute) => [attribute.key, attribute.value]),
	);

	assert.equal(span.traceId, "0123456789abcdef0123456789abcdef");
	assert.match(span.spanId, /^[0-9a-f]{16}$/);
	assert.equal(span.name, "Manual Trace");
	assert.equal(span.startTimeUnixNano, "1781434999419000000");
	assert.equal(span.endTimeUnixNano, "1781434999419000000");
	assert.deepEqual(attributes.get("langfuse.observation.type"), {
		stringValue: "span",
	});
	assert.deepEqual(attributes.get("langfuse.trace.name"), {
		stringValue: "Manual Trace",
	});
	assert.deepEqual(attributes.get("langfuse.environment"), {
		stringValue: "default",
	});
	assert.deepEqual(attributes.get("user.id"), { stringValue: "user-1" });
	assert.deepEqual(attributes.get("session.id"), {
		stringValue: "session-1",
	});
	assert.deepEqual(attributes.get("langfuse.trace.input"), {
		stringValue: '{"prompt":"hello"}',
	});
	assert.deepEqual(attributes.get("langfuse.observation.input"), {
		stringValue: '{"prompt":"hello"}',
	});
	assert.deepEqual(attributes.get("langfuse.trace.output"), {
		stringValue: "done",
	});
	assert.deepEqual(attributes.get("langfuse.observation.output"), {
		stringValue: "done",
	});
	assert.deepEqual(attributes.get("langfuse.trace.metadata.plan"), {
		stringValue: "pro",
	});
	assert.deepEqual(attributes.get("langfuse.trace.metadata.attempt"), {
		doubleValue: 2,
	});
});

test("CLI default trace ids are OTEL trace ids", () => {
	assert.match(createOtelTraceId(), /^[0-9a-f]{32}$/);
});

test("CLI exposes package version", async () => {
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		const output = await captureProcessStdout(() =>
			main(["node", "agentpond", "--version"]),
		);

		assert.equal(process.exitCode, 0);
		assert.equal(output.trim(), CLI_VERSION);
	} finally {
		process.exitCode = originalExitCode;
	}
});

test("CLI update check compares semver versions", () => {
	assert.equal(isNewerVersion("0.3.6", "0.3.5"), true);
	assert.equal(isNewerVersion("0.4.0", "0.3.5"), true);
	assert.equal(isNewerVersion("1.0.0", "0.3.5"), true);
	assert.equal(isNewerVersion("0.3.5", "0.3.5"), false);
	assert.equal(isNewerVersion("0.3.4", "0.3.5"), false);
	assert.equal(isNewerVersion("not-a-version", "0.3.5"), false);
});

test("CLI update check skips automation-friendly modes", () => {
	assert.equal(shouldCheckForUpdates(["node", "agentpond", "--json"]), false);
	assert.equal(shouldCheckForUpdates(["node", "agentpond", "--help"]), false);
	assert.equal(
		shouldCheckForUpdates(["node", "agentpond", "--version"]),
		false,
	);
	assert.equal(
		shouldCheckForUpdates(["node", "agentpond", "traces", "list"], {
			force: true,
		}),
		true,
	);
});

test("CLI update check asks before updating when a newer version exists", async () => {
	const root = mkdtempSync(join(tmpdir(), "agentpond-update-check-"));
	const calls: string[] = [];

	await captureStderr(() =>
		checkForCliUpdate(["node", "agentpond", "traces", "list"], "0.3.5", {
			cachePath: join(root, "update-check.json"),
			force: true,
			fetch: async () =>
				new Response(JSON.stringify({ version: "0.3.6" }), { status: 200 }),
			confirmUpdate: async (config) => {
				calls.push(config.message);
				calls.push(`default:${config.default}`);
				return true;
			},
			runUpdate: async (version) => {
				calls.push(`update:${version}`);
				return 0;
			},
		}),
	);

	assert.deepEqual(calls, [
		"AgentPond 0.3.6 is available. Update now with npm install -g agentpond@latest?",
		"default:false",
		"update:0.3.6",
	]);
});

test("CLI trace creation preserves nested metadata values", async () => {
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "agentpond-cli-")),
		"cache.duckdb",
	);
	const resourceSpans = manualTraceResourceSpans(
		{
			metadata: '{"details":{"tier":"pro"},"tags":["a","b"],"plain":"ok"}',
		},
		"0123456789abcdef0123456789abcdef",
		"2026-06-14T11:03:19.419Z",
	);
	const store = new MemoryObjectStore();
	await store.putJson(
		"otel/default-project/2026/06/14/11/03/batch-1.json",
		resourceSpans,
	);
	const db = new AgentPondCache(dbPath);
	await db.syncFromStore({
		store,
		projectId: "default-project",
		prefix: "",
	});
	const traces = await db.query<{ metadata_json: string }>(
		"SELECT metadata_json FROM traces WHERE id = '0123456789abcdef0123456789abcdef'",
	);
	await db.close();

	assert.deepEqual(JSON.parse(traces[0].metadata_json), {
		details: { tier: "pro" },
		tags: ["a", "b"],
		plain: "ok",
	});
});

test("CLI-created scores are immediately visible to score list queries", async () => {
	const store = new MemoryObjectStore();
	const dbPath = join(
		mkdtempSync(join(tmpdir(), "agentpond-cli-")),
		"cache.duckdb",
	);
	const config = testConfig(dbPath);
	const event: IngestionEvent = {
		id: "score-event-1",
		timestamp: "2026-06-14T11:03:19.419Z",
		type: eventTypes.SCORE_CREATE,
		body: {
			id: "score-1",
			traceId: "0",
			name: "quality",
			value: 0.9,
			source: "API",
			createdAt: "2026-06-14T11:03:19.419Z",
		},
	};

	await writeEventsAndSyncCache(config, testStorageContext(config, store), [
		event,
	]);

	const db = new AgentPondCache(dbPath);
	const rows = await db.query<{
		id: string;
		trace_id: string;
		name: string;
		value: number;
	}>("SELECT id, trace_id, name, value FROM scores WHERE trace_id = '0'");
	await db.close();

	assert.deepEqual(rows, [
		{ id: "score-1", trace_id: "0", name: "quality", value: 0.9 },
	]);
});

test("CLI trace and observation reads expose provided usage and cost fields as JSON", async () => {
	const store = new MemoryObjectStore();
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-"));
	const dbPath = devDbPath(root);
	const config = testConfig(dbPath);
	const events: IngestionEvent[] = [
		{
			id: "trace-event-1",
			timestamp: "2026-06-14T11:03:19.000Z",
			type: eventTypes.TRACE_CREATE,
			body: {
				id: "trace-1",
				name: "Trace 1",
				sessionId: "session-1",
				startTime: "2026-06-14T11:03:19.000Z",
			},
		},
		{
			id: "observation-event-1",
			timestamp: "2026-06-14T11:03:20.000Z",
			type: eventTypes.GENERATION_CREATE,
			body: {
				id: "observation-1",
				traceId: "trace-1",
				name: "Generation 1",
				startTime: "2026-06-14T11:03:20.000Z",
				usageDetails: { input: 38, output: 22, total: 60 },
				costDetails: { input: 0.038, output: 0.044, total: 0.082 },
			},
		},
	];

	await writeEventsAndSyncCache(
		config,
		testStorageContext(config, store),
		events,
	);

	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const observationsOutput = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"observations",
				"list",
				"--traceId",
				"trace-1",
				"--json",
			]),
		);
		const observations = JSON.parse(observationsOutput) as Array<{
			id: string;
			usage_details_json: string;
			cost_details_json: string;
			total_cost: number;
		}>;
		assert.equal(observations[0].id, "observation-1");
		assert.deepEqual(JSON.parse(observations[0].usage_details_json), {
			input: 38,
			output: 22,
			total: 60,
		});
		assert.deepEqual(JSON.parse(observations[0].cost_details_json), {
			input: 0.038,
			output: 0.044,
			total: 0.082,
		});
		assert.equal(observations[0].total_cost, 0.082);

		const traceOutput = await captureStdout(() =>
			main(["node", "agentpond", "traces", "get", "trace-1", "--json"]),
		);
		const traces = JSON.parse(traceOutput) as Array<{
			id: string;
			total_cost: number;
		}>;
		assert.equal(traces.length, 1);
		assert.equal(traces[0].id, "trace-1");
		assert.equal(traces[0].total_cost, 0.082);
		assert.equal(process.exitCode, undefined);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI observation list has stable order for identical start times", async () => {
	const store = new MemoryObjectStore();
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-"));
	const dbPath = devDbPath(root);
	const config = testConfig(dbPath);
	await writeEventsAndSyncCache(config, testStorageContext(config, store), [
		{
			id: "trace-event-1",
			timestamp: "2026-06-19T07:54:54.798Z",
			type: eventTypes.TRACE_CREATE,
			body: {
				id: "trace-ordered",
				name: "Trace Ordered",
				startTime: "2026-06-19T07:54:54.798Z",
			},
		},
		{
			id: "later-id-event",
			timestamp: "2026-06-19T07:54:54.798Z",
			type: eventTypes.SPAN_CREATE,
			body: {
				id: "b-span",
				traceId: "trace-ordered",
				name: "B Span",
				startTime: "2026-06-19T07:54:54.798Z",
			},
		},
		{
			id: "earlier-id-event",
			timestamp: "2026-06-19T07:54:54.798Z",
			type: eventTypes.SPAN_CREATE,
			body: {
				id: "a-span",
				traceId: "trace-ordered",
				name: "A Span",
				startTime: "2026-06-19T07:54:54.798Z",
			},
		},
	]);

	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"observations",
				"list",
				"--traceId",
				"trace-ordered",
				"--json",
			]),
		);
		const observations = JSON.parse(output) as Array<{ id: string }>;

		assert.equal(process.exitCode, undefined);
		assert.deepEqual(
			observations.map((observation) => observation.id),
			["a-span", "b-span"],
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI read commands report missing required score filters", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "scores", "list", "--json"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /scores list requires --traceId or --observationId/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI reports the selected environment when --env is omitted for non-JSON commands", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-log-"));
	const dbPath = devDbPath(root);
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const db = new AgentPondCache(dbPath);
		await db.ensureSchema();
		await db.close();

		const stderr = await captureStderr(() =>
			captureStdout(() => main(["node", "agentpond", "traces", "list"])),
		);

		assert.equal(process.exitCode, undefined);
		assert.match(stderr, /Using environment: dev/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI does not report implicit environment in JSON output", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-"));
	const dbPath = devDbPath(root);
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const db = new AgentPondCache(dbPath);
		await db.ensureSchema();
		await db.close();

		const stderr = await captureStderr(() =>
			captureStdout(() =>
				main(["node", "agentpond", "traces", "list", "--json"]),
			),
		);

		assert.equal(process.exitCode, undefined);
		assert.equal(stderr, "");
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env current defaults to table output and keeps JSON behind --json", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-current-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const tableOutput = await captureStdout(() =>
			main(["node", "agentpond", "env", "current"]),
		);
		assert.equal(process.exitCode, undefined);
		assert.match(tableOutput, /^\[/);
		assert.match(tableOutput, /"name":"dev"/);

		const jsonOutput = await captureStdout(() =>
			main(["node", "agentpond", "env", "current", "--json"]),
		);
		const environment = JSON.parse(jsonOutput) as {
			name: string;
			dbPath: string;
		};
		assert.equal(environment.name, "dev");
		assert.match(environment.dbPath, /\.agentpond\/envs\/dev\/cache\.duckdb$/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI sync is a no-op for the dev environment", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-sync-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main(["node", "agentpond", "sync", "--json"]),
		);
		const result = JSON.parse(output) as { skipped: boolean; reason: string };

		assert.equal(process.exitCode, undefined);
		assert.equal(result.skipped, true);
		assert.match(result.reason, /sync is not needed for npx agentpond dev/);
		assert.equal(
			existsSync(join(root, ".agentpond", "envs", "dev", "cache.duckdb")),
			false,
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI traces create writes directly to the dev DuckDB", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-trace-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"traces",
				"create",
				"--env",
				"dev",
				"--id",
				"0123456789abcdef0123456789abcdef",
				"--name",
				"Direct Dev Trace",
				"--json",
			]),
		);
		const result = JSON.parse(output) as {
			traceId: string;
			eventsProcessed: number;
		};

		assert.equal(process.exitCode, undefined);
		assert.equal(result.traceId, "0123456789abcdef0123456789abcdef");
		assert.equal(result.eventsProcessed, 2);
		assert.equal(
			existsSync(join(root, ".agentpond", "envs", "dev", "events")),
			false,
		);

		const db = new AgentPondCache(
			join(root, ".agentpond", "envs", "dev", "cache.duckdb"),
		);
		const rows = await db.query<{ id: string; name: string }>(
			"SELECT id, name FROM traces WHERE id = '0123456789abcdef0123456789abcdef'",
		);
		await db.close();

		assert.deepEqual(rows, [
			{
				id: "0123456789abcdef0123456789abcdef",
				name: "Direct Dev Trace",
			},
		]);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI scores create writes directly to the dev DuckDB", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-score-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"scores",
				"create",
				"--env",
				"dev",
				"--id",
				"score-direct",
				"--name",
				"quality",
				"--value",
				"0.95",
				"--traceId",
				"trace-direct",
				"--json",
			]),
		);
		const result = JSON.parse(output) as {
			scoreId: string;
			eventsProcessed: number;
		};

		assert.equal(process.exitCode, undefined);
		assert.equal(result.scoreId, "score-direct");
		assert.equal(result.eventsProcessed, 1);
		assert.equal(
			existsSync(join(root, ".agentpond", "envs", "dev", "events")),
			false,
		);

		const db = new AgentPondCache(
			join(root, ".agentpond", "envs", "dev", "cache.duckdb"),
		);
		const rows = await db.query<{
			id: string;
			trace_id: string;
			name: string;
			value: number;
		}>(
			"SELECT id, trace_id, name, value FROM scores WHERE id = 'score-direct'",
		);
		await db.close();

		assert.deepEqual(rows, [
			{
				id: "score-direct",
				trace_id: "trace-direct",
				name: "quality",
				value: 0.95,
			},
		]);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env get dev requires a running dev server", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-env-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "env", "get", "dev"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(
			stderr,
			/dev server is not running; start it with npx agentpond dev/,
		);
		assert.equal(
			existsSync(join(root, ".agentpond", "envs", "dev.env")),
			false,
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env get dev --otel prints only OTEL exports", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-env-otel-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const environment = initAgentPondEnvironment("dev");
		const lock = acquireDevServerLock(environment);
		lock.update({
			host: "127.0.0.1",
			port: 4319,
			url: "http://127.0.0.1:4319",
		});
		const output = await captureStdout(() =>
			main(["node", "agentpond", "env", "get", "dev", "--otel"]),
		);
		lock.release();

		assert.equal(process.exitCode, undefined);
		assert.equal(
			output,
			[
				"export OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4319/api/public/otel",
				"export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://127.0.0.1:4319/api/public/otel/v1/traces",
				"export OTEL_EXPORTER_OTLP_PROTOCOL=http/json",
				"",
			].join("\n"),
		);
		assert.equal(
			existsSync(join(root, ".agentpond", "envs", "dev.env")),
			false,
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env get dev --langfuse prints only Langfuse-compatible exports", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-env-langfuse-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const environment = initAgentPondEnvironment("dev");
		const lock = acquireDevServerLock(environment);
		lock.update({
			host: "127.0.0.1",
			port: 4319,
			url: "http://127.0.0.1:4319",
		});
		const output = await captureStdout(() =>
			main(["node", "agentpond", "env", "get", "dev", "--langfuse"]),
		);
		lock.release();

		assert.equal(process.exitCode, undefined);
		assert.equal(
			output,
			[
				"export LANGFUSE_BASE_URL=http://127.0.0.1:4319",
				"export LANGFUSE_PUBLIC_KEY=pk-agentpond-dev",
				"export LANGFUSE_SECRET_KEY=sk-agentpond-dev",
				"",
			].join("\n"),
		);
		assert.equal(
			existsSync(join(root, ".agentpond", "envs", "dev.env")),
			false,
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env get rejects conflicting env family flags", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-env-conflict-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "env", "get", "dev", "--otel", "--langfuse"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /--langfuse and --otel cannot be used together/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env get dev uses the running dev server port", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-env-running-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const environment = initAgentPondEnvironment("dev");
		const lock = acquireDevServerLock(environment);
		lock.update({
			host: "127.0.0.1",
			port: 4319,
			url: "http://127.0.0.1:4319",
		});
		const output = await captureStdout(() =>
			main(["node", "agentpond", "env", "get", "dev"]),
		);
		lock.release();

		assert.equal(process.exitCode, undefined);
		assert.match(
			output,
			/export OTEL_EXPORTER_OTLP_ENDPOINT=http:\/\/127\.0\.0\.1:4319\/api\/public\/otel/,
		);
		assert.match(
			output,
			/export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http:\/\/127\.0\.0\.1:4319\/api\/public\/otel\/v1\/traces/,
		);
		assert.match(output, /export LANGFUSE_BASE_URL=http:\/\/127\.0\.0\.1:4319/);
		assert.match(output, /export LANGFUSE_PUBLIC_KEY=pk-agentpond-dev/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env get dev rejects manual host and port overrides", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-env-no-port-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "env", "get", "dev", "--port", "4319"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /unknown option '--port'/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI dev logger prints JSON logs and suppresses server listen logs", () => {
	const loggerOptions = createDevLoggerOptions();
	assert.ok(loggerOptions.stream);
	const write = process.stdout.write;
	const chunks: string[] = [];
	process.stdout.write = ((chunk: string | Uint8Array) => {
		chunks.push(String(chunk));
		return true;
	}) as typeof process.stdout.write;
	try {
		loggerOptions.stream.write(
			`${JSON.stringify({
				level: 30,
				msg: "ingested event",
				source: "ingestion",
				projectId: "default-project",
				eventId: "event-1",
				eventType: eventTypes.TRACE_CREATE,
				entityId: "trace-1",
			})}\n`,
		);
		loggerOptions.stream.write(
			`${JSON.stringify({
				level: 30,
				msg: "ingested otel payload",
				source: "otel",
				projectId: "default-project",
				resourceSpanCount: 1,
			})}\n`,
		);
		loggerOptions.stream.write(
			`${JSON.stringify({
				level: 30,
				msg: "incoming request",
				reqId: "req-1",
			})}\n`,
		);
		loggerOptions.stream.write(
			`${JSON.stringify({
				level: 30,
				msg: "Server listening at http://127.0.0.1:4318",
			})}\n`,
		);
	} finally {
		process.stdout.write = write;
	}

	assert.deepEqual(
		chunks
			.join("")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line)),
		[
			{
				level: 30,
				msg: "ingested event",
				source: "ingestion",
				projectId: "default-project",
				eventId: "event-1",
				eventType: eventTypes.TRACE_CREATE,
				entityId: "trace-1",
			},
			{
				level: 30,
				msg: "ingested otel payload",
				source: "otel",
				projectId: "default-project",
				resourceSpanCount: 1,
			},
			{
				level: 30,
				msg: "incoming request",
				reqId: "req-1",
			},
		],
	);
});

test("CLI dev falls back to the next port when the requested port is in use", async () => {
	const listenedPorts: number[] = [];
	const closedPorts: number[] = [];
	let successfulServer:
		| {
				close: () => Promise<void>;
		  }
		| undefined;
	const stderr = await captureStderr(async () => {
		const result = await listenOnAvailablePort({
			host: "127.0.0.1",
			startPort: 4318,
			createServer: () => {
				let attemptedPort: number | undefined;
				const server = {
					listen: async ({ port }: { port: number }) => {
						attemptedPort = port;
						listenedPorts.push(port);
						if (port === 4318) {
							const error = new Error("address already in use") as Error & {
								code: string;
							};
							error.code = "EADDRINUSE";
							throw error;
						}
					},
					close: async () => {
						if (attemptedPort !== undefined) closedPorts.push(attemptedPort);
					},
				};
				return server as never;
			},
		});
		successfulServer = result.server;

		assert.equal(result.port, 4319);
	});

	assert.deepEqual(listenedPorts, [4318, 4319]);
	assert.deepEqual(closedPorts, [4318]);
	assert.match(stderr, /Port 4318 is in use, using 4319 instead\./);
	await successfulServer?.close();
});

test("CLI dev server lock allows only one server per AgentPond directory", () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-lock-exclusive-"));
	try {
		process.chdir(root);
		const environment = initAgentPondEnvironment("dev");
		const lock = acquireDevServerLock(environment);
		try {
			assert.throws(
				() => acquireDevServerLock(environment),
				(error: unknown) =>
					error instanceof Error &&
					(error as NodeJS.ErrnoException).code === "EEXIST",
			);
		} finally {
			lock.release();
		}
	} finally {
		process.chdir(cwd);
	}
});

test("CLI dev write commands fail while the dev server lock is active", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-lock-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const environment = initAgentPondEnvironment("dev");
		const lock = acquireDevServerLock(environment);
		try {
			const stderr = await captureStderr(() =>
				main([
					"node",
					"agentpond",
					"traces",
					"create",
					"--id",
					"0123456789abcdef0123456789abcdef",
				]),
			);

			assert.equal(process.exitCode, 2);
			assert.match(
				stderr,
				/dev server is running; stop it or use the dev ingestion endpoint/,
			);
		} finally {
			lock.release();
		}
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI read commands work while the dev server lock is active", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-dev-read-lock-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const environment = initAgentPondEnvironment("dev");
		const db = new AgentPondCache(environment.dbPath);
		await db.ensureSchema();
		await db.directIngestion().writeEvents({
			projectId: "default-project",
			events: [
				{
					id: "trace-read-event",
					timestamp: "2026-06-14T00:00:00.000Z",
					type: eventTypes.TRACE_CREATE,
					body: {
						id: "trace-read",
						name: "Readable Trace",
						sessionId: "session-read",
					},
				},
				{
					id: "observation-read-event",
					timestamp: "2026-06-14T00:00:01.000Z",
					type: eventTypes.GENERATION_CREATE,
					body: {
						id: "observation-read",
						traceId: "trace-read",
						name: "Readable Observation",
					},
				},
				{
					id: "score-read-event",
					timestamp: "2026-06-14T00:00:02.000Z",
					type: eventTypes.SCORE_CREATE,
					body: {
						id: "score-read",
						traceId: "trace-read",
						name: "readability",
						value: 1,
					},
				},
			],
			source: "test-read-lock",
		});
		await db.close();
		const lock = acquireDevServerLock(environment);
		try {
			const runJson = async (args: string[]) => {
				process.exitCode = undefined;
				const output = await captureStdout(() =>
					main(["node", "agentpond", ...args, "--json"]),
				);
				assert.equal(process.exitCode, undefined);
				return JSON.parse(output) as Array<Record<string, unknown>>;
			};

			assert.equal(
				(await runJson(["traces", "get", "trace-read"]))[0].id,
				"trace-read",
			);
			assert.equal((await runJson(["traces", "list"]))[0].id, "trace-read");
			assert.equal(
				(await runJson(["observations", "list", "--traceId", "trace-read"]))[0]
					.id,
				"observation-read",
			);
			assert.equal((await runJson(["sessions", "list"]))[0].id, "session-read");
			assert.equal(
				(await runJson(["sessions", "get", "session-read"]))[0].id,
				"session-read",
			);
			assert.equal(
				(await runJson(["scores", "list", "--traceId", "trace-read"]))[0].id,
				"score-read",
			);
			assert.equal(
				(await runJson(["sql", "SELECT id FROM traces"]))[0].id,
				"trace-read",
			);
		} finally {
			lock.release();
		}
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI returns non-zero errors for invalid resources and actions", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "frobs", "list"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /unknown command 'frobs'/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI without arguments exits successfully", async () => {
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		await main(["node", "agentpond"]);

		assert.equal(process.exitCode, undefined);
	} finally {
		process.exitCode = originalExitCode;
	}
});

test("CLI reports unknown options as user errors", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-unknown-option-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "traces", "list", "--wat"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /unknown option '--wat'/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI supports equals-style flag values", async () => {
	const store = new MemoryObjectStore();
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-equals-"));
	const dbPath = devDbPath(root);
	const config = testConfig(dbPath);
	await writeEventsAndSyncCache(config, testStorageContext(config, store), [
		{
			id: "trace-event-1",
			timestamp: "2026-06-14T00:00:00.000Z",
			type: eventTypes.TRACE_CREATE,
			body: { id: "trace-1", name: "Trace 1" },
		},
		{
			id: "trace-event-2",
			timestamp: "2026-06-14T00:00:01.000Z",
			type: eventTypes.TRACE_CREATE,
			body: { id: "trace-2", name: "Trace 2" },
		},
	]);

	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main(["node", "agentpond", "traces", "--json", "list", "--limit=1"]),
		);
		const traces = JSON.parse(output) as Array<{ id: string }>;

		assert.equal(process.exitCode, undefined);
		assert.equal(traces.length, 1);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI command-local help does not open the environment cache", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-help-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureProcessStdout(() =>
			main(["node", "agentpond", "traces", "list", "--help"]),
		);

		assert.equal(process.exitCode, undefined);
		assert.match(output, /Usage: agentpond traces list/);
		assert.equal(existsSync(join(root, ".agentpond")), false);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env init writes GCS store files from --store", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-init-store-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"env",
				"init",
				"staging",
				"--store",
				"gcs",
				"--json",
			]),
		);
		const result = JSON.parse(output) as {
			store: string;
			envFile: string;
		};

		assert.equal(process.exitCode, undefined);
		assert.equal(result.store, "gcs");
		assert.match(readFileSync(result.envFile, "utf8"), /AGENTPOND_STORE=gcs/);
		assert.match(
			readFileSync(result.envFile, "utf8"),
			/AGENTPOND_GCS_BUCKET=agentpond/,
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env init rejects the removed Vercel store option", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-init-vercel-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main([
				"node",
				"agentpond",
				"env",
				"init",
				"staging",
				"--store",
				"vercel",
			]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /--store must be s3, gcs, or local/);
		assert.equal(existsSync(join(root, ".agentpond")), false);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI object storage auto-detects Firebase projects from .firebaserc", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-firebase-auto-"));
	const originalFromCliProject = FirebaseStorageObjectStore.fromCliProject;
	const originalEnvStore = process.env.AGENTPOND_STORE;
	const store = new MemoryObjectStore();
	let projectId: string | undefined;
	try {
		delete process.env.AGENTPOND_STORE;
		process.chdir(root);
		writeFileSync(
			join(root, ".firebaserc"),
			JSON.stringify({ projects: { default: "firebase-demo" } }),
			"utf8",
		);
		FirebaseStorageObjectStore.fromCliProject = (async (project) => {
			projectId = project.projectId;
			return store;
		}) as typeof FirebaseStorageObjectStore.fromCliProject;

		const context = environmentContextForCommand();
		writeFileSync(
			join(root, ".firebaserc"),
			JSON.stringify({ projects: { default: "changed-after-resolution" } }),
			"utf8",
		);
		const storage = await context.resolveStorage();

		assert.equal(context.kind, "firebase");
		assert.equal(context.usesAgentPondDevServer, false);
		assert.equal(storage.store, store);
		assert.equal(storage.projectId, "firebase-demo");
		assert.equal(storage.prefix, "agentpond/");
		assert.equal(projectId, "firebase-demo");
	} finally {
		FirebaseStorageObjectStore.fromCliProject = originalFromCliProject;
		if (originalEnvStore === undefined) {
			delete process.env.AGENTPOND_STORE;
		} else {
			process.env.AGENTPOND_STORE = originalEnvStore;
		}
		process.chdir(cwd);
	}
});

test("CLI object storage auto-detects Firebase monorepos from firebase.json", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-firebase-json-"));
	const nested = join(root, "packages", "functions");
	const originalFromCliProject = FirebaseStorageObjectStore.fromCliProject;
	const originalEnvStore = process.env.AGENTPOND_STORE;
	const originalGoogleProject = process.env.GOOGLE_CLOUD_PROJECT;
	const store = new MemoryObjectStore();
	let projectId: string | undefined;
	try {
		delete process.env.AGENTPOND_STORE;
		process.env.GOOGLE_CLOUD_PROJECT = "firebase-json-project";
		writeFileSync(
			join(root, "firebase.json"),
			JSON.stringify({ functions: [{ source: "packages/functions" }] }),
			"utf8",
		);
		mkdirSync(nested, { recursive: true });
		process.chdir(nested);
		FirebaseStorageObjectStore.fromCliProject = (async (project) => {
			projectId = project.projectId;
			return store;
		}) as typeof FirebaseStorageObjectStore.fromCliProject;

		const context = environmentContextForCommand();
		const storage = await context.resolveStorage();

		assert.equal(storage.store, store);
		assert.equal(storage.projectId, "firebase-json-project");
		assert.equal(storage.prefix, "agentpond/");
		assert.equal(projectId, "firebase-json-project");
	} finally {
		FirebaseStorageObjectStore.fromCliProject = originalFromCliProject;
		if (originalEnvStore === undefined) {
			delete process.env.AGENTPOND_STORE;
		} else {
			process.env.AGENTPOND_STORE = originalEnvStore;
		}
		if (originalGoogleProject === undefined) {
			delete process.env.GOOGLE_CLOUD_PROJECT;
		} else {
			process.env.GOOGLE_CLOUD_PROJECT = originalGoogleProject;
		}
		process.chdir(cwd);
	}
});

test("CLI uses Firebase project ids as local cache environment names", () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-firebase-env-")),
	);
	try {
		process.chdir(root);
		writeFileSync(
			join(root, ".firebaserc"),
			JSON.stringify({
				projects: {
					custom: "lunaraspect-custom",
					default: "lunaraspect-dev",
				},
			}),
			"utf8",
		);

		const config = configForCommand({});
		const explicitConfig = configForCommand({ env: "custom" });

		assert.equal(config.environment?.name, "lunaraspect-dev");
		assert.equal(
			config.dbPath,
			join(root, ".agentpond", "envs", "lunaraspect-dev", "cache.duckdb"),
		);
		assert.equal(explicitConfig.environment?.name, "lunaraspect-custom");
		assert.equal(
			explicitConfig.dbPath,
			join(root, ".agentpond", "envs", "lunaraspect-custom", "cache.duckdb"),
		);

		writeFileSync(
			join(root, ".firebaserc"),
			JSON.stringify({ projects: { default: "lunaraspect-9ffa3" } }),
			"utf8",
		);
		const switchedConfig = configForCommand({});
		assert.equal(switchedConfig.environment?.name, "lunaraspect-9ffa3");
		assert.equal(
			switchedConfig.dbPath,
			join(root, ".agentpond", "envs", "lunaraspect-9ffa3", "cache.duckdb"),
		);
	} finally {
		process.chdir(cwd);
	}
});

test("CLI Firebase commands use the Firebase project directory for AgentPond files", async () => {
	const cwd = process.cwd();
	const originalExitCode = process.exitCode;
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-firebase-project-root-")),
	);
	const functionsDir = join(root, "packages", "functions");
	const mutableProvider = firebaseProvider as unknown as {
		openProject: typeof firebaseProvider.openProject;
	};
	const originalOpenProject = mutableProvider.openProject;
	try {
		mkdirSync(functionsDir, { recursive: true });
		writeFileSync(
			join(root, ".firebaserc"),
			JSON.stringify({
				projects: {
					default: "firebase-demo",
					staging: "firebase-staging",
				},
			}),
			"utf8",
		);
		writeFileSync(
			join(root, "firebase.json"),
			JSON.stringify({ functions: [{ source: "packages/functions" }] }),
			"utf8",
		);
		process.chdir(functionsDir);

		const config = configForCommand({});
		assert.equal(
			config.dbPath,
			join(root, ".agentpond", "envs", "firebase-demo", "cache.duckdb"),
		);

		process.exitCode = undefined;
		mutableProvider.openProject = (options) => {
			const project = originalOpenProject(options);
			return project
				? {
						...project,
						async selectEnvironment(name) {
							assert.equal(name, "staging");
							assert.equal(project.rootDir, root);
							return "firebase-staging";
						},
					}
				: undefined;
		};
		const output = await captureStdout(() =>
			main(["node", "agentpond", "env", "use", "staging", "--json"]),
		);
		assert.equal(process.exitCode, undefined);
		assert.deepEqual(JSON.parse(output), { selected: "firebase-staging" });
		assert.equal(existsSync(join(root, ".agentpond", "current-env")), false);
		assert.equal(existsSync(join(functionsDir, ".agentpond")), false);
	} finally {
		mutableProvider.openProject = originalOpenProject;
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI managed providers reject manual environments and the dev server", async () => {
	const cwd = process.cwd();
	const originalExitCode = process.exitCode;
	const projects = [
		{
			kind: "firebase",
			setup(root: string) {
				writeFileSync(
					join(root, ".firebaserc"),
					JSON.stringify({ projects: { default: "firebase-demo" } }),
					"utf8",
				);
			},
		},
		{
			kind: "vercel",
			setup(root: string) {
				mkdirSync(join(root, ".vercel"), { recursive: true });
				writeFileSync(
					join(root, ".vercel", "project.json"),
					JSON.stringify({ projectId: "prj_demo" }),
					"utf8",
				);
			},
		},
		{
			kind: "vercel",
			setup(root: string) {
				writeFileSync(join(root, "vercel.json"), "{}", "utf8");
			},
		},
	] as const;
	const commands = [
		{ action: "get", args: ["env", "get", "dev"] },
		{ action: "list", args: ["env", "list"] },
		{ action: "init", args: ["env", "init", "staging", "--store", "local"] },
	] as const;

	try {
		for (const project of projects) {
			const root = realpathSync(
				mkdtempSync(join(tmpdir(), `agentpond-cli-${project.kind}-managed-`)),
			);
			project.setup(root);
			process.chdir(root);

			for (const command of commands) {
				process.exitCode = undefined;
				const stderr = await captureStderr(() =>
					main(["node", "agentpond", ...command.args]),
				);
				assert.equal(process.exitCode, 2);
				assert.match(
					stderr,
					new RegExp(
						`npx agentpond env ${command.action} is not available for ${project.kind} projects`,
					),
				);
			}

			process.exitCode = undefined;
			const stderr = await captureStderr(() =>
				main(["node", "agentpond", "dev"]),
			);
			assert.equal(process.exitCode, 2);
			assert.match(
				stderr,
				new RegExp(
					`npx agentpond dev is not available for ${project.kind} projects`,
				),
			);
			assert.equal(existsSync(join(root, ".agentpond")), false);
		}
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env init rejects store configuration in Firebase projects", async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-firebase-env-init-")),
	);
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		writeFileSync(
			join(root, ".firebaserc"),
			JSON.stringify({ projects: { default: "firebase-demo" } }),
			"utf8",
		);

		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "env", "init", "staging", "--store", "local"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(
			stderr,
			/npx agentpond env init is not available for firebase projects/,
		);
		assert.equal(
			existsSync(join(root, ".agentpond", "envs", "staging.env")),
			false,
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI Firebase context ignores explicit non-Firebase stores", async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-firebase-explicit-")),
	);
	const originalEnvStore = process.env.AGENTPOND_STORE;
	const originalFromCliProject = FirebaseStorageObjectStore.fromCliProject;
	const store = new MemoryObjectStore();
	try {
		process.chdir(root);
		writeFileSync(
			join(root, ".firebaserc"),
			JSON.stringify({ projects: { default: "firebase-demo" } }),
			"utf8",
		);
		process.env.AGENTPOND_STORE = "local";
		FirebaseStorageObjectStore.fromCliProject = (async () =>
			store) as typeof FirebaseStorageObjectStore.fromCliProject;

		const context = environmentContextForCommand();
		const storage = await context.resolveStorage();
		const { config } = context;

		assert.equal(config.environment?.name, "firebase-demo");
		assert.equal(
			config.dbPath,
			join(root, ".agentpond", "envs", "firebase-demo", "cache.duckdb"),
		);
		assert.equal(storage.store, store);
		assert.equal(storage.projectId, "firebase-demo");
		assert.equal(storage.prefix, "agentpond/");
	} finally {
		FirebaseStorageObjectStore.fromCliProject = originalFromCliProject;
		if (originalEnvStore === undefined) {
			delete process.env.AGENTPOND_STORE;
		} else {
			process.env.AGENTPOND_STORE = originalEnvStore;
		}
		process.chdir(cwd);
	}
});

test("CLI Firebase context ignores invalid AgentPond store values", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-firebase-ignored-"));
	const originalEnvStore = process.env.AGENTPOND_STORE;
	const originalFromCliProject = FirebaseStorageObjectStore.fromCliProject;
	const store = new MemoryObjectStore();
	try {
		process.chdir(root);
		writeFileSync(
			join(root, ".firebaserc"),
			JSON.stringify({ projects: { default: "firebase-demo" } }),
			"utf8",
		);
		process.env.AGENTPOND_STORE = "firebase";
		FirebaseStorageObjectStore.fromCliProject = (async () =>
			store) as typeof FirebaseStorageObjectStore.fromCliProject;

		const context = environmentContextForCommand();
		assert.equal((await context.resolveStorage()).store, store);
	} finally {
		FirebaseStorageObjectStore.fromCliProject = originalFromCliProject;
		if (originalEnvStore === undefined) {
			delete process.env.AGENTPOND_STORE;
		} else {
			process.env.AGENTPOND_STORE = originalEnvStore;
		}
		process.chdir(cwd);
	}
});

test("CLI env use persists the selected Vercel target", async () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-vercel-env-use-")),
	);
	const originalExitCode = process.exitCode;
	try {
		mkdirSync(join(root, ".vercel"), { recursive: true });
		writeFileSync(
			join(root, ".vercel", "project.json"),
			JSON.stringify({ projectId: "prj_demo" }),
			"utf8",
		);
		process.chdir(root);
		process.exitCode = undefined;

		const output = await captureStdout(() =>
			main(["node", "agentpond", "env", "use", "staging", "--json"]),
		);

		assert.equal(process.exitCode, undefined);
		assert.deepEqual(JSON.parse(output), { selected: "staging" });
		assert.deepEqual(
			JSON.parse(readFileSync(join(root, ".vercel", "agentpond.json"), "utf8")),
			{ projectId: "prj_demo", target: "staging" },
		);
		assert.equal(configForCommand({}).environment?.name, "staging");
		assert.equal(
			configForCommand({ env: "preview" }).environment?.name,
			"preview",
		);
		assert.equal(existsSync(join(root, ".agentpond", "current-env")), false);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI Vercel context rejects unlinked projects instead of using a manual context", () => {
	const cwd = process.cwd();
	const root = realpathSync(
		mkdtempSync(join(tmpdir(), "agentpond-cli-vercel-unlinked-context-")),
	);
	try {
		writeFileSync(join(root, "vercel.json"), "{}", "utf8");
		process.chdir(root);

		assert.throws(
			() => environmentContextForCommand(),
			/Run vercel link before using AgentPond with this Vercel project/,
		);
		assert.equal(existsSync(join(root, ".agentpond")), false);
	} finally {
		process.chdir(cwd);
	}
});

test("CLI default context validates stores only when storage is resolved", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-default-context-"));
	const originalEnvStore = process.env.AGENTPOND_STORE;
	try {
		process.chdir(root);
		process.env.AGENTPOND_STORE = "invalid-default-store";
		const context = environmentContextForCommand();

		assert.equal(context.kind, "agentpond");
		assert.equal(context.usesAgentPondDevServer, true);
		await assert.rejects(
			context.resolveStorage(),
			/AGENTPOND_STORE must be "local", "s3", or "gcs"/,
		);
	} finally {
		if (originalEnvStore === undefined) {
			delete process.env.AGENTPOND_STORE;
		} else {
			process.env.AGENTPOND_STORE = originalEnvStore;
		}
		process.chdir(cwd);
	}
});

test("CLI env init writes S3 and local store files from --store", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-init-stores-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const awsOutput = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"env",
				"init",
				"s3-env",
				"--store",
				"s3",
				"--json",
			]),
		);
		const localOutput = await captureStdout(() =>
			main([
				"node",
				"agentpond",
				"env",
				"init",
				"local-env",
				"--store",
				"local",
				"--json",
			]),
		);
		const s3 = JSON.parse(awsOutput) as { store: string; envFile: string };
		const local = JSON.parse(localOutput) as {
			store: string;
			envFile: string;
		};

		assert.equal(process.exitCode, undefined);
		assert.equal(s3.store, "s3");
		assert.match(readFileSync(s3.envFile, "utf8"), /AGENTPOND_STORE=s3/);
		assert.match(readFileSync(s3.envFile, "utf8"), /AGENTPOND_S3_BUCKET/);
		assert.equal(local.store, "local");
		assert.match(readFileSync(local.envFile, "utf8"), /AGENTPOND_STORE=local/);
		assert.doesNotMatch(
			readFileSync(local.envFile, "utf8"),
			/AGENTPOND_S3_BUCKET/,
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env init rejects invalid stores", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-init-invalid-"));
	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "env", "init", "staging", "--store", "azure"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /--store must be s3, gcs, or local/);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env init without --store errors in non-interactive mode", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-init-nontty-"));
	const originalExitCode = process.exitCode;
	const stdinDescriptor = Object.getOwnPropertyDescriptor(
		process.stdin,
		"isTTY",
	);
	const stdoutDescriptor = Object.getOwnPropertyDescriptor(
		process.stdout,
		"isTTY",
	);
	process.exitCode = undefined;
	try {
		process.chdir(root);
		Object.defineProperty(process.stdin, "isTTY", {
			configurable: true,
			value: false,
		});
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: false,
		});
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "env", "init", "staging"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /Missing --store/);
	} finally {
		if (stdinDescriptor)
			Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
		if (stdoutDescriptor)
			Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env init can select a store interactively", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-init-tty-"));
	const originalExitCode = process.exitCode;
	const stdinDescriptor = Object.getOwnPropertyDescriptor(
		process.stdin,
		"isTTY",
	);
	const stdoutDescriptor = Object.getOwnPropertyDescriptor(
		process.stdout,
		"isTTY",
	);
	process.exitCode = undefined;
	try {
		process.chdir(root);
		Object.defineProperty(process.stdin, "isTTY", {
			configurable: true,
			value: true,
		});
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});
		const output = await captureStdout(() =>
			main(["node", "agentpond", "env", "init", "staging", "--json"], {
				selectStore: async ({ choices }) => {
					assert.deepEqual(
						choices.map((choice) => choice.value),
						["s3", "gcs", "local"],
					);
					return "local";
				},
			}),
		);
		const result = JSON.parse(output) as {
			store: string;
			envFile: string;
		};

		assert.equal(process.exitCode, undefined);
		assert.equal(result.store, "local");
		assert.match(readFileSync(result.envFile, "utf8"), /AGENTPOND_STORE=local/);
	} finally {
		if (stdinDescriptor)
			Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
		if (stdoutDescriptor)
			Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env use without a name errors in non-interactive mode", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-use-nontty-"));
	const originalExitCode = process.exitCode;
	const stdinDescriptor = Object.getOwnPropertyDescriptor(
		process.stdin,
		"isTTY",
	);
	const stdoutDescriptor = Object.getOwnPropertyDescriptor(
		process.stdout,
		"isTTY",
	);
	process.exitCode = undefined;
	try {
		process.chdir(root);
		Object.defineProperty(process.stdin, "isTTY", {
			configurable: true,
			value: false,
		});
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: false,
		});
		const stderr = await captureStderr(() =>
			main(["node", "agentpond", "env", "use"]),
		);

		assert.equal(process.exitCode, 2);
		assert.match(stderr, /Missing environment name/);
	} finally {
		if (stdinDescriptor)
			Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
		if (stdoutDescriptor)
			Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI env use can select an environment interactively", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-env-use-tty-"));
	const originalExitCode = process.exitCode;
	const stdinDescriptor = Object.getOwnPropertyDescriptor(
		process.stdin,
		"isTTY",
	);
	const stdoutDescriptor = Object.getOwnPropertyDescriptor(
		process.stdout,
		"isTTY",
	);
	process.exitCode = undefined;
	try {
		process.chdir(root);
		initAgentPondEnvironment("staging");
		Object.defineProperty(process.stdin, "isTTY", {
			configurable: true,
			value: true,
		});
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});
		const output = await captureStdout(() =>
			main(["node", "agentpond", "env", "use", "--json"], {
				selectEnvironment: async ({ choices }) => {
					assert.deepEqual(
						choices.map((choice) => choice.value),
						["staging"],
					);
					return "staging";
				},
			}),
		);

		assert.equal(process.exitCode, undefined);
		assert.deepEqual(JSON.parse(output), { selected: "staging" });
	} finally {
		if (stdinDescriptor)
			Object.defineProperty(process.stdin, "isTTY", stdinDescriptor);
		if (stdoutDescriptor)
			Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI --limit caps list result count", async () => {
	const store = new MemoryObjectStore();
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-"));
	const dbPath = devDbPath(root);
	const config = testConfig(dbPath);
	await writeEventsAndSyncCache(config, testStorageContext(config, store), [
		{
			id: "trace-event-1",
			timestamp: "2026-06-14T00:00:00.000Z",
			type: eventTypes.TRACE_CREATE,
			body: { id: "trace-1", name: "Trace 1" },
		},
		{
			id: "trace-event-2",
			timestamp: "2026-06-14T00:00:01.000Z",
			type: eventTypes.TRACE_CREATE,
			body: { id: "trace-2", name: "Trace 2" },
		},
		{
			id: "trace-event-3",
			timestamp: "2026-06-14T00:00:02.000Z",
			type: eventTypes.TRACE_CREATE,
			body: { id: "trace-3", name: "Trace 3" },
		},
	]);

	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main(["node", "agentpond", "traces", "list", "--limit", "2", "--json"]),
		);
		const traces = JSON.parse(output) as Array<{ id: string }>;

		assert.equal(process.exitCode, undefined);
		assert.equal(traces.length, 2);
		assert.deepEqual(
			traces.map((trace) => trace.id),
			["trace-3", "trace-2"],
		);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});

test("CLI --json returns parseable JSON for empty result sets", async () => {
	const cwd = process.cwd();
	const root = mkdtempSync(join(tmpdir(), "agentpond-cli-"));
	const dbPath = devDbPath(root);
	const db = new AgentPondCache(dbPath);
	await db.ensureSchema();
	await db.close();

	const originalExitCode = process.exitCode;
	process.exitCode = undefined;
	try {
		process.chdir(root);
		const output = await captureStdout(() =>
			main(["node", "agentpond", "traces", "get", "missing", "--json"]),
		);

		assert.equal(process.exitCode, undefined);
		assert.deepEqual(JSON.parse(output), []);
	} finally {
		process.chdir(cwd);
		process.exitCode = originalExitCode;
	}
});
