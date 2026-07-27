# GitHub PR lifecycle

A `covered GitHub PR lifecycle terminal` means publishing a GitHub PR, carrying it through review, or merging it. Load only when the frozen mission outcome explicitly includes one.

## Repository-enforced path

When the default branch owns `scripts/check-pr-review.ts` and
`pr-lifecycle-gate`, use one cooperative lock plus GitHub-native evidence. This
path deliberately has no lifecycle ledger, transition tag family, or writer
CLI.

1. Keep automatic Codex PR review disabled while the lifecycle is active and
   restore its prior value before every terminal. Create the Draft PR, then
   atomically create one annotated `codex-pr-claim/<pr>` ref containing only
   repository, PR, mission, actor, initial head, and a private capability hash.
   The winning main mission context keeps the raw capability in memory. A
   competing context that cannot prove the capability is read-only and makes no
   comment, review, thread, status, or ref write. The ref is a cooperative lock,
   not hostile-actor security or lifecycle history; an equally privileged actor
   can delete, recreate, or bypass it. Reassignment or deletion requires
   explicit user authority.
2. Keep all lifecycle facts in the working plan and native GitHub surfaces.
   Direct provider mutations must first prove the claim capability and reread
   exact head, base ref, and live base. Do not add review, trigger, seal, finding,
   or transition refs. A single editable status comment may project `Outcome`,
   exact head/live base, links to native comments/reviews/threads/checks, current
   disposition, and next action. It is navigation only and no gate consumes it.
3. The PR body must start, after blank lines, with the literal column-0 heading
   `## Outcome`, followed by non-empty content. The section ends at the next
   column-0 H2. A list-, quote-, indent-, fence-, comment-contained, late, or
   duplicate `Outcome` heading has no capability.
4. After local gates and a fresh evaluator accept the exact candidate, post
   exactly one explicit trigger in the current observation window using
   `reviewTriggerBody` from `scripts/check-pr-review.ts`. The window begins at
   the latest provider-native `pull_request` workflow run associated with that
   PR and exact head SHA; the run must strictly predate the trigger. If the same
   head/base leaves and later re-enters, the new run starts a new window and
   requires one new trigger; triggers from earlier windows do not count in the
   current gate. A self-declared future SHA is not evidence that the head was
   live. Do not push while a current-window review is pending. A second
   current-window trigger, an identity-free current-window trigger, an edited
   or minimized trigger, or a trigger whose visible text differs from that
   exact body fails closed.
5. A clean result is exactly one post-trigger Codex `THUMBS_UP`, optionally
   `EYES`, with no current-head Codex review or finding root. A finding review
   never becomes clean because a reaction also exists. Make one coherent
   strict-descendant fix commit for each Codex finding, reply once in the native
   thread with `Fixed in <full-sha>: <reason>`, resolve the thread, and publish a
   new head. The fix commit timestamp must strictly postdate the finding and the
   disposition reply must strictly postdate that commit. The new head needs its
   own single trigger and final clean result. A missing, duplicate, pre-fix,
   pre-finding, non-descendant, or edited disposition reply, or an unresolved
   finding, fails closed.
6. The read-only checker takes a complete GraphQL snapshot of commits, comments,
   reactions, reviews, and threads, bracketed by REST identity and authoritative
   live-base reads. It rejects provider errors, malformed data, duplicates,
   forks, drift, or any connection over 100 items. It repeats the complete read
   before success. Native evidence can still be deleted or rewritten by a
   privileged actor; the checker certifies only the exact visible snapshot and
   does not claim tamper-proof history.
7. Dispatch the base-owned workflow with exact PR, head, base ref, and live-base
   SHA. It must publish a non-success status before checkout, setup, live-base
   binding, or verification; its `always()` final step replaces pending with
   failure after any later failure. It makes `pr-lifecycle-gate` success or
   failure its final explicit provider call. A client error after a committed
   success must cause no compensating provider read or write. Candidate workflow
   or checker content never protects the bootstrap PR that installs them.
