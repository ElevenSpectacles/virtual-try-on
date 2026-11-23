---
name: delete-comment
description: Audit code comments, classify each as tautology, excuse, stale or decision record, then delete them, filing issues for excuses and ADRs for decisions, and tighten the comment ratchet. Use when asked to delete, remove, audit or clean up comments, when the user types /delete-comment, or when `npm run lint:comments` fails.
---

# Delete comments

`/delete-comment [path ...]`: with no path, the scope is the whole repo.

`npm run lint:comments` bans comments. `.comment-baseline.json` holds hashes of
any that are still tolerated and can only shrink. Never add to it by hand and
never widen the directive allowlist in `scripts/lib/comments.ts` to admit prose.

## 1. Inventory

```bash
out=$(mktemp -d)
npx tsx scripts/lint-comments.ts --list [path ...] > "$out/comments.jsonl"
```

Each line has an `id`, the `comment` and the code around it. Read every one.

## 2. Classify

Read the code before deciding. Do not classify by keyword. Every id gets
exactly one category, written to `$out/ledger.tsv` as
`id<TAB>category<TAB>destination`.

| Category | Test | Destination |
| --- | --- | --- |
| Tautology | The name, type or code already says it | none |
| Stale | It names code or behaviour that is gone or different; check with a search | none |
| Excuse | It makes a hack acceptable: "good enough", "for now", "keep in sync", "must run in this order", a swallowed error, a fixed sleep, a tuned magic number | GitHub issue |
| Decision record | An important, non-obvious reason, constraint, measurement, unit or convention | ADR |

When a comment is both, the more serious category wins: excuse, decision
record, stale, tautology. Nothing true is lost to that rule: an excuse that
also holds a reason, measurement or convention gets an issue **and** an ADR
entry linking it, and a stale comment with a still-true reason is a decision
record with the stale part corrected. Units, coordinate spaces and component
order the code does not show are decisions, not tautologies. Claims are not evidence. Where a comment asserts
that some maths or fallback works, check it; that is where the bugs are.

## 3. Excuses become issues

1. Group by root cause, one issue per hack.
2. Check for duplicates: `gh issue list --state all --search "<keywords>"`.
3. Write the problem, the evidence (reproduced, or found by reading), the fix,
   and permalinks to the comment at a SHA that exists on `origin`.
4. The repo is public. Keep @names in backticks, and send security problems
   to the user instead of filing them.
5. File the issues if the user asked for that, otherwise show the list first.

Do not fix the hack in the same change.

## 4. Decisions become ADRs

Extend the matching ADR listed in `docs/adr/README.md`: a `### file` heading,
then `#### symbol`, then the reason. Correct stale names while moving it. Add a
numbered ADR only for a new decision, and keep the "By file" index current.

## 5. Delete and tighten

Only delete after the issue or ADR exists.

```bash
cut -f1 "$out/ledger.tsv" > "$out/ids.txt"
npx tsx scripts/lint-comments.ts --delete "$out/ids.txt"
npm run lint:comments -- --update
```

Ids contain line numbers: if a file changed, list again.

## 6. Verify

- `git diff`: only comments and whitespace changed in source.
- `npm run verify:unit`, `npm run typecheck`, `npm run build`.
- `release-smoke` if `src/` changed. The browser goldens if shader text changed.

Report the count per category, the issues filed and the lines shed
(`git diff --shortstat`).
