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

`init` detects Firebase or Vercel, installs the `agentpond-instrumentation` and `agentpond` project skills, and prints a provider-specific coding-agent prompt. It does not edit application code, provision storage, link Vercel, or create `.agentpond`.

When both platform markers exist, select one explicitly with `--platform firebase` or `--platform vercel`. A forced Vercel setup may begin before the app is linked; the coding agent asks for confirmation before running `vercel link` or provisioning Blob. Unsupported projects exit with a link to [Manual deployment setup](./getting-started/manual-setup.md). `init` is interactive and does not support `--json`.

## Global options

```text
--env <name>  use an environment for this command
--json        print machine-readable output where supported
--version     print the installed CLI version
```

## Select data

Use `env use` to select an environment for every deployment: an AgentPond
environment name for manual storage, a Firebase alias or project ID, or an exact
Vercel deployment target. `--env` overrides that selection for one command.

```bash
npx agentpond env use <environment>
npx agentpond env current
```

For Firebase, `env use` delegates to the Firebase CLI's active-project state:

```bash
npx agentpond env use <alias-or-project-id>
npx agentpond sync
npx agentpond --env staging sync
```

AgentPond manual environment commands (`get`, `list`, and `init`) and
`npx agentpond dev` are unavailable in Firebase projects. Use `env use`,
one-command `--env` overrides, and the Firebase runtime instead.

Vercel uses the linked project and an exact deployment target. Production is
the default; `env use` persists another target in `.vercel/agentpond.json`, and
`--env` selects another target for one command:

```bash
npx agentpond sync
vercel target list --format json
npx agentpond env use staging
npx agentpond traces list --limit 10
npx agentpond --env preview sync
```

AgentPond pulls target credentials temporarily. The Vercel selection file is
bound to the linked project ID and is ignored with `.vercel`; no provider choice
is stored in `.agentpond`. Data is isolated below
`agentpond/otel/<vercel-project-id>-<target>/` even when projects and application
data share one private Blob store.

AgentPond manual environment commands (`get`, `list`, and `init`) and
`npx agentpond dev` are unavailable in Vercel projects. Use the Vercel runtime
and `env use` before sync or query commands.

Manual deployments use AgentPond environments:

```bash
npx agentpond env init production --store s3
npx agentpond env use production
npx agentpond env current
npx agentpond env list
```

Supported deployment stores are `s3` and `gcs`. The `local` store is available only for explicit tests and filesystem fixtures.

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