8. Merge only after the exact-head gate from the expected GitHub Actions
   integration, all existing quality and CodeQL checks, independent review, and
   thread-resolution policy pass under the repository's atomic merge path.
   After the bootstrap merge, run hosted fail and success canaries from the
   default branch, verify the status integration and strict blocking, then add
   `pr-lifecycle-gate` to required checks.

If the claim, complete native evidence, base-owned workflow, status integration,
or provider permission is unavailable, do not hand-roll a weaker substitute.
Apply the ordered terminal predicates in `SKILL.md`.

## Authority and facts

Treat an explicit request to carry the mission through a named terminal effect as authority for its necessary in-scope intermediate GitHub effects. A request to open a PR does not authorize merge; a request to merge does not authorize deployment, release, or unrelated fixes. Stop before any effect outside the frozen ceiling.

Discover the repository, remote, default branch, authentication, policies, required checks and reviews, available provider tools, and current related PR before acting. If required provider state or an explicitly requested remote reviewer is unavailable, do not substitute another signal; apply the ordered terminal predicates in `SKILL.md`.

Classify the terminal before mutating provider state. For pure review-only, inspect and preserve draft, auto-merge, and merge-queue state. For merge or candidate/PR mutation, inspect that state before and after each mutation; use an authorized action to quiesce integration not yet authorized by step 10 and verify it stopped, or apply the ordered terminal predicates. Only in those mutating lifecycles, before the evaluator, verify a newly published/updated PR is draft and return an adopted Ready PR to draft; expose draft-blocked evidence only through step 6. Bind the prior state of any temporary provider-wide trigger or permission control, restore and verify it before every terminal, or require separate authority for a lasting change and otherwise apply the ordered predicates.

Apply one **freshness rule** before each publication trigger, expensive remote-review trigger, provider review submission, Ready transition, positive terminal, and merge: take a complete head/base/live-base snapshot and require the exact candidate commit, selected base ref, and evidence-bound base commit. On drift, make no reviewer write; within cumulative budgets update or rebuild against the new base and reacquire every invalidated evidence surface, counting each rebuild as a revision. For an authorized merge terminal, use the queue alternative only after every candidate-bound pre-entry prerequisite passes and only when the provider enforces integration quiescence from entry through step 10; while quiesced, reacquire required local gates, fresh evaluator, and provider checks and reviews on the exact `merge_group`. Otherwise do not enter the queue and apply the ordered terminal predicates. Any acceptance-tree or `merge_group` change invalidates evidence bound to the prior tree. This read never substitutes for step 10's atomic merge guarantee.

Apply one **reviewer-trigger rule** per current observation window. Inventory every provider action that can wake the same reviewer, including explicit comments or requests, opening or reopening, publication or update, and Ready; reserve exactly one authorized trigger when possible, preferring a later required Ready trigger. A known trigger action itself creates a pending attempt without reaction or acknowledgement. If another trigger occurs in the same window, return to evidence wait and forbid merge until every known current-window attempt is terminal and the complete snapshot and applicable threads close. Do not repeat a pending or terminal attempt while the latest matching `pull_request` run and exact head/base remain unchanged. If the same head/base leaves and re-enters, the later matching run starts a new window; after refreshing all evidence, exactly one new trigger is permitted and required. A provider path may permit one evidence-bound same-window re-review for thread-only remediation only when its frozen oracle explicitly supports multiple triggers; the repository-enforced path above does not, so its remediation must reach a new head and observation window. Otherwise make no reviewer write, timeout retry, or status chatter.

Keep only these facts in the working plan and their native Git or provider surfaces:

- source commit and isolated worktree;
- tested tree or patch hash;
- candidate commit, PR head ref, PR, evidence-bound base ref and commit, and current head;
- current-head checks, reviews, top-level PR conversation comments, threads, and mission findings;
- current-head/base reviewer-trigger inventory and provider-native review attempts;
- remote merge result and cleanup status.

