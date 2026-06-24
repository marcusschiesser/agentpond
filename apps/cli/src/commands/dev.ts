import {
	acquireDevServerLock,
	configFromEnv,
	initAgentPondEnvironment,
	selectAgentPondEnvironment,
} from "@agentpond/core";
import { AgentPondCache, DuckDbIngestionWriter } from "@agentpond/duckdb";
import { buildServer } from "@agentpond/ingest";
import {
	CliError,
	type ParsedArgs,
	parsePort,
	stringFlag,
} from "../cli-support.js";

export async function startDevServer(parsed: ParsedArgs): Promise<void> {
	const host = stringFlag(parsed, "host") ?? "127.0.0.1";
	const port = parsePort(stringFlag(parsed, "port") ?? "4318");
	const action = parsed.positionals[1];
	if (action === "env") {
		printDevEnvironment(host, port);
		return;
	}
	if (action) throw new CliError(`Unknown command: dev ${action}`);
	const environment = initAgentPondEnvironment("dev");
	selectAgentPondEnvironment(environment.name);
	const devConfig = configFromEnv({
		envName: environment.name,
		storeType: "local",
	});
	const devEnvironment = devConfig.environment;
	if (!devEnvironment)
		throw new CliError("Missing dev environment configuration");
	const lock = acquireDevServerLock(devEnvironment);
	const db = new AgentPondCache(devConfig.dbPath);
	const server = buildServer({
		config: devConfig,
		handlers: new DuckDbIngestionWriter(db.directIngestion(), () => db.close()),
		authMode: "disabled",
		logger: false,
	});
	const shutdown = async () => {
		await server.close();
	};
	server.addHook("onClose", async () => {
		await db.close();
		lock.release();
	});
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
	try {
		await db.init();
		await db.close();
		await server.listen({ host, port });
	} catch (error) {
		process.off("SIGINT", shutdown);
		process.off("SIGTERM", shutdown);
		await db.close();
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
	console.log(`LANGFUSE_BASE_URL=${baseUrl}`);
	console.log("LANGFUSE_PUBLIC_KEY=pk-agentpond-dev");
	console.log("LANGFUSE_SECRET_KEY=sk-agentpond-dev");
	console.log("");
	console.log(
		'Or call `eval "$(agentpond dev env)"` before calling your dev server.',
	);
}

function printDevEnvironment(host: string, port: number): void {
	const baseUrl = `http://${host}:${port}`;
	console.log(`export LANGFUSE_BASE_URL=${baseUrl}`);
	console.log("export LANGFUSE_PUBLIC_KEY=pk-agentpond-dev");
	console.log("export LANGFUSE_SECRET_KEY=sk-agentpond-dev");
}
