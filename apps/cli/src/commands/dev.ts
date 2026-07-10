import {
	acquireDevServerLock,
	configFromEnv,
	initAgentPondEnvironment,
	selectAgentPondEnvironment,
} from "@agentpond/core";
import { DuckDbIngestionSink, ensureDuckDbSchema } from "@agentpond/duckdb";
import { buildServer } from "@agentpond/fastify-ingest";
import type { Command } from "commander";
import type { FastifyInstance, FastifyLoggerOptions } from "fastify";
import { CliError, parsePort } from "../cli-support.js";
import { addGlobalOptions } from "../command-support.js";
import { devSdkEnvironment } from "../dev-env.js";
import { environmentContextForCommand } from "../environment-context.js";

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
	const startPort = parsePort(options.port ?? "4318");
	const cwd = environmentContextForCommand({ envName: "dev" }).rootDir;
	const environment = initAgentPondEnvironment("dev", { cwd });
	selectAgentPondEnvironment(environment.name, { cwd });
	const devConfig = configFromEnv({
		cwd,
		envName: environment.name,
	});
	const devEnvironment = devConfig.environment;
	if (!devEnvironment)
		throw new CliError("Missing dev environment configuration");
	const lock = acquireDevServerLock(devEnvironment);
	let server: FastifyInstance | undefined;
	let port = startPort;
	try {
		await ensureDuckDbSchema(devConfig.dbPath);
		const result = await listenOnAvailablePort({
			host,
			startPort,
			createServer: () => {
				const candidate = buildServer({
					sink: DuckDbIngestionSink.fromAgentPondEnv({
						cwd,
						name: environment.name,
					}),
					auth: false,
					logger: createDevLoggerOptions(),
				});
				candidate.addHook("onClose", async () => {
					if (server === candidate) lock.release();
				});
				return candidate;
			},
		});
		server = result.server;
		port = result.port;
		lock.update({
			host,
			port,
			url: `http://${host}:${port}`,
		});
	} catch (error) {
		lock.release();
		throw error;
	}
	if (!server) throw new CliError("Dev server failed to start");
	const shutdown = async () => {
		await server.close();
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
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

export async function listenOnAvailablePort(params: {
	host: string;
	startPort: number;
	createServer: () => FastifyInstance;
}): Promise<{ server: FastifyInstance; port: number }> {
	const maxAttempts = 100;
	for (let offset = 0; offset < maxAttempts; offset++) {
		const port = params.startPort + offset;
		const server = params.createServer();
		try {
			await server.listen({ host: params.host, port });
			if (port !== params.startPort) {
				console.error(
					`Port ${params.startPort} is in use, using ${port} instead.`,
				);
			}
			return { server, port };
		} catch (error) {
			await server.close().catch(() => undefined);
			if (!isAddressInUse(error)) throw error;
		}
	}
	throw new CliError(
		`No open port found from ${params.startPort} to ${
			params.startPort + maxAttempts - 1
		}`,
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

function isAddressInUse(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "EADDRINUSE"
	);
}
