# Turn a failed Vercel Eve trace into an eval and a fix

This example is a three-part debugging story for a small Vercel Eve weather agent:

```text
Part 1: wrong answer in an AgentPond trace
  -> coding agent reads the trace and writes an Eve eval
Part 2: the eval reproduces the failure
  -> coding agent treats the eval as the contract and fixes the agent
Part 3: the unchanged eval passes and the new trace is correct
```

Each directory is a complete snapshot of the same Eve app:

| Part | Directory | What changes |
| --- | --- | --- |
| 1 | `parts/01-failed-trace` | The agent calls `get_weather`, ignores its result, and returns a contradictory answer. |
| 2 | `parts/02-eval-from-trace` | The broken agent is unchanged; a regression eval derived from the trace is added. |
| 3 | `parts/03-fixed-agent` | The eval is unchanged; the agent instructions now require the tool result to be reported exactly. |

The app uses OpenAI's `gpt-5.6-luna` directly through the AI SDK.

All three parts use the Files SDK filesystem adapter so the walkthrough runs locally without storage credentials:

```text
Eve -> OpenTelemetry -> AgentPond exporter -> Files SDK -> local filesystem
```

Only the Files SDK client construction is storage-specific. The same `createFilesSpanExporter({ files })` calls work with any [Files SDK storage adapter](https://files-sdk.dev/docs/providers).

## Eve tracing alternatives

Eve already provides two tracing options:

- [Zero-config local traces](https://eve.dev/docs/guides/instrumentation#zero-config-local-traces). They are convenient for local debugging, but they are created only by `eve dev` and do not capture deployed production runs.
- [Vercel Agent Runs](https://vercel.com/changelog/eve-agent-observability) provide a managed view of production agent traces. 

AgentPond is useful when production traces should remain independent of the hosting platform: You can use Vercel, another cloud, or self-hosted infrastructure. This is usually cheaper than operating or buying a full observability platform.

## Prerequisites

- Node.js 24 or newer
- An `OPENAI_API_KEY`

Run all commands below from the AgentPond repository root.

First, install the workspace dependencies and set the model credential:

```sh
pnpm install
export OPENAI_API_KEY=...
```

## Configure AgentPond storage

Create and select a filesystem-backed AgentPond environment, then load it into every shell that runs Eve or queries AgentPond:

```sh
npx agentpond env init eve-eval-loop \
  --provider fs \
  --root "$(pwd)/examples/vercel-eve/.agentpond/objects"
npx agentpond env use eve-eval-loop
eval "$(npx agentpond env get eve-eval-loop)"
```

The exported values include `FILES_SDK_ROOT` and `AGENTPOND_PROJECT_ID` which will be used by the Eve agent in the following steps.

## Part 1: generate the failed trace

Start the deliberately broken agent:

```sh
pnpm --dir examples/vercel-eve trace:failed
```

Ask exactly:

```text
What is the weather in Berlin?
```

The fixture tool returns `Rainy` and `12°C`, but an intentionally bad instruction prompt forces the assistant to answer `Sunny` and `72°F`. The request completes successfully at the protocol level, so we're dealing with a semantic failure of the agent.

Stop Eve, sync and show the recorded trace:

```sh
npx agentpond sync
npx agentpond traces list --limit 1
npx agentpond observations list --traceId <trace-id>
```

Analyzing traces by hand is no fun, so let our coding agent do the job!

## Transform Part 1 into Part 2: ask a coding agent to generate the eval

Tell your coding agent to inspect the failed trace and to generate an eval:

```text
Read and follow skills/agentpond/SKILL.md. Inspect AgentPond traces in eve-eval-loop environment
then turn its observable weather failure into the smallest deterministic Eve
regression eval.

Copy examples/vercel-eve/parts/01-failed-trace to
examples/vercel-eve/generated/02-eval-from-trace. Preserve the broken agent and
add only the eval. The eval must require a successful run, exactly one completed
get_weather call for Berlin, and a reply containing the condition and Celsius
temperature returned by the tool. Run it and confirm that it reproduces the
trace failure.
```

> Note: For your own projects, you don't need to add the skill to your prompt. Just install the AgentPond skill by calling `npx agentpond init`.

You can run the eval again with:

```sh
pnpm --dir examples/vercel-eve eval:generated:failed
```

The generated eval should exit two assertions failing: the run and `get_weather` call succeed, while the `Rainy` and `12°C` assertions fail.

## Transform Part 2 into Part 3: ask a coding agent to fix the agent

Now give the coding agent a second prompt. This time the failing eval is the acceptance contract:

```text
Use the failing eval in examples/vercel-eve/generated/02-eval-from-trace as the regression contract.

Copy that snapshot to examples/vercel-eve/generated/03-fixed-agent and make the
smallest agent-only fix that passes the unchanged eval. Do not weaken or
special-case the eval. Run the fixed snapshot's eval and confirm that it passes.
```

You can run the eval again and check that all four assertions pass:

```sh
pnpm --dir examples/vercel-eve eval:generated:fixed
```

This closes the loop: a production-like trace becomes a executable regression.

## Use another Files SDK adapter

The local filesystem adapter is convenient for this walkthrough, but production agents usually run across processes, machines, or regions and need shared object storage. Choose any [Files SDK storage adapter](https://files-sdk.dev/docs/providers) that every agent runtime can write to and AgentPond can read from.

Only `agent/instrumentation.ts` changes when storage changes. For example, replace the `files-sdk/fs` import and `fs({ root })` adapter with an S3 client:

```ts
import { Files } from "files-sdk";
import { s3 } from "files-sdk/s3";

const files = new Files({
  adapter: s3({ bucket: process.env.AGENTPOND_FILES_BUCKET! }),
});
```

Pass that client to the same `createFilesSpanExporter({ files })` call. Install the adapter's peer SDK, configure its server-side credentials, and initialize an AgentPond environment that reads the same storage. See the [Files SDK provider catalog](https://files-sdk.dev/docs/providers) for available adapters.

Eve records model inputs and outputs by default. Review that data path and set `recordInputs: false` and/or `recordOutputs: false` in each `defineInstrumentation()` call before using sensitive or regulated data.
