# Agent Instructions

## Changelog

This repository uses Changesets to generate package changelogs.

- Add a changeset in `.changeset/` for every user-facing change, package dependency change, CLI behavior change, or release-worthy bug fix.
- Use `patch` for fixes and dependency maintenance, `minor` for new features, and `major` for breaking changes.
- Keep changeset summaries concise and written for AgentPond users.
- Do not manually edit generated changelog output unless the release process has already run `pnpm changeset version`.
