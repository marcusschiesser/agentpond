import { AgentPondCache } from "@agentpond/duckdb";
import type { Command } from "commander";
import { print } from "../cli-support.js";
import {
	addGlobalOptions,
	commandContext,
	type GlobalOptions,
} from "../command-support.js";

export function registerSyncCommand(program: Command): void {
	addGlobalOptions(program.command("sync"))
		.description("sync object storage into the local DuckDB cache")
		.action(async (_options: GlobalOptions, command: Command) => {
			const { context, json } = commandContext(
				command.optsWithGlobals<GlobalOptions>(),
			);
			if (context.usesAgentPondDevServer) {
				return print(
					{
						skipped: true,
						reason:
							"calling npx agentpond sync is not needed for npx agentpond dev",
					},
					json,
				);
			}
			const db = new AgentPondCache(context.config.dbPath);
			const storage = await context.resolveStorage();
			try {
				const result = await db.syncFromStore(storage);
				return print(result, json);
			} finally {
				await db.close();
			}
		});
}
