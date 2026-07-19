# Vercel setup

Vercel is an automatic AgentPond setup path. A coding agent links the application when needed, connects a private Vercel Blob store, and adds direct OpenInference span export to trusted Node.js server code.

## Prerequisites

- Node.js 22 or newer
- A Vercel application with a trusted Node.js Function, route, server action, or other server entrypoint
- Vercel CLI 50.20 or newer
- Access to link the project and manage its Blob integration

Do not put the AgentPond Vercel exporter in browser, client, Routing Middleware, Edge Runtime, or static code.

## Install the skills

Run from the application or a nested package:

```bash
npx agentpond init
```

If automatic detection is ambiguous or the project is not linked yet, use:

```bash
npx agentpond init --platform vercel
```

AgentPond installs the `agentpond-instrumentation` and `agentpond` project skills. It does not edit application code, link the project, provision Blob, or create `.agentpond`. Copy the generated prompt into the coding agent; it inspects the app and asks for confirmation before making those changes.

The skill reuses a connected private Blob store or creates one when needed. The store may be shared by application data and multiple Vercel projects because traces are isolated below:

```text
agentpond/otel/<vercel-project-id>-<target>/...
```

Targets use exact Vercel names: `production`, `preview`, `development`, or a custom target such as `staging`. Preview branches intentionally share one `preview` partition.

## Verify and query targets

Production is selected by default. Persist another target with `env use`:

```bash
npx agentpond env use production
npx agentpond env current
npx agentpond sync
npx agentpond traces list --limit 10
```

List targets, persist a selection, or override it for one command:

```bash
vercel target list --format json
npx agentpond env use staging
npx agentpond sync
npx agentpond traces list --limit 10
npx agentpond --env preview traces list --limit 10
```

AgentPond stores the linked project ID and selected target in the ignored
`.vercel/agentpond.json` file. It temporarily resolves the effective target's
Vercel environment and deletes the pulled file after reading it.

AgentPond manual environment commands (`get`, `list`, and `init`) and
`npx agentpond dev` are unavailable in Vercel projects. Use `env use` for target
selection and Vercel deployments to exercise the instrumented application.

## Troubleshooting

- **Vercel is not detected:** Run inside a linked project or use `npx agentpond init --platform vercel`.
- **The project is not linked:** Let the coding agent run `vercel link` after confirming the intended app and scope.
- **A target cannot access Blob:** Connect the private Blob store to that target in the Vercel dashboard and retry.
- **No traces appear:** Confirm a trusted Node.js path ran, Vercel exposed its system environment variables, the batch processor flushed, and the query used the same target.
