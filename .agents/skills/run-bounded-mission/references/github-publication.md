# GitHub publication lifecycle

Load only when the frozen mission outcome explicitly includes publishing a GitHub PR, carrying it through review, or merging it.

## Authority and facts

Treat an explicit request to carry the mission through a named terminal effect as authority for its necessary in-scope intermediate GitHub effects. A request to open a PR does not authorize merge; a request to merge does not authorize deployment, release, or unrelated fixes. Stop before any effect outside the frozen ceiling.

Discover the repository, remote, default branch, authentication, policies, required checks and reviews, available provider tools, and current related PR before acting. If required provider state or an explicitly requested remote reviewer is unavailable, terminate `blocked`; do not substitute another signal.

Keep only these facts in the working plan and their native Git or provider surfaces:

- source commit and isolated worktree;
- tested tree or patch hash;
- candidate commit, branch, PR, evidence-bound base commit, and current head;
- current-head checks, reviews, threads, and mission findings;
- remote merge result and cleanup status.

On context recovery, reread them from Git and the provider. Do not serialize a lifecycle ledger or create a project state machine.

## Lifecycle

1. **Isolate.** Resolve the exact source commit and create a mission-only worktree. Preserve unrelated checkouts and changes. One bounded writer may edit only the frozen scope.
2. **Build evidence.** Require the writer to return a patch and raw checks, never a commit. Inspect the complete diff, then run the real consumer journey, focused owner checks, and every project-required full gate from the main context.
3. **Freeze the candidate.** Bind the passing evidence to the tested tree or patch hash. Commit only from that tree, verify the commit has the intended parent and tree, and require a clean worktree. Rerun any gate whose receipt is not provably bound to the committed tree.
4. **Publish a draft.** Push a mission branch and create or update one draft PR against the selected base. Record the exact base commit and verify the remote PR head equals the candidate commit. Never use an uncommitted patch or mutable branch name as candidate identity. For a publication-only outcome, terminate successfully here with the retained draft PR and candidate identities.
5. **Review the exact head.** Start a fresh uninvolved evaluator on the candidate commit and complete diff. When the outcome requires remote code review, request it through the available provider surface.
6. **Wait for independent evidence.** Use native provider monitoring rather than a shell polling loop. Require every discovered project-, provider-, or mission-required check and review on the current PR head; require Linux Actions only when the frozen contract or repository policy requires it. Enumerate accessible review threads, requested reviews, checks, and mission findings; do not infer closure from silence or a generic `mergeable` flag. For a review-only outcome, terminate successfully here after its required review evidence and findings close.
7. **Revise boundedly.** Route actionable findings to one bounded writer. The main context integrates the patch, reruns consumer/focused/full gates, and creates a new candidate commit. Any content, head, or evidence-bound base change invalidates prior evaluator, check, and review evidence unless the provider proves the evidence applies to the exact new head/base pair. Update or rebase the candidate and reacquire invalidated evidence within the frozen revision and non-progress budgets.
8. **Make the PR ready.** Only for an authorized merge outcome, mark the draft ready after all current-head checks and reviews pass and every actionable mission finding is closed. A draft PR cannot satisfy a merge outcome.
9. **Merge atomically.** Immediately before merging, reread the PR head and base commit. Require the head to equal the accepted candidate and the base to equal the evidence-bound base, unless a required provider gate explicitly binds that accepted head to the current base. On drift, return to bounded revision and reacquire invalidated evidence. Invoke the provider merge operation with the accepted head as an atomic expected-head precondition; merge only when all local and remote gates and required reviews still pass. Repository protection is a constraint, not a substitute for mission acceptance.
10. **Verify and clean.** Verify the provider reports the expected PR and accepted candidate merged into the intended base. Then remove the exact mission worktree and perform only authorized branch cleanup. Preserve and report the branch/worktree on a blocked or failed merge when cleanup would destroy the recoverable candidate.
11. **Terminate.** Report the identities and receipts required by the frozen terminal: candidate and PR for publication, review closure when requested, and merge plus cleanup only for a merge outcome. Report consumer and gate receipts, responsibility delta, and residual gaps. Run the one post-mission learning review only after the mission terminal is fixed.

## Invalidation and stopping

Worktree isolation proves only isolation. A commit proves only identity. Local gates, a fresh evaluator, required provider checks, and remote code review are independent evidence surfaces and cannot replace one another.

Use project budgets when present. Otherwise allow at most three candidate revisions and replan after two consecutive cycles that do not improve a failing acceptance signal. Never loop “until perfect,” weaken an oracle, reuse stale-head evidence, or let a candidate-authored test define acceptance.

If publication was not requested, stop at the locally authorized terminal without loading this lifecycle. If the requested terminal cannot be reached because effect authority, provider access, required evidence, or an independent reviewer is unavailable, terminate `blocked` with the exact retained candidate state.
