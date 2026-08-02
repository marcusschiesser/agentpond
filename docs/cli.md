# CLI reference

Run the published CLI with `npx agentpond`. The package requires Node.js 22 or newer.

```bash
npx agentpond --help
npx agentpond --version
```

## Automatic setup

```bash
npx agentpond init check
npx agentpond init
```

`init check` is a non-mutating preflight. Add `--json` for structured output.

`init` detects Firebase, Supabase, or Vercel, installs the
`agentpond-instrumentation` and `agentpond` project skills, and prints the
matching coding-agent prompt. When no managed platform is detected, it prints a
Files SDK workflow that uses the dependency-free `fs` adapter for real local
trace verification before choosing production storage. `init` does not edit
application code, provision storage, link a provider project, initialize an
environment, or create `.agentpond`.

When multiple platform markers exist, select one explicitly with `--platform firebase`, `--platform supabase`, or `--platform vercel`. The override is stateless and works with setup, environment, sync, and query commands. Forced Supabase or Vercel setup may begin before the project is linked; the coding agent asks for confirmation before linking or provisioning storage. `init` is interactive and does not support `--json`.

## Global options

```text
--env <name>  use an environment for this command
--platform <platform>  select firebase, supabase, or vercel for this command
--json        print machine-readable output where supported
--version     print the installed CLI version
```

## Select data

Use `env use` to select an environment for every deployment: an AgentPond
environment name for manual storage, a Firebase alias or project ID, a Supabase
project ref, or an exact Vercel deployment target. `--env` overrides that
selection for one command. If the project contains multiple provider markers,
pass the stateless `--platform <platform>` override to each AgentPond command.

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

Supabase uses the hosted project ref in `supabase/.temp/project-ref`. `env use`
delegates to `supabase link`; `--env` selects another hosted project or branch
for one command without changing that file:

```bash
npx agentpond env use <project-ref>
npx agentpond sync
npx agentpond --env <branch-project-ref> traces list --limit 10
```

Supabase data is isolated below `otel/<project-ref>/` in the dedicated private
`agentpond` bucket. Manual environment commands and `npx agentpond dev` are
unavailable in Supabase projects.

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
npx agentpond env init production --provider s3 --bucket agentpond
npx agentpond env init production --provider r2 --bucket agentpond
npx agentpond env init production --provider azure --container agentpond
npx agentpond env init local-minio --provider minio --bucket agentpond --endpoint http://localhost:9000
npx agentpond env init local --provider fs --root /absolute/project/.agentpond/envs/local/objects
npx agentpond env init netlify --provider netlify-blobs --store-name agentpond
npx agentpond env init oracle --provider oracle-cloud --bucket agentpond --namespace <namespace> --region eu-frankfurt-1
npx agentpond env use production
npx agentpond env current
npx agentpond env list
```

Every manual environment is a Files SDK environment. AgentPond exposes
`--bucket`, `--container`, `--endpoint`, `--namespace`, `--region`, `--root`,
and `--store-name` for supported adapters. Azure Blob Storage uses
`--container`; Netlify Blobs uses `--store-name`; Oracle Cloud uses `--bucket`,
`--namespace`, and `--region`. Provider credentials remain in the variables
documented by Files SDK. AgentPond rejects memory, Bun-only, unknown, malformed,
and unsupported adapter configurations, as well as adapters whose peer SDKs the
executing CLI cannot resolve.
`AGENTPOND_PROJECT_ID` defaults to `default-project`; the optional
`AGENTPOND_PREFIX` defaults to empty. Provider credentials remain ambient.
`env init` refuses to replace an existing environment file; edit that file
deliberately or initialize a different name.

## Local testing server

`npx agentpond dev` is a local testing facility, not a production deployment:

```bash
npx agentpond dev
eval "$(npx agentpond env get dev)"
```

The dev server writes directly to `.agentpond/envs/dev/cache.duckdb` and does
not construct an object store, so `sync` is not needed for dev. `dev` is
reserved and cannot be initialized with `env init`.

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
