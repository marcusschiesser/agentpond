import type { Command } from "commander";
import { CliError, print } from "../cli-support.js";
import {
	addGlobalOptions,
	cacheForRead,
	commandContext,
	type GlobalOptions,
} from "../command-support.js";

export function registerSqlCommand(program: Command): void {
	addGlobalOptions(program.command("sql <query...>"))
		.description("run SQL against the local DuckDB cache")
		.action(
			async (
				queryParts: string[],
				_options: GlobalOptions,
				command: Command,
			) => {
				const query = queryParts.join(" ");
				if (!query) throw new CliError("Missing SQL query");
				const { context, json } = commandContext(
					command.optsWithGlobals<GlobalOptions>(),
				);
				const db = cacheForRead(context.config);
				try {
					const rows = await db.query(query);
					return print(rows, json);
				} finally {
					await db.close();
				}
			},
		);
}
