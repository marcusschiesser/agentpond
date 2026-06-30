import {
	acquireDevServerLock,
	configFromEnv,
	initAgentPondEnvironment,
	selectAgentPondEnvironment,
} from "@agentpond/core";
import { DuckDbIngestionSink, ensureDuckDbSchema } from "@agentpond/duckdb";
import { buildServer } from "@agentpond/fastify-ingest";
import type { Command } from "commander";
import type { FastifyLoggerOptions } from "fastify";
import { CliError, parsePort } from "../cli-support.js";
import { addGlobalOptions } from "../command-support.js";
import { devSdkEnvironment } from "../dev-env.js";

type DevOptions = {
	host?: string;
	port?: string;
};

export function registerDevCommand(program: Command): void {
	addGlobalOptions(program.command("dev"))
		.description("start a local Langfuse SDK-compatible ingestion server")
		.option("--host <host>", "host to bind", "127.0.0.1")
		.option("--port <port>", "port to bind", "4318")
		.action(async (options: DevOptions) => {
			await startDevServer(options);
		});
}

export async function startDevServer(options: DevOptions): Promise<void> {
	const host = options.host ?? "127.0.0.1";
	const port = parsePort(options.port ?? "4318");
	const environment = initAgentPondEnvironment("dev");
	selectAgentPondEnvironment(environment.name);
	const devConfig = configFromEnv({
		envName: environment.name,
	});
	const devEnvironment = devConfig.environment;
	if (!devEnvironment)
		throw new CliError("Missing dev environment configuration");
	const lock = acquireDevServerLock(devEnvironment);
	const server = buildServer({
		sink: DuckDbIngestionSink.fromAgentPondEnv(environment.name),
		auth: false,
		logger: createDevLoggerOptions(),
	});
	const shutdown = async () => {
		await server.close();
	};
	server.addHook("onClose", async () => {
		lock.release();
	});
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
	try {
		await ensureDuckDbSchema(devConfig.dbPath);
		await server.listen({ host, port });
	} catch (error) {
		process.off("SIGINT", shutdown);
		process.off("SIGTERM", shutdown);
		lock.release();
		throw error;
	}
	const baseUrl = `http://${host}:${port}`;
	console.log(`AgentPond dev server listening at ${baseUrl}`);
	console.log("");
	console.log(`DuckDB cache: ${devConfig.dbPath}`);
	console.log("");
	console.log(
		"Add these env variables to your dev environment using Langfuse SDK:",
	);
	for (const entry of devSdkEnvironment(host, port)) {
		console.log(`${entry.key}=${entry.value}`);
	}
	console.log("");
	console.log(
		'Or call `eval "$(agentpond env get dev)"` before calling your dev server.',
	);
}

export function createDevLoggerOptions(): FastifyLoggerOptions {
	return {
		level: "info",
		stream: {
			write(line: string) {
				if (!isServerListenLog(line)) process.stdout.write(line);
			},
		},
	};
}

function isServerListenLog(line: string): boolean {
	try {
		const entry = JSON.parse(line) as { msg?: unknown };
		return (
			typeof entry.msg === "string" && entry.msg.startsWith("Server listening")
		);
	} catch {
		return false;
	}
}
