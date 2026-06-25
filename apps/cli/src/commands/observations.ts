import type { Command } from "commander";
import { limit, print } from "../cli-support.js";
import {
	addGlobalOptions,
	cacheForRead,
	commandContext,
	type GlobalOptions,
} from "../command-support.js";
import { sql } from "../sql.js";

type ObservationListOptions = GlobalOptions & {
	limit?: string;
	traceId: string;
};

export function registerObservationsCommand(program: Command): void {
	const observations = addGlobalOptions(
		program
			.command("observations")
			.description("read observations from the local cache"),
	);

	addGlobalOptions(observations.command("list"))
		.description("list observations for a trace")
		.requiredOption("--traceId <trace-id>", "trace id")
		.option("--limit <n>", "maximum row count", "100")
		.action(async (options: ObservationListOptions, command: Command) => {
			const globalOptions = command.optsWithGlobals<GlobalOptions>();
			const { config, json } = commandContext(globalOptions);
			const db = cacheForRead(config);
			try {
				const rows = await db.query(
					// Keep this query chronological and cheap. A full parent-before-child tree
					// order is nicer for same-timestamp edge cases, but requires recursive
					// sorting for every list call.
					`SELECT * FROM observations WHERE trace_id = ${sql(options.traceId)} ORDER BY start_time ASC, id ASC LIMIT ${limit(options)}`,
				);
				return print(rows, json);
			} finally {
				await db.close();
			}
		});
}
