# GitHub Delivery

Load only when the frozen endpoint includes a GitHub pull request. GitHub delivery is part of
Finalize, not a separate lifecycle or a custom merge service.

Freeze the repository, pull request, base, candidate head, endpoint (`open`, `merge-ready`, or
`merged`), Draft/Ready state, required signals, merge method, and authority for each write:
publication, comment, review request or submission, thread resolution, repository settings,
auto-merge or queue changes, and merge.

Raw GitHub data remains authority for pull-request facts. Use the connected GitHub owner or `gh`
under its current official contract. The waiter below owns only deterministic Codex opening-
discovery classification; it is not acceptance or merge authority.

Close only the exact frozen endpoint:

- `open`: publish the exact candidate to the frozen repository, base, and authorized Draft/Ready
  state. Do not import review, check, conversation, race, or merge requirements into this endpoint.
- `merge-ready`: satisfy the complete barrier below for the exact candidate without merging it.
- `merged`: first satisfy the merge-ready barrier, then verify that GitHub merged that exact head
  under separately frozen merge authority.

## Opening discovery

Treat a PR-opening automated review as bounded discovery, not acceptance. Collect its complete
result before revising. Reproduce each material finding against the current candidate. Missing,
started, ambiguous, or failed review remains outstanding.

For a `merge-ready` or `merged` endpoint, freeze exactly one discovery review attempt: the automatic
native Codex opening review when it starts, or a manually requested substitute through an explicit
`@codex review` issue comment with separately frozen comment authority. Do not use GitHub's generic
review-request path as a substitute because the repository waiter cannot correlate that event. Wait
through the bounded host loop until the waiter reports a terminal classification or the isolated wait
lane reaches its recovery gate. Do not interpret individual provider signals outside that classifier.
For an `open` endpoint, successful publication in the requested Draft/Ready state does not wait for
discovery.

Run
`bun .agents/skills/run-bounded-mission/scripts/wait-pr-codex-review.ts --repo <owner/name> <pr-number>`
through the bounded host/session loop that owns polling. Each invocation reads exactly one snapshot
for the normalized explicit repository and exits: `0` means terminal clean, `10` means pending, and
`1` means a finding, provider failure, incomplete evidence, repository mismatch, or invalid PR state
that must be routed rather than retried as success. Its JSON output binds `repository`,
`pull_request`, `head_oid`, `status`, and `reason`; failures with no trustworthy head use a null
`head_oid`. The `head_oid` is the head observed in that snapshot, not evidence that the opening
review accepted that head. This read-only helper classifies the discovery signal only; it is not
review acceptance, a required check, or merge authority; the merge-ready barrier still verifies the
exact final head.

Consume the helper's structured JSON and exit code together as the only `passed`, `pending`, or
`failed` classification. `gh pr view --json reviews`, top-level review bodies, `reviewDecision`,
comment summaries, or agent prose can omit `reviewThreads` and must not substitute for or override
that result. Raw GitHub data may support forensic facts and the endpoint barrier, but the main agent
must not reinterpret a pending or failed opening discovery as clean.

`failed` with exit `1` is a route-required discovery status, not Mission or candidate failure. It may
represent a finding, provider failure, incomplete evidence, repository mismatch, or invalid PR
state. Preserve its JSON and raw GitHub facts, reproduce material findings, and identify missing
evidence or capability before routing.

Collect and validate the complete opening result before changing the candidate. Route the coherent
set by its highest material boundary: a Frame-contract failure returns to Frame; an owner, path,
boundary, responsibility-shape, or oracle failure, recurrence of the same causal root, candidate
non-convergence, or boundary growth returns the same Mission to Plan; otherwise combine all
reproduced candidate-local findings into the smallest coherent root-cause correction in Execute.
Apply the main skill's predicate and anti-metric rules; discovery never authorizes a successor
Mission, replacement task, `Stop+1`, or terminal rejection.

Thread resolution is a separate write authority and may occur only after the finding is verified as
addressed, inapplicable, duplicate, or non-material; `outdated` alone is not evidence.

For this repository, the automatic native Codex review is an opening-only discovery signal. A
candidate changed to address its findings invalidates affected candidate-bound verification, but does
not require another Codex review. Preserve the opening findings, revalidate every disposition against
the final candidate, Verify and publish that complete candidate, then wait for its complete non-empty
set of required final-head checks. Request another review only when the frozen Frame or admitted Plan
separately requires it. Do not create review loops merely to obtain a preferred result.

## Merge-ready barrier

Immediately before accepting `merge-ready` or performing a merge, observe one current snapshot:

1. repository and PR match the frozen target;
2. PR is open, has the required Draft/Ready state, and targets the frozen base;
3. PR head equals the verified candidate;
4. the complete non-empty set of required final-head checks exists and passes;
5. the frozen discovery classification has a terminal route disposition, every material finding has
   a disposition revalidated against the final candidate, and any separately required current-
   candidate reviews are terminal;
6. zero unresolved conversations remain;
7. auto-merge or merge-queue state cannot race the snapshot;
8. a final refetch shows no head, base, activity, or merge-tree drift.

Unknown, absent, stale, or pending required final-head data fails the barrier. The completed opening
review is intentionally discovery rather than final-head acceptance evidence. A material finding or
any candidate, head, base, or merge-tree change returns to Verify.

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
