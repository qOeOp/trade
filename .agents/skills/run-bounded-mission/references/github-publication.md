# GitHub PR lifecycle

A `covered GitHub PR lifecycle terminal` means publishing a GitHub PR, carrying it through review, or merging it. Load only when the frozen mission outcome explicitly includes one.

## Repository-enforced path

When the repository contains `scripts/pr-lifecycle.ts` and a base-owned
`pr-lifecycle-gate` workflow, use them as the mechanical lifecycle boundary:

0. Require automatic Codex PR reviews to be disabled for the repository. Ready,
   open, reopen, or update must not create a second reviewer trigger. If this
   provider setting cannot be verified, the enforced path is unavailable.
1. Create one Draft PR as the shared coordination surface. Before any further PR
   mutation, run `bun scripts/pr-lifecycle.ts claim --repo <owner/repo> --pr
   <number> --mission <stable-id>`. The command atomically creates the annotated
   `codex-pr-claim/<pr>` tag ref and prints its immutable tag-object SHA plus a
   private capability once. Keep the capability only in the winning mission
   context; never post or persist it to GitHub, commits, artifacts, or handoff
   prose.
2. The claim tag ref, not its display comment, is the authority. GitHub permits
   only one atomic ref creation, so one cooperating writer wins and every loser
   becomes read-only. The tag stores only the capability hash because parallel
   Codex sessions normally share one GitHub actor; actor identity alone does not
   select a session. Deleting or minimizing comments cannot promote a loser.
   Claims do not expire. Release or reassignment requires explicit user
   authority and deletion of the exact claim, review, trigger, and seal refs;
   never infer it from write permission. This is a cooperative Codex lock, not
   hostile-actor security.
3. Pass `--claim <tag-sha> --capability <private-value>` to every writer
   command. The claim tag binds the repository, PR, actor, mission, initial
   head, and capability hash. Any session without the raw capability remains
   read-only even when it authenticates as the same GitHub actor. If a
   force-push removes the initial head from the PR lineage, stop for explicit
   recovery.
4. Keep the PR Draft and trigger one review per exact head/base with `bun
   scripts/pr-lifecycle.ts review --repo <owner/repo> --pr <number> --claim
   <tag-sha> --capability <private-value>`. Before posting `@codex review`, the
   command atomically creates
   `codex-pr-review/<pr>/<head>`, bound to the claim, current head, and live
   base. After posting the trigger, it creates
   `codex-pr-review-trigger/<pr>/<head>`, which immutably binds that cycle to
   the original comment ID, node ID, and creation time only if head and base are
   unchanged after the comment write. GitHub does not provide an expected-head
   condition on issue-comment creation, so any drift, deletion, or crash between
   these refs poisons the cycle permanently; do not retry it or classify it as
   historical.
5. Permit no push while a review cycle is pending. A clean cycle has exactly one
   post-trigger Codex `THUMBS_UP`, optionally one `EYES`, and no other
   post-trigger Codex reaction, review, or finding root. A finding cycle has
   exactly one exact-head Codex review and its exact root set, no result
   reaction, and optionally one `EYES`. Any historical or current
   `THUMBS_DOWN` poisons the history. After that exact result, run `bun
   scripts/pr-lifecycle.ts seal
   --repo <owner/repo> --pr <number> --claim <tag-sha> --capability
   <private-value>`. It creates `codex-pr-review-seal/<pr>/<head>` bound to the
   exact visible trigger, clean reaction GraphQL node identity, review state and
   body, and exact finding-root set.
   Each provider snapshot uses one GraphQL response containing PR identity,
   commits and their immediate parents, reviews, comments, reactions, and
   threads, bracketed by lightweight PR identity reads that must match it
   exactly. The supported envelope is closed at 100 items for every top-level
   and nested connection; pagination, provider errors, partial or malformed
   data, and duplicates fail closed. This is not a provider transaction and has
   no transaction token. The seal command repeats the exact full response as a
   freshness check immediately before publishing the seal ref. Drift before
   publication leaves no public seal; drift after ref creation can leave a
   poison seal and requires explicit recovery.
   Every prior cycle must retain its exact trigger, receipt, result, and seal
   before a new-head cycle may start, and every retained historical finding
   must already have one exact disposition and be resolved. Every Codex review
   and finding root in the retained PR lineage must belong to exactly one sealed
   cycle, whose result is unique for that head. Missing, edited, minimized,
   deleted, duplicated, unsealed, orphaned, or ambiguous evidence fails closed
   and requires explicit user-authorized recovery.
