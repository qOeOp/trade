# GitHub publication lifecycle

Load only when the frozen mission outcome explicitly includes publishing a GitHub PR, carrying it through review, or merging it.

## Authority and facts

Treat an explicit request to carry the mission through a named terminal effect as authority for its necessary in-scope intermediate GitHub effects. A request to open a PR does not authorize merge; a request to merge does not authorize deployment, release, or unrelated fixes. Stop before any effect outside the frozen ceiling.

Discover the repository, remote, default branch, authentication, policies, required checks and reviews, available provider tools, and current related PR before acting. If required provider state or an explicitly requested remote reviewer is unavailable, terminate `blocked`; do not substitute another signal.

Keep only these facts in the working plan and their native Git or provider surfaces:

- source commit and isolated worktree;
- tested tree or patch hash;
- candidate commit, PR head ref, PR, evidence-bound base ref and commit, and current head;
- current-head checks, reviews, top-level PR conversation comments, threads, and mission findings;
- remote merge result and cleanup status.

On context recovery, reread them from Git and the provider. Do not serialize a lifecycle ledger or create a project state machine.

## Lifecycle

1. **Isolate.** Resolve the exact source commit and create a mission-only worktree. Preserve unrelated checkouts and changes. When content must change, one bounded writer may edit only the frozen scope; an unchanged existing PR may use its exact current head without a writer or fabricated patch.
2. **Build evidence.** For a content change, require the writer to return a patch and raw checks, never a commit. Otherwise inspect the existing PR's complete exact diff. In both cases run the real consumer journey, focused owner checks, and every project-required full gate from the main context.
3. **Freeze the candidate.** Bind passing evidence to the tested tree or patch hash. Commit changed content only from that tree, verify its intended parent and tree, and require a clean worktree. For an unchanged existing PR, verify and adopt its exact head and tree directly. Rerun any gate whose receipt is not provably bound to the candidate.
4. **Publish a draft.** Push a mission branch and create or update one draft PR against the selected base, or verify the discovered PR already represents the candidate. Record the exact head and base refs and commits, and verify the remote PR head equals the candidate commit. Never use an uncommitted patch or mutable branch name as candidate identity.
5. **Review the exact head.** Before any writable terminal, start a fresh uninvolved evaluator on the candidate commit and complete diff. When the frozen contract requires remote code review, request it through the available provider surface.
6. **Expose required evidence.** If a discovered check or review required by the frozen terminal starts only after `ready_for_review` and readiness lies within the effect ceiling, mark the frozen candidate ready to trigger it. Otherwise keep the PR draft until its required evidence closes. If readiness is required but exceeds the frozen effect ceiling, terminate `blocked`; readiness never proves acceptance.
7. **Wait for independent evidence.** Use native provider monitoring rather than a shell polling loop. Require every discovered project-, provider-, or mission-required check and review on the current PR head; require Linux Actions only when the frozen contract or repository policy requires it. Enumerate accessible top-level PR conversation comments, review threads, requested reviews, checks, and mission findings; do not infer closure from silence or a generic `mergeable` flag. After all evidence required by the frozen terminal passes and its actionable findings close, a publication- or review-only mission removes the exact local worktree, retains the remote candidate and PR identities, and terminates successfully.
8. **Revise boundedly.** Route actionable findings to one bounded writer. The main context integrates the patch, reruns consumer/focused/full gates, and creates a new candidate commit. Any content, head, or evidence-bound base change invalidates prior evaluator, check, and review evidence unless the provider proves the evidence applies to the exact new head/base pair. Update or rebase the candidate and reacquire invalidated evidence within the frozen revision and non-progress budgets.
9. **Make the PR ready.** For an authorized merge outcome not already made ready in step 6, mark the candidate ready only after all current-head checks and reviews pass and every actionable provider comment and mission finding is closed. If readiness starts new required evidence, return to step 7. A ready PR still cannot satisfy acceptance by itself.
10. **Merge atomically.** Merge only through an operation that atomically binds both the accepted PR-head ref and the evidence-bound base ref, so either ref drifting makes the whole operation fail without publishing a merge. Use a provider or merge queue with that guarantee, or an atomic multi-ref compare-and-swap that publishes an exact merge result whose parents are the tested base and accepted head. A base reread plus an expected-head-only merge is insufficient. If no permitted binding operation is available, terminate `blocked`; otherwise require all local and remote gates and reviews to remain passing.
11. **Verify, clean, and terminate.** Verify the provider reports the expected PR and accepted candidate merged into the intended base. Then remove the exact mission worktree and perform only authorized branch cleanup. Preserve and report the branch/worktree on a blocked or failed merge when cleanup would destroy the recoverable candidate. Report identities and receipts for the frozen terminal, consumer and gate receipts, responsibility delta, and residual gaps. Run the one post-mission learning review only after the terminal is fixed.

## Invalidation and stopping

Worktree isolation proves only isolation. A commit proves only identity. Local gates, a fresh evaluator, required provider checks, and remote code review are independent evidence surfaces and cannot replace one another.

Use project budgets when present. Otherwise allow at most three candidate revisions and replan after two consecutive cycles that do not improve a failing acceptance signal. Never loop “until perfect,” weaken an oracle, reuse stale-head evidence, or let a candidate-authored test define acceptance.

If publication was not requested, stop at the locally authorized terminal without loading this lifecycle. If the requested terminal cannot be reached because effect authority, provider access, required evidence, or an independent reviewer is unavailable, terminate `blocked` with the exact retained candidate state.
