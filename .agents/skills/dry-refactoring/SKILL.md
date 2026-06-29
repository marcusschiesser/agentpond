---
name: dry-refactoring
description: Guided workflow to eliminate copy-paste duplication detected by jscpd. Refactor clones using extract function, module, constant, or base class strategies.
---

# dry-refactoring

Guided workflow to eliminate copy-paste duplication in source code using the repository-local jscpd configuration.

## Prerequisites

First, run jscpd from the repository root with the project-local dependency so `.jscpd.json` is honored:

```bash
pnpm exec jscpd --reporters ai
```

For CI parity or a concise console summary, run:

```bash
pnpm exec jscpd
```

Do not use `npx jscpd <path>` in this repository: it can bypass the pinned workspace dependency and may ignore the repo-level exclusions for tests, fixtures, examples, generated output, and lockfiles.

## Workflow

1. Run `pnpm exec jscpd --reporters ai` from the repository root
2. Parse each clone line to identify the two duplicated locations (file + line range)
3. Read both code fragments from the source files
4. Understand what the duplicated code does
5. Design a refactoring: extract a shared function, class, module, or constant
6. Apply the refactoring — update both locations and all other usages
7. Re-run `pnpm exec jscpd --reporters ai` to confirm the clone is eliminated
8. Repeat for remaining clones, highest-impact first

## Refactoring Strategies

**Extract function** — when the duplicate is a block of logic:
```ts
// Before: same block in two places
// After: shared function called from both places
```

**Extract module/utility** — when the duplicate spans multiple files in different domains:
```ts
// Move shared logic to a shared utility file and import it
```

**Extract constant or config** — when the duplicate is repeated data or configuration.

**Template/base class** — when the duplicate is structural (e.g., repeated class shape).

Always ensure:
- All call sites are updated, not just the two reported by jscpd
- Tests still pass after refactoring
- The extracted abstraction has a clear, descriptive name

## Tips

- Start with clones that have the highest line count — they have the most impact
- A clone between test files may indicate a missing test helper
- Clones across unrelated modules may signal a missing shared utility
- Prefer the repository's `.jscpd.json` thresholds and ignore rules before adding ad-hoc CLI flags
