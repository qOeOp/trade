# GitHub Pull Request Handoff

Load only when Acceptance includes a GitHub pull request. Freeze the repository, base, pull request,
candidate head SHA, endpoint (`open`, `merge-ready`, or `merged`), required signals, merge method, and
authority for PR writes, repository settings, auto-merge, review actions, and manual merge.

For a `merged` endpoint:

1. Confirm the PR targets the frozen base and its head equals the evaluated candidate.
2. If authorized and repository auto-merge is allowed, arm the repository-approved method with a
   head guard. A squash-only repository may use:

   ```text
   gh pr merge --repo <owner/repository> --auto --squash \
     --match-head-commit <head-sha> <pull-request>
   ```

3. If the base requires a merge queue, use it without `--admin`.
4. Observe the current head, checks, reviews, unresolved conversations, auto-merge or queue state, and
   merge result. A head-changing push creates a new candidate and requires Evaluate. Rebind a changed
   base, and `replan` when it materially changes the contract or candidate.

Armed or queued is pending. Accept `merged` only when GitHub reports the evaluated head merged; record
the PR, head, merge commit, and time. Use GitHub's [auto-merge documentation](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)
and [`gh pr merge` reference](https://cli.github.com/manual/gh_pr_merge) when behavior is
version-sensitive.
