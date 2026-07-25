# Supabase setup

Supabase is an automatic AgentPond setup path for hosted projects. A coding
agent creates or reuses a dedicated private Storage bucket, reviews Storage RLS
policies, and adds direct OpenInference span export to a Supabase Edge Function
or trusted Node.js backend.

## Prerequisites

- Node.js 22 or newer for the AgentPond CLI
- A hosted Supabase project initialized with `supabase/config.toml`
- Supabase CLI authentication and project access
- A Supabase Edge Function or trusted Node.js backend for the AI workload

Run from the Supabase root or a nested directory:

```bash
supabase login
npx agentpond env use <project-ref>
npx agentpond init
```

If automatic detection is ambiguous, use:

```bash
npx agentpond init --platform supabase
```

AgentPond installs the `agentpond-instrumentation` and `agentpond` project
skills. It does not edit application code, link the project, create the bucket,
or create `.agentpond` during setup. Copy the generated prompt into the coding
agent; it inspects the runtime, telemetry setup, migrations, and Storage
policies before proposing changes.

## Storage and credentials

Use a dedicated private bucket named `agentpond`. AgentPond writes directly to:

```text
otel/<project-ref>/...
```

A private bucket still uses RLS for authenticated Storage API access. Review
all policies on `storage.objects` that could match `bucket_id = 'agentpond'`,
including broad policies without a bucket condition. Do not expose this bucket
to application roles.

The runtime exporter accepts only a modern Supabase secret key or legacy
`service_role` key. Supabase Edge Functions can use their built-in
`SUPABASE_URL` and `SUPABASE_SECRET_KEYS` values. Node.js backends must keep the
same credentials in server-only secret configuration. Publishable and anonymous
keys are rejected.

Detailed Edge, Node.js, bucket, and RLS guidance lives in the
[Supabase instrumentation reference](../../skills/agentpond-instrumentation/references/supabase.md).

## Verify and query hosted projects

After deploying and exercising one real AI request:

```bash
npx agentpond env current
npx agentpond sync
npx agentpond traces list --limit 10
```

`env use` delegates to the Supabase CLI link command:

```bash
npx agentpond env use <project-ref>
```

Use a one-command override to inspect another hosted project or Supabase branch
without changing the persisted link. Branches have distinct project refs:

```bash
npx agentpond --env <branch-project-ref> sync
npx agentpond --env <branch-project-ref> traces list --limit 10
```

AgentPond manual environment commands (`get`, `list`, and `init`) and
`npx agentpond dev` are unavailable in Supabase projects.

## Troubleshooting

- **Supabase is not detected:** Run below a root containing
  `supabase/config.toml`, or select `--platform supabase` during setup.
- **Multiple providers are detected:** Add the stateless
  `--platform supabase` override to each AgentPond environment, sync, or query
  command.
- **The project is unlinked:** Run
  `npx agentpond env use <project-ref>` and confirm
  `supabase/.temp/project-ref` contains the expected 20-letter ref.
- **Storage access fails:** Confirm the CLI account can access the hosted
  project and the `agentpond` bucket exists and is private.
- **A key is rejected:** Use the default modern secret key or legacy
  `service_role`; never use a publishable or anonymous key.
- **No traces appear:** Confirm the trusted path ran, the batch processor
  flushed (`EdgeRuntime.waitUntil()` for Edge Functions), and the query used the
  same project ref.
