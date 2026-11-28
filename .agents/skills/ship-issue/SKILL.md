---
name: ship-issue
description: Take one GitHub issue from branch to a green PR — branch from main, do the work, run the local checks, commit conventionally with "Closes #N", open the PR and watch CI. Never merges. Use when the user says "start N" or asks to ship an issue.
disable-model-invocation: true
---

# Ship an issue

Input: an issue number `N`.

## Steps

1. `gh issue view N`, then read the ADRs listed for each file you will touch (`docs/adr/README.md`, "By file").
2. `git checkout main && git pull && git checkout -b <type>/<short-name>`. If the change edits lines an open PR also edits, branch from that PR's branch and say "merge #<that PR> first" in the PR body.
3. Do the work. Module only: never edit the host storefront; list host follow-ups in the PR body.
4. Run, in order, and fix until each passes:
   - `npm run lint:comments`
   - `npx vitest run`
   - `npm run typecheck`
   - `npm run verify:glsl` when a `*_GLSL` constant or shader patch changed
   - the `release-smoke` skill when the change is publish-affecting (see AGENTS.md)
5. Run the `adr-check` agent on the branch; apply its findings in the same branch.
6. Commit with a conventional message whose body ends `Closes #N`. The git hooks run; never skip them.
7. `git push -u origin HEAD`, then `gh pr create --base main` with a body that starts `Closes #N` and lists what changed.
8. `gh pr checks <PR> --watch`. On a failure, read the log, fix, push, watch again.

## Stop

Report the PR URL and check results. Merge only when the user names the PR ("merge <PR>"), with `gh pr merge <PR> --merge --body ""`. Never merge a release PR unless it is named.
