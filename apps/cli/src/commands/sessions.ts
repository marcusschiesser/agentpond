import type { Command } from "commander";
import { CliError, limit, print } from "../cli-support.js";
import {
	addGlobalOptions,
	cacheForRead,
	commandContext,
	type GlobalOptions,
} from "../command-support.js";
import { sql } from "../sql.js";

type SessionListOptions = GlobalOptions & {
	limit?: string;
};

export function registerSessionsCommand(program: Command): void {
	const sessions = addGlobalOptions(
		program
			.command("sessions")
			.description("read sessions from the local cache"),
	);

	addGlobalOptions(sessions.command("list"))
		.description("list recent sessions")
		.option("--limit <n>", "maximum row count", "100")
		.action(async (options: SessionListOptions, command: Command) => {
			const { context, json } = commandContext(
				command.optsWithGlobals<GlobalOptions>(),
			);
			const db = cacheForRead(context.config);
			try {
				const rows = await db.query(
					`SELECT * FROM sessions ORDER BY last_seen_at DESC LIMIT ${limit(options)}`,
				);
				return print(rows, json);
			} finally {
				await db.close();
			}
		});

	addGlobalOptions(sessions.command("get <session-id>"))
		.description("read one session")
		.action(
			async (
				id: string | undefined,
				_options: GlobalOptions,
				command: Command,
			) => {
				if (!id) throw new CliError("Missing session id");
				const { context, json } = commandContext(
					command.optsWithGlobals<GlobalOptions>(),
				);
				const db = cacheForRead(context.config);
				try {
					const rows = await db.query(
						`SELECT * FROM sessions WHERE id = ${sql(id)} LIMIT 1`,
					);
					return print(rows, json);
				} finally {
					await db.close();
				}
			},
		);
}
