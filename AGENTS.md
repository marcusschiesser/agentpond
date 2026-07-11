# Agent Instructions

## Changelog

This repository uses Changesets to generate package changelogs.

- Add a changeset in `.changeset/` for every user-facing change, package dependency change, CLI behavior change, or release-worthy bug fix.
- Use `patch` for fixes and dependency maintenance, `minor` for new features, and `major` for breaking changes.
- Keep changeset summaries concise and written for AgentPond users.
- Do not manually edit generated changelog output unless the release process has already run `pnpm changeset version`.

## AgentPond Skill

- Keep `skills/agentpond/SKILL.md` and `skills/agentpond/references/cli.md` in sync with CLI behavior changes.
- When a PR changes commands, flags, prompts, environment variables, or storage setup, update the skill in the same PR.

## Duplicate Code

- Use the `$dry-refactoring` skill when analyzing or fixing duplicate-code findings.

## Commits

- Use the normal `git commit` path so Husky pre-commit hooks run.
- Never use `git commit --no-verify` for commits in this repository.
- Never disable Git hooks with `HUSKY=0` or equivalent environment overrides for commits in this repository.
- If a hook fails, fix the underlying issue and retry the normal `git commit`; do not bypass the hook.
- If a hook changes files, review and stage those hook updates before committing again.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **agentpond** (1244 symbols, 2914 relationships, 98 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/agentpond/context` | Codebase overview, check index freshness |
| `gitnexus://repo/agentpond/clusters` | All functional areas |
| `gitnexus://repo/agentpond/processes` | All execution flows |
| `gitnexus://repo/agentpond/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
