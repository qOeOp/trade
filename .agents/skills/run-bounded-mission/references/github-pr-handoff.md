# GitHub Delivery

Load only when the frozen endpoint includes a GitHub pull request. GitHub delivery is part of
Disposition, not a separate lifecycle or a custom merge service.

Freeze the repository, pull request, base, candidate head, endpoint (`open`, `merge-ready`, or
`merged`), Draft/Ready state, required signals, merge method, and authority for each write:
publication, comment, review request or submission, thread resolution, repository settings,
auto-merge or queue changes, and merge.

Use the connected GitHub owner or `gh` under its current official contract. Do not use a skill-owned
script as an authority proxy.

## Opening discovery

Treat a PR-opening automated review as bounded discovery, not acceptance. Collect its complete
result before revising. Reproduce each material finding against the current candidate. Resolve a
thread only when the finding is verified as addressed, inapplicable, duplicate, or non-material;
`outdated` alone is not evidence. Missing, started, ambiguous, or failed review remains outstanding.

A candidate change invalidates candidate-bound review and verification evidence. Re-run required
deterministic checks and Verify the new complete candidate. Do not create review loops merely to
obtain a preferred result.

## Merge-ready barrier

Immediately before accepting `merge-ready` or performing a merge, observe one current snapshot:

1. repository and PR match the frozen target;
2. PR is open, has the required Draft/Ready state, and targets the frozen base;
3. PR head equals the verified candidate;
4. the complete non-empty set of required final-head checks exists and passes;
5. required current-candidate reviews are terminal;
6. zero unresolved conversations remain;
7. auto-merge or merge-queue state cannot race the snapshot;
8. a final refetch shows no head, base, activity, or merge-tree drift.

Unknown, absent, stale, or pending data fails the barrier. A material finding or any candidate,
head, base, or merge-tree change returns to Verify.

## Merge

Merge only with separately frozen authority. Prefer an exact-head guarded host operation; with
`gh pr merge`, use `--match-head-commit` and never infer `--auto` or `--admin` authority.

If the base requires a merge queue, freeze queue authority and the merge-tree acceptance identity;
otherwise block. Armed or queued is pending, not merged.

Accept `merged` only after GitHub reports that the verified head merged. Record the repository, PR,
head, base or merge-tree identity, merge commit, and observation time. A pre-existing or externally
performed merge is evidence to inspect, not proof that this mission performed an authorized effect.

When behavior is version-sensitive, consult GitHub's current auto-merge documentation and the
official `gh pr merge` reference before acting.
