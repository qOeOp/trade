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

Treat the PR-opening Codex review as one bounded discovery source, not a current-candidate acceptance
signal. Never publish `@codex review` from Handoff and never repeat agent review after a candidate
revision. A missing result or a started reaction such as eyes remains outstanding. The opening
discovery becomes terminal through a review submission containing at least one thread or, when it
produces no threads, the provider thumbs-up reaction on the pull request.

For a `merge-ready` or `merged` endpoint:

1. Confirm the PR targets the frozen base and its head equals the evaluated candidate.
2. Snapshot reviews and thread-aware conversation state, including each thread ID, resolution and
   outdated status, resolve permission, path, and comments. Bind every required review to the commit
   it reviewed; flat comments or aggregate review labels are insufficient.
3. Start no review attempt from Handoff. Let the PR-opening Codex review and initial CI overlap, then
   wait for the opening review's complete review/thread result or PR thumbs-up. A provider failure
   without either completion signal blocks; it does not authorize a retry loop.
4. Wait behind one bounded barrier for the opening discovery, required checks, conversation state,
   and any separately frozen evaluator. While integration is quiesced, collect the opening review
   completely, then adjudicate its combined findings; do not revise from partial arrivals.
5. Reproduce each unresolved finding against the current candidate. Route a demonstrated material
   failure to Evaluate without resolving it. Resolve a thread only when the finding is verified as
   addressed, inapplicable, duplicate, or non-material; `outdated` alone is not evidence. Leave an
   ambiguous or unverified thread open and route to `blocked`.
6. Combine findings that preserve the same design into one bounded revision. After any candidate
   change, publish the new identity and reacquire only deterministic current-head checks. Never
   retrigger Codex review. Fetch all original threads again and verify those findings against the
   revised candidate.
7. Conversation writes require frozen authority. Immediately before resolving, confirm the PR still
   has the evaluated head, the exact thread remains unresolved, and the actor can resolve it. Reply,
   review request, review dismissal, review submission, and thread resolution are distinct effects;
   never dismiss or approve a review merely to make the PR mergeable.
8. Re-fetch the PR after all authorized resolutions. `merge-ready` requires the opening discovery to
   be terminal, every final-head required check to pass, every separately frozen evaluator to be
   terminal, and zero unresolved conversations.
9. Immediately before any merge, queue, or auto-merge command, build one transient pre-merge snapshot:
   current head and base; terminal evidence for the opening discovery; the evaluator's
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

    The script cannot publish comments or trigger reviews. It consumes the PR-opening Codex review,
    holds a stable review/thread activity window, paginates all activity, reads the complete
    required-context set from the base branch rules, requires every final-head context and zero
    unresolved threads, and re-fetches the frozen snapshot. It then calls direct squash merge with
    an exact-head guard, observes the merge metadata, and never uses `--auto` or `--admin`. A failed
    opening review, timeout, armed integration, changed head/base, or missing final observation
    returns non-zero and must route through Evaluate or to `blocked`; do not bypass the script with
    another merge command.

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
