import {
	configFromEnv,
	FileSystemObjectStore,
	initAgentPondEnvironment,
	selectAgentPondEnvironment,
} from "@agentpond/core";
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
	const environment = initAgentPondEnvironment("dev");
	selectAgentPondEnvironment(environment.name);
	const devConfig = configFromEnv({
		envName: environment.name,
		eventStorePath: stringFlag(parsed, "event-store"),
		storeType: "local",
	});
	const devEnvironment = devConfig.environment;
	if (!devEnvironment)
		throw new CliError("Missing dev environment configuration");
	const server = buildServer({
		config: devConfig,
		store: new FileSystemObjectStore(devEnvironment.eventStorePath),
		authMode: "disabled",
	});
	await server.listen({ host, port });
	const baseUrl = `http://${host}:${port}`;
	console.log(`AgentPond dev server listening at ${baseUrl}`);
	console.log("");
	console.log("Set your Langfuse SDK environment to:");
	console.log(`LANGFUSE_BASE_URL=${baseUrl}`);
	console.log("LANGFUSE_PUBLIC_KEY=pk-agentpond-dev");
	console.log("LANGFUSE_SECRET_KEY=sk-agentpond-dev");
	console.log("");
	console.log(`Environment: ${devEnvironment.name}`);
	console.log(`Event store: ${devEnvironment.eventStorePath}`);
	console.log(`DuckDB cache: ${devConfig.dbPath}`);
}