On context recovery, reread them from Git and the provider. Do not serialize a lifecycle ledger or create a project state machine.

## Lifecycle

1. **Isolate.** Resolve the exact source commit and create a mission-only worktree. Preserve unrelated checkouts and changes. When candidate content already exists as an exact local commit or exact existing PR head, adopt it directly without a writer, fabricated patch, no-op edit, or replacement commit, but adopt a related PR only when it is open and unmerged; reopen or replace a closed unmerged PR only within authority, and replace a merged PR only within authority. Otherwise apply the ordered terminal predicates. When no exact candidate exists, one bounded writer may edit only the frozen scope.
2. **Build evidence.** Freeze the selected base ref and its current provider commit as the evidence-bound base. Derive and freeze acceptance gate commands and oracles from that base or an immutable owner surface before executing candidate content. Candidate changes may add gates or evidence but never replace, omit, or weaken the frozen gates or oracles. Treat all candidate-influenced executable content, including scripts, dependency hooks, and the consumer journey, as untrusted until accepted regardless of contributor label. Execute it only in credential-free isolation; keep provider credentials and authenticated provider operations outside. If required isolation is unavailable, do not execute it; apply the ordered terminal predicates. Static inspection and provider operations that do not execute candidate content may remain outside; do not invent a project sandbox. For writer-changed content, require the writer to return a patch and raw checks, never a commit. For an adopted candidate, inspect its complete exact diff against that base. In both cases run the real consumer journey, focused owner checks, and every project-required full gate from the main context. For a merge terminal where the evidence-bound base is not an ancestor of the candidate, candidate-tree gates are insufficient: run them on the exact prospective merge-tree hash or require provider checks bound to the exact merge-group tree, and bind merge acceptance to that tree. Preserve candidate-tree evidence for the direct-descendant path.
3. **Freeze the candidate.** Bind passing evidence to the tested tree or patch hash. Commit only writer-changed content from that tree, verify its intended parent and tree, and require a clean worktree. For an adopted candidate, directly verify and use its exact commit and tree. Once the candidate exists, require every frozen gate to have an exact-candidate-commit receipt. For writer-changed content, rerun every gate after commit; a precommit tree-only receipt is never sufficient. For an adopted exact commit, reuse a receipt only when it binds the exact commit and tree, frozen command and oracle, exact invocation, status and raw output or artifact hash, and satisfies the frozen freshness requirement. Rerun any gate without such a receipt, and always perform an externally mandated rerun.
4. **Publish a draft.** Skip this step when no publication/update effect is authorized; pure review-only preserves the already-discovered PR state and proceeds directly to step 5 with its exact existing PR/head/base. Otherwise, before push or PR creation/update, apply the reviewer-trigger rule and audit workflow authority against the complete candidate diff, including each triggered candidate-influenced execution path, token permission, and secret access. Constrain unsafe execution through authorized controls within the effect ceiling; otherwise apply the ordered predicates before publication rather than invent a sandbox. Apply the freshness rule, then push one mission branch and create or update one draft PR against the selected base, or verify the discovered PR represents the candidate. Record exact head/base refs and commits; require remote head, PR base ref, and provider base commit to equal the candidate, selected base ref, and evidence-bound base. A mismatch is not adoption. Retarget only within authority and follow the freshness rule's rebuild path. Never identify a candidate by an uncommitted patch or mutable branch.
5. **Review the exact head.** For every covered lifecycle start a fresh uninvolved read-only evaluator: after step 4 establishes exact draft identity for publication/update, or directly from the already-discovered exact existing PR/head/base for pure review-only. Evaluate the candidate tree for a direct-descendant terminal; otherwise evaluate the exact prospective merge or provider `merge_group` tree. Supply its hash, base/head identities, integrated diff, and bound receipts. Allow already-runnable required Actions and other evidence to run before remote review. For lifecycle-, authority-, or oracle-high-risk candidates, also run the bounded scenario audit already owned by the frozen contract or project authority; do not duplicate it here. Request independent remote review only after evaluator `accept`, all already-runnable required checks and evidence pass, applicable findings close, and the freshness rule succeeds; keep remote review independent from the evaluator. For a review-only terminal requiring the main context to submit a provider review, handle the evaluator first. A non-accepting disposition may carry current-candidate/head/base-bound `revise` findings, but never convert `replan` or `blocked`. An acceptance-signaling disposition requires evaluator `accept`, applicable findings closure, and every other independent prerequisite; defer it until step 7. Handle other evaluator outcomes before any acceptance signal. Before submission apply freshness. For pure review-only, emit an acceptance signal only when the discovered integration state is already unable to integrate or the frozen terminal explicitly authorizes a lasting transition to a verified non-integrating terminal state; temporary quiescence followed by restoration never qualifies. Otherwise emit no acceptance signal and apply the ordered predicates. Submit only the authorized disposition and retain a receipt binding PR, reviewer, disposition, exact head, and evidence-bound base; it is neither independent remote-review evidence nor its own prerequisite. If identity or policy forbids submission, apply the ordered predicates.

   **Review-trigger exception.** Prefer a non-accepting review trigger when provider semantics permit. If a required check provably starts only from the authorized acceptance-signaling review, first verify an authorized provider-native dismissal or replacement path is available and executable; if unavailable, emit no signal and apply the ordered terminal predicates. Submit that exact review solely as its trigger only after fresh evaluator `accept`, all already-runnable applicable evidence succeeds, actionable findings close, the exact head/base reread above, and verified quiescence against unauthorized integration. Bind its receipt and return to step 7; do not treat it as terminal acceptance or restore integration until the triggered evidence succeeds and identities remain valid. If that evidence fails or cannot complete, execute the verified rollback, then reread provider state and require the positive approval to no longer count toward required review, mergeability, or terminal acceptance; do not assume a candidate revision invalidates it. Keep integration quiesced and forbid a positive terminal until verified; otherwise apply the ordered terminal predicates.
