# GitHub Pull Request Handoff

Load only when Acceptance includes a GitHub pull request. Freeze the repository, base, pull request,
candidate head SHA, endpoint (`open`, `merge-ready`, or `merged`), required Draft/Ready state,
signals, merge method, and authority for PR writes, repository settings, auto-merge, review actions,
and manual merge.

Before publishing or accepting any endpoint, inspect existing auto-merge or merge-queue state.
Quiesce integration that could merge before the frozen prerequisites close, including for a
`merged` endpoint; disable it when authorized or route to `blocked`. Never use auto-merge or a merge
queue as the waiting mechanism. Arm integration only after the complete pre-merge barrier below
passes.
For `open`, confirm the PR's Draft/Ready state matches the frozen state before accepting.

Classify each review producer as either a bounded discovery source or a current-candidate acceptance
signal. Freeze its provider trigger, completion indication, and whether a candidate change requires
another attempt. Never invent a trigger or promote discovery to acceptance. A missing result, a
started reaction such as eyes, or another in-progress marker remains outstanding. A create-triggered
discovery becomes terminal only through one complete review submission containing at least one
thread, or, when it produces no threads, the uniquely correlated thumbs-up reaction.

For a `merge-ready` or `merged` endpoint:

1. Confirm the PR targets the frozen base and its head equals the evaluated candidate.
2. Snapshot reviews and thread-aware conversation state, including each thread ID, resolution and
   outdated status, resolve permission, path, and comments. Bind every required review to the commit
   it reviewed; flat comments or aggregate review labels are insufficient.
3. Allow at most one outstanding attempt per review producer. For a create-only discovery review,
   bind the PR creation event and its head, then publish no new candidate until the provider returns
   one complete review submission containing threads or the no-thread thumbs-up, or the frozen wait
   Stop expires. The thumbs-up closes only a uniquely correlated attempt; it is not commit-bound
   semantic evidence.
4. Wait behind one bounded barrier for required checks, a candidate-uncontrollable fresh evaluator
   accepting the exact current head, required current-candidate reviews, and outstanding discovery
   attempts. Launch the evaluator under the frozen reviewer handoff from the immutable origin or a
   neutral context. While integration is quiesced, preclassify the snapshot and resolve previously
   verified findings that remain closed on the current candidate. Keep findings from the pending
   attempt open until the barrier closes, then re-fetch once and adjudicate the combined remainder;
   do not revise from partial arrivals.
5. Reproduce each unresolved finding against the current candidate. Route a demonstrated material
   failure to Evaluate without resolving it. Resolve a thread only when the finding is verified as
   addressed, inapplicable, duplicate, or non-material; `outdated` alone is not evidence. Leave an
   ambiguous or unverified thread open and route to `blocked`.
6. Combine findings that preserve the same design into one bounded revision. After any candidate
   change, return through Evaluate and publish the new identity. Reacquire required checks and only
   review signals whose frozen authority requires the new candidate; never retrigger a create-only
   discovery review. Fetch all threads again and verify its findings against the revised candidate.
   A new finding consumes the same Stop.
7. Conversation writes require frozen authority. Immediately before resolving, confirm the PR still
   has the evaluated head, the exact thread remains unresolved, and the actor can resolve it. Reply,
   review request, review dismissal, review submission, and thread resolution are distinct effects;
   never dismiss or approve a review merely to make the PR mergeable.
8. Re-fetch the PR after all authorized resolutions. `merge-ready` requires every required check and
   required current-candidate review to remain passing, the exact-head fresh evaluator to pass,
   every frozen discovery attempt to be terminal, and zero unresolved conversations.
9. Immediately before any merge, queue, or auto-merge command, build one transient pre-merge snapshot:
   current head and base; terminal evidence for every frozen discovery attempt; the evaluator's
   instruction origin, candidate identity, and acceptance result; required check conclusions;
   required current-candidate review states; zero unresolved conversations; and quiesced integration
   state. Unknown, absent, stale, or pending data fails the barrier. Re-fetch head and base after the
   snapshot; any change invalidates it.
10. On repositories that provide `scripts/github-handoff-barrier.ts`, use it as the only Handoff
    path that may arm auto-merge. Wait for any create-triggered discovery attempt first, address and
    resolve verified findings, freeze the final head and current base, then run:

    ```text
    bun scripts/github-handoff-barrier.ts \
      --repo <owner/repository> --pr <pull-request> \
      --head <candidate-head-sha> --base <base-sha>
    ```

    The script posts one idempotent exact-head `@codex review` trigger, requires that attempt to
    terminate on the exact head, holds a stable review/thread activity window, requires all provider
    required checks and zero unresolved threads, re-fetches the frozen snapshot, and only then calls
    guarded squash auto-merge. A finding, candidate revision, timeout, ambiguous signal, armed
    integration, incomplete pagination, or changed head/base returns non-zero and must route back
    through Evaluate or to `blocked`; do not bypass the script with a separate merge command.

For a `merged` endpoint:

1. Treat auto-merge as the final authorized integration effect after the complete barrier, never as a way to wait
   for checks or reviews. If repository auto-merge is allowed, arm it only when branch rules require
   the evaluated head to remain up to date with the base or the provider guards the evaluated merge
   tree. Reconfirm head and base, then use the repository-approved method with a head guard. A
   squash-only repository may use:

   ```text
   gh pr merge --repo <owner/repository> --auto --squash \
     --match-head-commit <head-sha> <pull-request>
   ```

2. If the base requires a merge queue, use it without `--admin`.
3. If neither auto-merge nor a required queue can reach the endpoint, use a direct merge only when
   it is separately authorized and the provider can guard the frozen candidate plus base or merge
   tree; otherwise route to `blocked`.
4. Observe the current head, base, checks, reviews, unresolved conversations, auto-merge or queue
   state, and merge result. Bind acceptance to the evaluated head and base SHAs, or to the prospective
   merge tree. A change to either SHA invalidates Evaluate and its required signals; evaluate the new
   pair or merge tree, and `replan` if the change materially affects the contract or design.

Armed or queued is pending. Accept `merged` only when GitHub reports the evaluated head merged; record
the PR, head, merge commit, and time. Use GitHub's [auto-merge documentation](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)
and [`gh pr merge` reference](https://cli.github.com/manual/gh_pr_merge) when behavior is
version-sensitive.
