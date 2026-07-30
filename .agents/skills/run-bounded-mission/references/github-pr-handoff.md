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
10. Use the skill-owned `scripts/github_handoff_barrier.py` as the only Handoff path that may perform
    a direct merge when that effect is frozen in Authority. Wait for any create-triggered discovery
    attempt first, address and resolve verified findings, freeze the final head and current base,
    then run the script from this skill directory:

    ```text
    python3 scripts/github_handoff_barrier.py \
      --repo <owner/repository> --pr <pull-request> \
      --head <candidate-head-sha> --base <base-sha>
    ```

    The script posts one idempotent exact-head `@codex review` trigger, requires that attempt to
    terminate through an associated review thread or the trigger's unique no-finding thumbs-up,
    rejects unmarked or concurrent attempts, holds a stable review/thread activity window, paginates
    all activity, requires provider required checks and zero unresolved threads, and re-fetches the
    frozen snapshot. It then calls direct squash merge with an exact-head guard, observes the merge
    metadata, and never uses `--auto` or `--admin`. A finding, candidate revision, timeout, ambiguous
    signal, armed integration, changed head/base, or missing final observation returns non-zero and
    must route through Evaluate or to `blocked`; do not bypass the script with another merge command.

For a `merged` endpoint:

1. Use the skill-owned barrier for a direct merge only when Authority separately permits it and the
   repository protects the frozen candidate against a changed base. Never leave a persistent
   auto-merge request as the outcome of the barrier.
2. If the base requires a merge queue, use it without `--admin` only when queue authority and its
   merge-tree acceptance identity were frozen; otherwise route to `blocked`.
3. Observe the current head, base, checks, reviews, unresolved conversations, integration
   state, and merge result. Bind acceptance to the evaluated head and base SHAs, or to the prospective
   merge tree. A change to either SHA invalidates Evaluate and its required signals; evaluate the new
   pair or merge tree, and `replan` if the change materially affects the contract or design.

Armed or queued is pending. Accept `merged` only when GitHub reports the evaluated head merged; record
the PR, head, merge commit, and time. Use GitHub's [auto-merge documentation](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)
and [`gh pr merge` reference](https://cli.github.com/manual/gh_pr_merge) when behavior is
version-sensitive.