6. For every Codex finding, first seal its review cycle, make one coherent
   append-only fix commit, then run `bun scripts/pr-lifecycle.ts address --repo
   <owner/repo> --pr <number> --thread-id <node-id> --finding-comment-id
   <database-id> --disposition <fixed|deferred|rejected> --fix-sha <full-sha>
   --reason <text> --claim <tag-sha> --capability <private-value>`. It replies
   only to a Codex-authored root in that exact inline thread with one unique
   structured disposition. A fresh complete snapshot must expose the exact reply
   database ID, GraphQL node ID, creation time, body, fields, and body hash before
   the command creates the immutable annotated
   `codex-pr-finding-seal/<pr>/<finding-comment-id>` tag. That seal binds the
   repository, PR, claim, mission, actor, thread, finding root, review head,
   exact reply identity and body, disposition, reason, and fix commit. Only
   after the seal exists may the command resolve the thread. The receipt commit
   must be a retained strict descendant of the finding review head by walking
   the recorded commit-parent DAG; array order is not ancestry, and a
   pre-finding or sibling commit is invalid.
   Before reporting success, the command takes another fresh complete snapshot,
   rereads the immutable seal, and requires unchanged PR identity, the same
   finding root, the exact sealed live reply, and a resolved thread. Missing,
   edited, deleted, duplicated, identity-mismatched, or differently classified
   replies fail closed; the resolved flag alone is insufficient. These writes
   are not a provider transaction. Exact retries recover in order across reply,
   seal, and resolve without posting a second reply, but there is no
   compatibility fallback for unsealed historical dispositions. Every new code
   head needs a new review tag, trigger, result seal, and final clean seal.
   After claim and every meaningful review, seal, address, or dispatch stage,
   explicitly run `bun scripts/pr-lifecycle.ts status --repo <owner/repo> --pr
   <number> --claim <tag-sha> --capability <private-value>`. Run it again
   immediately before Ready and immediately before merge. This sole status
   command writes non-authoritative navigation; no lifecycle writer refreshes
   it automatically, and verification never consumes it.
7. A root 👍, eyes reaction, silence, summary, resolved flag, unsealed result, or
   old-head review
   is not independently sufficient. Run `bun scripts/pr-lifecycle.ts verify
   --repo <owner/repo> --pr <number> --allow-draft`; it reconstructs one receipt
   from the atomic claim, review, trigger, and seal tags, every exact retained
   historical trigger and result, trusted Codex identity, exact current
   head/live base, every visible explicit review trigger, one correlated and
   sealed clean reaction, complete thread
   snapshot, and exact immutable finding seals whose bound replies remain
   present and unchanged in the current PR commit lineage.
   Resolve live base from the repository's current base branch ref, not the
   pull request object's associated base OID, which can remain historical while
   the branch advances.
   Before success, replace any prior conclusion with a non-success status and
   reconstruct the complete provider snapshot again. Success must be the
   successful path's final provider write and certifies only that immediately
   preceding complete snapshot; GitHub commit statuses provide no transactional
   post-write validation or rollback. Strict required checks own later live-base
   drift.
   Run it immediately before merge and permit no intervening PR writes. It fails
   closed on ambiguity, pagination, deletion/minimization, duplicates, forks,
   stale identities, or incomplete provider data.
