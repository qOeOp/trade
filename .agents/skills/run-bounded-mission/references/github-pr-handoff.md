# GitHub Pull Request Handoff

Load only when Acceptance includes a GitHub pull request. Freeze the repository, base, pull request,
candidate head SHA, endpoint (`open`, `merge-ready`, or `merged`), required signals, merge method, and
authority for PR writes, repository settings, auto-merge, review actions, and manual merge.

Before publishing or accepting any endpoint, inspect existing auto-merge or merge-queue state.
Quiesce integration that could merge before the frozen prerequisites close, including for a
`merged` endpoint; disable it when authorized or route to `blocked`. Re-arm it only after those
prerequisites close.

For a `merge-ready` or `merged` endpoint:

1. Confirm the PR targets the frozen base and its head equals the evaluated candidate.
2. Snapshot reviews and thread-aware conversation state, including each thread ID, resolution and
   outdated status, resolve permission, path, and comments. Bind every required review to the commit
   it reviewed; flat comments or aggregate review labels are insufficient.
3. Wait behind one bounded barrier for the frozen check and review producers to reach a terminal
   state for the current head. Preclassify the snapshot while waiting, then re-fetch once and
   adjudicate the combined findings; do not revise or resolve from partial arrivals.
4. Reproduce each unresolved finding against the current candidate. Route a demonstrated material
   failure to Evaluate without resolving it. Resolve a thread only when the finding is verified as
   addressed, inapplicable, duplicate, or non-material; `outdated` alone is not evidence. Leave an
   ambiguous or unverified thread open and route to `blocked`.
5. Combine findings that preserve the same design into one bounded revision. After any candidate
   change, return through Evaluate, publish the new identity, wait for every
   required reviewer to report on that head, then fetch all threads again. A new finding consumes the
   same Stop.
6. Conversation writes require frozen authority. Immediately before resolving, confirm the PR still
   has the evaluated head, the exact thread remains unresolved, and the actor can resolve it. Reply,
   review request, review dismissal, review submission, and thread resolution are distinct effects;
   never dismiss or approve a review merely to make the PR mergeable.
7. Re-fetch the PR after all authorized resolutions. `merge-ready` requires every required check and
   current-head review condition to be satisfied with zero unresolved conversations.

For a `merged` endpoint:

1. If authorized and repository auto-merge is allowed, arm the repository-approved method with a
   head guard. A squash-only repository may use:

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
