# Firebase setup

Firebase is AgentPond's automatic setup path. A coding agent adds OpenInference tracing to trusted server-side code and exports spans directly to the project's Firebase Storage bucket.

## Prerequisites

- Node.js 22 or newer
- An initialized Firebase project with `.firebaserc` or `firebase.json`
- A project selected with the Firebase CLI:

```bash
firebase login
firebase use <alias-or-project-id>
```

- A trusted Node.js server runtime, such as Cloud Functions for Firebase or another server package using Firebase Admin

Do not put Firebase Admin or the AgentPond Firebase exporter in browser or mobile code.

## Install the skills

Run this from the Firebase root or a nested package:

```bash
npx agentpond init
```

AgentPond installs the `agentpond-instrumentation` and `agentpond` project skills using the coding-agent selection provided by the Skills CLI. It does not edit application code or create `.agentpond` during setup.

Copy the generated prompt into the selected coding agent. The instrumentation skill will inspect the server package, existing Firebase Admin and OpenTelemetry setup, AI framework, and Storage Rules before it proposes changes.

Detailed Firebase exporter and Storage Rules requirements live in the [instrumentation skill](../../skills/agentpond-instrumentation/references/firebase.md).

## Verify

After the coding agent builds the application and exercises one real AI request:

```bash
firebase use <alias-or-project-id>
npx agentpond sync
npx agentpond traces list --limit 10
```

Inspect the trace when deeper verification is needed:

```bash
npx agentpond traces get <trace-id>
npx agentpond observations list --traceId <trace-id>
```

Firebase owns project selection. Do not use `npx agentpond env init` or `npx agentpond env use` in Firebase projects.

## Troubleshooting

- **Firebase is not detected:** Run the command from a directory below the Firebase root and confirm `.firebaserc` or `firebase.json` exists.
- **Project ID is missing:** Run `firebase use <alias-or-project-id>` and retry. AgentPond follows both `.firebaserc` aliases and the Firebase CLI's global active-project selection.
- **No trusted server runtime exists:** Add or select a server runtime before using the Firebase Admin exporter; never move it into client code.
- **No traces appear:** Confirm the instrumented code path ran, the provider flushed, Firebase Admin selected the default app and bucket, and then rerun `npx agentpond sync`.