8. After local verification, mark Ready and run `bun
   scripts/pr-lifecycle.ts dispatch --repo <owner/repo> --pr <number> --claim
   <tag-sha> --capability <private-value>`. The
   dispatch only wakes the default-branch workflow. The workflow checks out the
   exact default-branch workflow SHA, requires it to equal the live base,
   reruns the same verifier against live provider state,
   and writes the sole `pr-lifecycle-gate` status to the live PR head only after
   head, base ref, and base SHA match in two complete pre-success snapshots.
   Candidate
   workflow or script content is never trusted.
9. Merge only when the ruleset requires that exact status from the expected
   integration, all existing checks and review-thread rules pass, and an
   expected-head merge succeeds. A head or live-base change invalidates the
   receipt. Return to Draft and start a new cycle only when every earlier cycle
   is exactly sealed; otherwise stop for explicit recovery.

If any enforced-path component or provider permission is unavailable, do not
hand-roll a weaker substitute. Apply the ordered terminal predicates in
`SKILL.md`.

The PR that first installs this workflow is not itself on the repository-enforced
path: GitHub cannot dispatch a workflow that is absent from the default branch.
Treat that bootstrap as a separately admitted change under the pre-existing
strict ruleset, exact-head evaluator, remote review, and checks; do not claim the
new gate protected it. After bootstrap merge, run a hosted fail-closed and
success canary from the default branch, verify the status integration identity
and strict blocking, and only then add `pr-lifecycle-gate` to required checks.

## Authority and facts

Treat an explicit request to carry the mission through a named terminal effect as authority for its necessary in-scope intermediate GitHub effects. A request to open a PR does not authorize merge; a request to merge does not authorize deployment, release, or unrelated fixes. Stop before any effect outside the frozen ceiling.

Discover the repository, remote, default branch, authentication, policies, required checks and reviews, available provider tools, and current related PR before acting. If required provider state or an explicitly requested remote reviewer is unavailable, do not substitute another signal; apply the ordered terminal predicates in `SKILL.md`.

Classify the terminal before mutating provider state. For pure review-only, inspect and preserve draft, auto-merge, and merge-queue state. For merge or candidate/PR mutation, inspect that state before and after each mutation; use an authorized action to quiesce integration not yet authorized by step 10 and verify it stopped, or apply the ordered terminal predicates. Only in those mutating lifecycles, before the evaluator, verify a newly published/updated PR is draft and return an adopted Ready PR to draft; expose draft-blocked evidence only through step 6. Bind the prior state of any temporary provider-wide trigger or permission control, restore and verify it before every terminal, or require separate authority for a lasting change and otherwise apply the ordered predicates.

Apply one **freshness rule** before each publication trigger, expensive remote-review trigger, provider review submission, Ready transition, positive terminal, and merge: take a complete head/base/live-base snapshot and require the exact candidate commit, selected base ref, and evidence-bound base commit. On drift, make no reviewer write; within cumulative budgets update or rebuild against the new base and reacquire every invalidated evidence surface, counting each rebuild as a revision. For an authorized merge terminal, use the queue alternative only after every candidate-bound pre-entry prerequisite passes and only when the provider enforces integration quiescence from entry through step 10; while quiesced, reacquire required local gates, fresh evaluator, and provider checks and reviews on the exact `merge_group`. Otherwise do not enter the queue and apply the ordered terminal predicates. Any acceptance-tree or `merge_group` change invalidates evidence bound to the prior tree. This read never substitutes for step 10's atomic merge guarantee.

Apply one **reviewer-trigger rule** per exact head/base. Inventory every provider action that can wake the same reviewer, including explicit comments or requests, opening or reopening, publication or update, and Ready; reserve exactly one authorized trigger when possible, preferring a later required Ready trigger. A known trigger action itself creates a pending attempt without reaction or acknowledgement. If another trigger occurs, return to evidence wait and forbid merge until every known current-identity attempt is terminal and the complete snapshot and applicable threads close. On unchanged identity, never repeat a pending attempt or a terminal attempt without new remediation evidence. Only thread-only remediation requiring reconfirmation of the frozen disposition permits exactly one evidence-bound same-head/base re-review wake. Otherwise make no reviewer write, timeout retry, or status chatter.

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