6. **Expose required evidence.** When a required check or review starts only after Ready and readiness is authorized, apply freshness and keep draft until the transition. If Ready is the reserved reviewer trigger, transition only after step 5's evaluator, already-runnable evidence, scenario-audit, and findings prerequisites hold; the reviewer-trigger rule makes the action pending. Otherwise transition only to expose evidence. After transitioning, remain Ready while required evidence closes. If readiness exceeds authority, apply the ordered predicates; readiness never proves acceptance.
7. **Wait for independent evidence.** Use native provider monitoring, not a shell polling loop. Require every project-, provider-, or mission-required check, review, and evidence item applicable to this terminal on the current head; do not import evidence required only for a later terminal, and require Linux Actions only when contract or policy requires them. For a bound non-accepting review-only terminal, unless its negative-review oracle says otherwise, failed or pending checks and open findings are evidence and residuals rather than positive prerequisites. Do not count a pending owner-submitted terminal review among its own prerequisites; when positive-submission prerequisites close, return to step 5. Apply the reviewer-trigger rule. For each judgment, take one snapshot across every accessible provider surface correlated to exact head/base and, for reviewer evidence, the reviewer and triggering receipt or attempt: top-level comments; reactions and acknowledgements on each triggering artifact; thread-aware review threads with resolution, obsolescence, and anchors; requested reviews and attempts; checks; and mission findings. Silence on one endpoint proves nothing, and a positive summary never closes an actionable thread. Before any no-response, no-findings, or terminal judgment, refresh the complete snapshot after the latest observation, including a pending attempt reaching budget or timeout. After each remediated finding allow at most one evidence-bound reply and one resolve mutation, never a status-only reply. Correlate with provider-native identities, timestamps, cursors, and receipts in the working plan; create no registry, ledger, or state machine. Once evidence and applicable findings close, set a publication-only PR to its frozen requested Ready or draft state. For pure review-only, preserve the discovered draft/Ready, auto-merge, and merge-queue state unless the frozen terminal explicitly authorizes a provider-state transition; then apply only that requested transition. A non-accepting review-only terminal may instead complete from its bound current-head/base review receipt with supported actionable findings reported as residual; do not remediate implicitly. Merge and every positive-acceptance terminal require applicable findings closed. Only for publication- or review-only completion, apply freshness, verify remote candidate and PR identities, remove the exact mission worktree and only its exact local branch, preserve adopted or pre-existing branches, and terminate successfully. A merge lifecycle instead continues through steps 9–11 without cleanup or success here.
8. **Revise boundedly.** Route actionable findings to one bounded writer only when remediation is within the frozen effect ceiling; otherwise do not revise, report residual findings only when the frozen terminal permits them, and apply the ordered terminal predicates when it does not. Every revision re-enters steps 2 through 7 in order: rebuild evidence from the frozen gates, bind the tested tree, verify the intended parent and clean worktree, obtain every exact-candidate-commit gate receipt, publish and verify the exact remote head, then reacquire evaluator, check, and review evidence. Any content, head, or evidence-bound base change invalidates prior evaluator, check, and review evidence unless the provider proves the evidence applies to the exact new head/base pair. Complete this sequence within the frozen revision and non-progress budgets.
9. **Make the PR ready.** For an authorized merge not handled in step 6, apply freshness and mark Ready only after current-head checks and reviews pass and every actionable comment and mission finding closes. A known Ready reviewer trigger must instead be reserved and performed in step 6. If readiness starts evidence or another attempt, return to step 7. Ready alone never proves acceptance.
10. **Merge atomically.** A direct merge is allowed only when discovered provider policy makes the single merge transaction atomically reject an out-of-date base and enforce the exact accepted head plus all current required checks, reviews, and thread policies; a head-SHA compare-and-swap alone does not bind the base or mutable evidence. An authorized merge queue may instead bind the latest base and queued predecessors through an exact `merge_group` whose tree is covered by the required gates, evaluator, and provider checks; any group identity or tree change invalidates that evidence and returns to steps 2 through 7. The accepted evidence tree is the candidate tree only for the direct-descendant direct path; otherwise it is the exact tested prospective merge tree or exact queue group tree. Require all local and remote gates and reviews to remain passing. If neither atomic path is available, do not substitute a read-then-merge race; apply the ordered terminal predicates.
11. **Verify, clean, and terminate.** Verify the provider reports the expected PR and candidate merged into the intended base. Remove the exact mission worktree and only its exact local branch; preserve adopted or pre-existing branches and perform other cleanup only when authorized. Preserve and report them after blocked or failed merge when cleanup would destroy the recoverable candidate. Report terminal identities and receipts, consumer and gate receipts, responsibility delta, and gaps. Run one post-mission learning review only after the terminal is fixed.

## Invalidation and stopping

Worktree isolation proves only isolation. A commit proves only identity. Local gates, a fresh evaluator, required provider checks, and remote code review are independent evidence surfaces and cannot replace one another.

Use project budgets when present. Otherwise allow at most three implementation revisions for each admitted remediation slice—open, failed, rejected, or accepted—and spend one of six total mission admitted-slice units when it enters execution or evaluation. Replan or apply the ordered predicates after two consecutive non-improving cycles. Recontracting, replanning, renaming, retrying, context change, persistent goals, recurring runs, or read-only relabeling cannot reset either budget. A complex lifecycle may use distinct slices within its pre-admitted cumulative budget; if six is foreseeably insufficient, externally admit a larger mission budget before execution, and after exhaustion require externally admitted new-mission authority. Never loop “until perfect,” weaken an oracle, reuse stale-head evidence, or let a candidate-authored test define acceptance.

If no covered GitHub PR lifecycle terminal was requested, stop at the locally authorized terminal without loading this lifecycle. If the requested terminal cannot be reached because effect authority, provider access, required evidence, or an independent reviewer is unavailable, retain the exact candidate state and apply the ordered terminal predicates in `SKILL.md`.
