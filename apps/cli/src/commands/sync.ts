import { AgentPondCache } from "@agentpond/duckdb";
import type { Command } from "commander";
import { print } from "../cli-support.js";
import {
	addGlobalOptions,
	commandContext,
	type GlobalOptions,
	isDevEnvironment,
} from "../command-support.js";
import { objectStoreForConfig } from "../object-store.js";

export function registerSyncCommand(program: Command): void {
	addGlobalOptions(program.command("sync"))
		.description("sync object storage into the local DuckDB cache")
		.action(async (_options: GlobalOptions, command: Command) => {
			const { config, json } = commandContext(
				command.optsWithGlobals<GlobalOptions>(),
			);
			if (isDevEnvironment(config)) {
				return print(
					{
						skipped: true,
						reason: "calling agentpond sync is not needed for agentpond dev",
					},
					json,
				);
			}
			const db = new AgentPondCache(config.dbPath);
			try {
				const result = await db.syncFromStore({
					store: objectStoreForConfig(config),
					projectId: config.projectId,
					prefix: config.prefix,
				});
				return print(result, json);
			} finally {
				await db.close();
			}
		});
}
