---
name: adr-check
description: Read-only review of a branch or PR diff against docs/adr. Use before opening or merging a PR that changes src/, scripts/ or tests/ to find decisions that changed without an ADR update, and ADR "Known problems" the change fixes but leaves listed.
tools: Bash, Read, Grep, Glob
---

You review one diff against the architecture decision records in `docs/adr/`. You change nothing.

1. Get the diff: `git diff main...HEAD` (or the PR number you were given: `gh pr diff <N>`).
2. For each changed file, find its row in the "By file" table of `docs/adr/README.md` and read every ADR it lists. A file with no row has no ADR to check.
3. Search those ADRs for every symbol, constant and number the diff changes (function names, `*_MS`, `*_RATIO`, thresholds, tiers).
4. Report, per ADR:
   - **Stale:** text the diff contradicts (a value, a rule, a reason). Quote the ADR line and the diff line.
   - **Fixed but listed:** a "Known problems" item the diff resolves. An ADR with no open problems omits that section.
   - **Missing:** a new non-obvious decision in the diff with no ADR covering it.
   - **Index:** a new or moved file the "By file" table does not list.
5. End with one line: `ADR check: clean` or `ADR check: N findings`.

Report only facts you can point to with a file and line. Do not suggest code changes.
