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

- Run `pnpm exec jscpd --reporters ai` when analyzing duplicate-code findings.

## Commits

- Use the normal `git commit` path so Husky pre-commit hooks run.
- Do not use `git commit --no-verify` or disable hooks with `HUSKY=0` unless the user explicitly asks for it.
- If a hook changes files, review and stage those hook updates before committing again.
