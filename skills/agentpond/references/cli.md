# AgentPond data-access CLI

Run AgentPond through `npx` unless it is installed globally.

## Select data

Use the provider-specific reference for Firebase or Vercel. Environment
selection uses the same commands for every provider:

```bash
npx agentpond env current
npx agentpond env use <environment>
npx agentpond --env staging sync
```

`env use` persists through the detected provider. `--env` overrides that
selection for one command. The provider-specific meaning and persistence are
documented in the Firebase and Vercel references. Sync before querying when
recent data matters.

For manually configured S3 or GCS deployments, `env list`, `env init`, and
`env get` manage AgentPond environment files. Those manual operations and the
local testing server are unavailable when AgentPond detects Firebase or Vercel.

`npx agentpond init` installs both AgentPond skills and prints a provider-specific coding-agent prompt. Cancelling skill installation stops setup without printing a success message or prompt.

## Query commands

```bash
npx agentpond sync
npx agentpond sync --json

npx agentpond traces list --limit 25
npx agentpond traces get <trace-id>
npx agentpond observations list --traceId <trace-id>

npx agentpond sessions list
npx agentpond sessions get <session-id>

npx agentpond scores list --traceId <trace-id>
npx agentpond scores list --observationId <observation-id>

npx agentpond sql "select * from traces limit 10"
npx agentpond sql "select * from scores where trace_id = '<trace-id>'" --json
```

Use JSON output when another tool needs to consume the result. Use focused commands for individual resources and SQL for aggregation, joins, time filtering, raw events, and cost analysis.
