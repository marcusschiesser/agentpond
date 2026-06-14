#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
  AcceptedEventWriter,
  configFromEnv,
  eventTypes,
  loadEnvFile,
  S3ObjectStore,
  type IngestionEvent,
} from "@aperto/core";
import { ApertoDuckDb } from "@aperto/duckdb";

type ParsedArgs = {
  flags: Record<string, string | boolean>;
  positionals: string[];
};

export async function main(argv = process.argv): Promise<void> {
  const parsed = parseArgs(argv.slice(2));
  if (parsed.flags.env && typeof parsed.flags.env === "string") {
    loadEnvFile(parsed.flags.env);
  }

  const config = configFromEnv({
    dbPath: stringFlag(parsed, "db"),
    s3Bucket: stringFlag(parsed, "s3-bucket"),
    s3Prefix: stringFlag(parsed, "s3-prefix"),
    s3Endpoint: stringFlag(parsed, "s3-endpoint"),
  });
  const json = Boolean(parsed.flags.json);
  const [resource, action, ...rest] = parsed.positionals;

  try {
    if (!resource || parsed.flags.help || parsed.flags.h) return printHelp();
    if (resource === "sync") {
      const db = new ApertoDuckDb(config.dbPath);
      const result = await db.syncFromStore({
        store: new S3ObjectStore(config.s3),
        projectId: config.projectId,
        prefix: config.s3.prefix,
      });
      await db.close();
      return print(result, json);
    }
    if (resource === "sql") {
      const query = rest.length > 0 ? [action, ...rest].join(" ") : action;
      if (!query) throw new CliError("Missing SQL query");
      const db = new ApertoDuckDb(config.dbPath);
      const rows = await db.query(query);
      await db.close();
      return print(rows, json);
    }
    if (resource === "scores" && action === "create") {
      return createScore(parsed, config, json);
    }

    const db = new ApertoDuckDb(config.dbPath);
    const rows = await runReadCommand(db, resource, action, rest, parsed);
    await db.close();
    return print(rows, json);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = error instanceof CliError ? 2 : 1;
  }
}

async function createScore(parsed: ParsedArgs, config: ReturnType<typeof configFromEnv>, json: boolean): Promise<void> {
  const name = requiredFlag(parsed, "name");
  const value = requiredFlag(parsed, "value");
  const source = stringFlag(parsed, "source") ?? "API";
  if (source === "EVAL") {
    throw new CliError("scores create only allows source=API or source=ANNOTATION");
  }
  if (source !== "API" && source !== "ANNOTATION") {
    throw new CliError("source must be API or ANNOTATION");
  }
  const now = new Date().toISOString();
  const event: IngestionEvent = {
    id: randomUUID(),
    timestamp: now,
    type: eventTypes.SCORE_CREATE,
    body: {
      id: stringFlag(parsed, "id") ?? randomUUID(),
      traceId: stringFlag(parsed, "trace-id"),
      observationId: stringFlag(parsed, "observation-id"),
      sessionId: stringFlag(parsed, "session-id"),
      name,
      value: parseScoreValue(value),
      dataType: stringFlag(parsed, "data-type") as "NUMERIC" | "CATEGORICAL" | "BOOLEAN" | "CORRECTION" | "TEXT" | undefined,
      source,
      comment: stringFlag(parsed, "comment"),
      createdAt: now,
    },
  };

  const writer = new AcceptedEventWriter({
    store: new S3ObjectStore(config.s3),
    projectId: config.projectId,
    prefix: config.s3.prefix,
  });
  const manifest = await writer.writeAcceptedEvents([event]);
  print({ eventId: event.id, scoreId: event.body.id, objects: manifest.objects }, json);
}

async function runReadCommand(
  db: ApertoDuckDb,
  resource: string,
  action: string | undefined,
  rest: string[],
  parsed: ParsedArgs,
): Promise<Record<string, unknown>[]> {
  if (action === "--help" || !action) return helpRows(resource);

  if (resource === "traces" && action === "list") {
    return db.query(`SELECT * FROM traces ORDER BY start_time DESC LIMIT ${limit(parsed)}`);
  }
  if (resource === "traces" && action === "get") {
    const id = rest[0];
    if (!id) throw new CliError("Missing trace id");
    return db.query(`SELECT * FROM traces WHERE id = ${sql(id)} LIMIT 1`);
  }
  if (resource === "observations" && action === "list") {
    const traceId = requiredFlag(parsed, "trace-id");
    return db.query(`SELECT * FROM observations WHERE trace_id = ${sql(traceId)} ORDER BY start_time ASC LIMIT ${limit(parsed)}`);
  }
  if (resource === "sessions" && action === "list") {
    return db.query(`SELECT * FROM sessions ORDER BY last_seen_at DESC LIMIT ${limit(parsed)}`);
  }
  if (resource === "sessions" && action === "get") {
    const id = rest[0];
    if (!id) throw new CliError("Missing session id");
    return db.query(`SELECT * FROM sessions WHERE id = ${sql(id)} LIMIT 1`);
  }
  if (resource === "scores" && action === "list") {
    const traceId = stringFlag(parsed, "trace-id");
    const observationId = stringFlag(parsed, "observation-id");
    if (!traceId && !observationId) throw new CliError("scores list requires --trace-id or --observation-id");
    const filters = [
      traceId ? `trace_id = ${sql(traceId)}` : undefined,
      observationId ? `observation_id = ${sql(observationId)}` : undefined,
    ].filter(Boolean);
    return db.query(`SELECT * FROM scores WHERE ${filters.join(" AND ")} ORDER BY timestamp DESC LIMIT ${limit(parsed)}`);
  }

  throw new CliError(`Unknown command: ${resource} ${action}`);
}

function parseArgs(args: string[]): ParsedArgs {
  const flags: ParsedArgs["flags"] = {};
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (["json", "help"].includes(key)) {
      flags[key] = true;
      continue;
    }
    const value = args[i + 1];
    if (!value || value.startsWith("--")) throw new CliError(`Missing value for --${key}`);
    flags[key] = value;
    i += 1;
  }
  return { flags, positionals };
}

function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === "string" ? value : undefined;
}

function requiredFlag(parsed: ParsedArgs, name: string): string {
  const value = stringFlag(parsed, name);
  if (!value) throw new CliError(`Missing --${name}`);
  return value;
}

function limit(parsed: ParsedArgs): number {
  const raw = stringFlag(parsed, "limit");
  if (!raw) return 100;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1 || value > 10000) throw new CliError("--limit must be between 1 and 10000");
  return value;
}

function parseScoreValue(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  const numeric = Number(value);
  return Number.isNaN(numeric) ? value : numeric;
}

function sql(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function print(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (Array.isArray(value)) {
    console.table(value);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

function printHelp(): void {
  console.log(`aperto - local Langfuse-compatible trace analytics

Usage:
  aperto sync [--json]
  aperto traces list [--limit n] [--json]
  aperto traces get <trace-id> [--json]
  aperto observations list --trace-id <trace-id> [--json]
  aperto sessions list [--json]
  aperto sessions get <session-id> [--json]
  aperto scores create --name <name> --value <value> --trace-id <trace-id>
  aperto scores list --trace-id <trace-id> [--json]
  aperto scores list --observation-id <observation-id> [--json]
  aperto sql "select ..." [--json]

Global flags:
  --env <path>
  --db <path>
  --s3-bucket <bucket>
  --s3-prefix <prefix>
  --s3-endpoint <url>
  --json`);
}

function helpRows(resource: string): Record<string, unknown>[] {
  return [{ resource, hint: "Run aperto --help for command usage." }];
}

class CliError extends Error {}

await main();
