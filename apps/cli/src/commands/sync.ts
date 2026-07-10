import { AgentPondCache } from "@agentpond/duckdb";
import type { Command } from "commander";
import { print } from "../cli-support.js";
import {
	addGlobalOptions,
	commandContext,
	type GlobalOptions,
} from "../command-support.js";
import {
	objectStorageForConfig,
	usesAgentPondDevServer,
} from "../object-store.js";

export function registerSyncCommand(program: Command): void {
	addGlobalOptions(program.command("sync"))
		.description("sync object storage into the local DuckDB cache")
		.action(async (_options: GlobalOptions, command: Command) => {
			const { config, json } = commandContext(
				command.optsWithGlobals<GlobalOptions>(),
			);
			if (usesAgentPondDevServer(config)) {
				return print(
					{
						skipped: true,
						reason: "calling agentpond sync is not needed for agentpond dev",
					},
					json,
				);
			}
			const db = new AgentPondCache(config.dbPath);
			const storage = await objectStorageForConfig(config);
			try {
				const result = await db.syncFromStore({
					store: storage.store,
					projectId: storage.projectId,
					prefix: storage.prefix,
				});
				return print(result, json);
			} finally {
				await db.close();
			}
		});
}
