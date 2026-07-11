# CLI reference

Run the published CLI with `npx agentpond`. The package requires Node.js 22 or newer.

```bash
npx agentpond --help
npx agentpond --version
```

## Automatic setup

```bash
npx agentpond init
```

`init` currently supports Firebase. It detects the Firebase root and active project, installs the `agentpond-instrumentation` and `agentpond` project skills, and prints a coding-agent prompt. It does not edit application code or create `.agentpond`.

If the current project is not Firebase, the command exits with a link to [Manual deployment setup](./getting-started/manual-setup.md). `init` is interactive and does not support `--json`.

## Global options

```text
--env <name>  use an existing non-Firebase AgentPond environment
--json        print machine-readable output where supported
--version     print the installed CLI version
```

## Select data

Firebase uses Firebase project selection:

```bash
firebase use <alias-or-project-id>
npx agentpond sync
```

Do not use `npx agentpond env init` or `npx agentpond env use` for Firebase.

Non-Firebase deployments use AgentPond environments:

```bash
npx agentpond env init production --store s3
npx agentpond env use production
npx agentpond env current
npx agentpond env list
```

Supported deployment stores are `s3`, `gcs`, and `vercel`. The `local` store is available only for explicit tests and filesystem fixtures.

## Local testing server

`npx agentpond dev` is a local testing facility, not a production deployment:

```bash
npx agentpond dev
eval "$(npx agentpond env get dev)"
```

The dev server writes directly to `.agentpond/envs/dev/cache.duckdb`, so `sync` is not needed for dev.

## Sync

```bash
npx agentpond sync
npx agentpond sync --json
```

Sync scans object storage and projects new data into the selected local DuckDB cache.

## Traces and observations

```bash
npx agentpond traces create --name "manual trace"
npx agentpond traces list --limit 25
npx agentpond traces get <trace-id>
npx agentpond observations list --traceId <trace-id>
```

Manual trace creation is primarily useful for tests and smoke checks.

## Sessions

```bash
npx agentpond sessions list
npx agentpond sessions get <session-id>
```

## Scores

```bash
npx agentpond scores create --name quality --value 0.9 --traceId <trace-id>
npx agentpond scores list --traceId <trace-id>
npx agentpond scores list --observationId <observation-id>
```

## SQL

```bash
npx agentpond sql "select id, name, session_id from traces limit 10"
npx agentpond sql "select * from scores where trace_id = '<trace-id>'" --json
```

DuckDB caches live under `.agentpond/envs/<name>/cache.duckdb` and are rebuildable from object storage.
