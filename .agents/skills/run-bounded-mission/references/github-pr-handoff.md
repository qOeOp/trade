# GitHub Delivery

Load only when the frozen endpoint includes a GitHub pull request. GitHub delivery is part of
Finalize, not a separate lifecycle or a custom merge service.

Freeze the repository, pull request, base, candidate head, and endpoint (`open`, `merge-ready`,
`merged`, or `cleanup`). For `open`, `merge-ready`, or `merged`, also freeze the Draft/Ready state,
required signals, merge method, and authority for each write: publication, comment, review request or
submission, thread resolution, repository settings, auto-merge or queue changes, and merge. For
`cleanup`, treat the candidate head as the exact merged head and instead freeze the merge commit and
evidence, exact inventory, and authority for each cleanup effect; those delivery-only fields and
authorities do not apply.

Raw GitHub data remains authority for pull-request facts. Use the connected GitHub owner or `gh`
under its current official contract. The waiter below owns only deterministic Codex provider
classification; it is not acceptance or merge authority.

## Pull request title preflight

Before any pull-request creation or title-edit effect, including `gh pr create` and
`gh pr edit --title`, resolve the current repository's title authority during Plan. When it
constrains title shape, bind one repository-owned executable validator shared with the remote gate;
prose, templates, inferred commit messages, and copied patterns are not validators. Keep this skill
generic and do not encode repository-specific title formats here. If the repository has no title-
shape authority, do not invent one.

Generate one proposed title from the Mission outcome under that authority. Immediately before the
effect, run the admitted validator against that exact string. A missing or stale validator, or a
nonzero result, freezes before any pull-request effect. On success, pass the same value explicitly
with `--title`; never let `gh` infer a different title. A changed proposed title requires fresh
validation.

Close only the exact frozen endpoint:

- `open`: publish the exact candidate to the frozen repository, base, and authorized Draft/Ready
  state. Do not import review, check, conversation, race, or merge requirements into this endpoint.
- `merge-ready`: satisfy the complete barrier below for the exact candidate without merging it.
- `merged`: first satisfy the merge-ready barrier, then verify that GitHub merged that exact head
  under separately frozen merge authority.
- `cleanup`: consume GitHub's exact merged-head evidence, then close only the separately authorized
  post-merge cleanup contract below; do not rerun publication, manual discovery, merge-ready, or
  merge barriers. This endpoint belongs only to a direct Mission or hub Finalize after node closure;
  it is not a task-dispatch pull-request endpoint, child-delivery state, or node closure.

For `open`, complete the Mission's required verification before publication. For `merge-ready` or
`merged`, freeze a review-stable candidate only after affected real-consumer and owner checks,
complete diff inspection, `git diff --check`, every activated independent instruction or judge audit,
and the full root gate. Publish that exact candidate, then let final-head CI and manual discovery run
concurrently; publication is not the endpoint. A correction invalidates only affected evidence and
must leave the corrected final head through the full root gate and final-head CI before the barrier.

## Manual exact-head discovery

Automatic Codex review is disabled for this repository. Do not infer otherwise from PR creation,
Ready state, or provider boilerplate that lists possible triggers. For a `merge-ready` or `merged`
endpoint, the Frame and admitted Plan must separately authorize a manual review request for the named
repository, pull request, and exact review-stable head. That authority is one effect, not a numeric
attempt or revision budget; it never implies a per-revision request or a request-until-clean loop.
For `open`, successful publication in the requested Draft/Ready state does not request or wait for
discovery.

Use a user-authenticated `gh` or UI issue-comment path owned by the authorized human actor in the
admitted Plan. The connected `add_comment_to_issue` action is not trigger authority: a comment
performed through the `chatgpt-codex-connector` app is a same-app self-trigger and cannot start
provider discovery. Do not use GitHub's generic reviewer-request path because the repository waiter
cannot correlate it. Immediately before the external effect:

1. validate any created or edited PR title through the repository-owned title preflight above;
2. render exactly one trigger from the existing helper, preserve its exact bytes, and validate those
   bytes offline against the frozen full lowercase 40-hex head before posting:

   ```text
   bun .agents/skills/run-bounded-mission/scripts/wait-pr-codex-review.ts --render-request <candidate-head>
   bun .agents/skills/run-bounded-mission/scripts/wait-pr-codex-review.ts --validate-request <candidate-head> < request-body
   ```

   The rendered body is:

   ```text
   @codex review

   Exact head: `<candidate-head>`
   ```

3. re-read the open PR and require its repository, base, Ready state, and head to match the frozen
   candidate; require the stable-candidate evidence above and no existing request for that authority;
4. require the active `gh` viewer or UI actor to equal the authorized human actor, then post through
   that user-authenticated issue-comment path with only the frozen repository, PR number, and
   validated body;
5. read back the exact created comment and require its locator, author, exact body, requested head,
   unedited timestamps/state, and `performed_via_github_app=null` before waiting. Null is a required
   observed postcondition for this request, not a universal claim about all CLI writes. Missing
   provenance, any GitHub app, or a readback mismatch fails admission; the exact connector app is
   classified `self-trigger` immediately.

A failed local syntax or read-only preflight freezes only the unissued effect; it neither mutates nor
invalidates the candidate. An ambiguous write result requires a fresh issue-comment read before any
further action and never permits a duplicate request by assumption.

The waiter may accept the provider's `THUMBS_UP` reaction on that same request comment or on the pull
request as a clean manual result only when the request is unedited, its body matches the template
exactly, its embedded full head equals the current snapshot head, and the reaction follows the
request within the current attempt and head window with matching provider, target, and causal order.
A provider `EYES` reaction on the request is progress evidence only: it neither starts a new attempt
nor advances the request-bound provider-signal window, and cannot hide a material signal after it.
A generated clean comment is notification only and cannot itself prove a terminal clean result. Its
complete fixed envelope must start with the exact canonical clean assertion and may carry a bounded
same-line remainder. That remainder has no independent review authority and does not alter the
canonical assertion's notification semantics. A non-canonical first line,
multiline or injected envelope, extra body, or otherwise structurally non-clean provider comment
blocks a later reaction. Only the structured
reaction or approval after the exact request supplies terminal authority. A bare legacy request,
edited request, stale or wrong head, same-app or other app transport, wrong provider or target,
ambiguous order, or changed PR head remains invalid or outstanding and fail-closed. Request admission
never suppresses already observed provider finding/disposition facts, and provider discovery never
repairs invalid request admission.

Wait through the bounded host loop and run
`bun .agents/skills/run-bounded-mission/scripts/wait-pr-codex-review.ts --repo <owner/name> --request-locator <readback-node-id> --request-author <authorized-login> <pr-number>`
as its read-only snapshot owner. Pass the exact opaque, non-empty readback node ID without
normalization. Each invocation emits one `codex-review-receipt/v1` JSON object. It
preserves the legacy `repository`, `pull_request`, `head_oid`, `status`, and `reason` fields and adds
orthogonal machine projections:

- `request.classification` is one of `valid`, `missing`, `malformed`, `edited`, `ambiguous`,
  `wrong-head`, `self-trigger`, or `incomplete`, with the request locator, candidate locators, author,
  timestamps/edit state, body, requested head, performed GitHub app provenance, and the complete
  observed request history needed to retain an earlier request-to-finding binding; the expected
  readback locator/authorized actor and their binding result are machine fields, and a mismatch is
  `incomplete` rather than a new attempt;
- `discovery.status` is one of `waiting`, `clean`, `finding_unrouted`, or `finding_routed`; its
  reviewed head, provider review, clean/progress signal, structured integrity problems, and finding
  array retain review, finding, thread, resolver, and non-empty disposition locators/identities/times.

The helper joins those facts inside the same snapshot invocation. Reason text is explanatory only;
callers consume the machine fields and exit code. Unknown or missing provenance, actor, locator,
reviewed commit, binding, representation, or pagination fails closed. Other GitHub summaries cannot
override this classifier:

- exit `0` is a terminal clean result for the exact reviewed head;
- exit `10` is pending and remains in the bounded wait lane;
- exit `20` is terminal routed discovery only: every finding has a non-empty disposition from the
  exact authorized request actor and a thread resolved by that same actor, but it is not clean;
- exit `1` covers invalid request admission, same-app self-trigger, provider usage/rate-limit,
  incomplete evidence, mismatch, ambiguous signal, provider failure, and unrouted finding;
- exit `2` is reserved for CLI argument or invocation usage errors.

Collect and validate the complete manual result before changing the candidate. Route the coherent
set by its highest material boundary: a Frame-contract failure returns to Frame; an owner, path,
boundary, responsibility-shape, or oracle failure, recurrence of the same causal root, candidate
non-convergence, or boundary growth returns the same Mission to Plan; otherwise combine all
reproduced candidate-local findings into the smallest coherent root-cause correction in Execute.
Apply the main skill's predicate and anti-metric rules; discovery never authorizes a successor
Mission, replacement task, `Stop+1`, or terminal rejection.

Thread resolution is a separate write authority and may occur only after the finding is verified as
addressed, inapplicable, duplicate, or non-material; `outdated` alone is not evidence.

After every complete provider finding is reproduced and routed, a non-empty disposition reply plus a
resolved thread is terminal routed discovery. Preserve that result and revalidate each disposition
against the corrected final candidate; do not require the provider to report clean on that later head.
Rerun affected evidence, every candidate-affected independent audit, the final root gate, and complete
non-empty final-head CI, but do not automatically request another review. A separate request requires
a new evidenced reason and explicit authority in Frame and Plan; a correction, revision count,
`Stop+1`, latency, or a preferred clean result supplies neither.

Keep related Missions on the direct per-PR path owned by task dispatch. Do not combine their branches,
heads, or reviews merely to reduce invocations; admit aggregation only when an existing owner proves
the complete source, merge, review, and exact-head acceptance chain without new coordinator machinery.

Retain one final delivery receipt in the handoff, not a ledger. Embed the waiter receipt without
manually rejoining request, review, finding, disposition, or thread facts; add only the corrected
final head and base, complete final-head checks, unresolved-thread count, and auto-merge or queue
state. The receipt does not prove candidate revalidation, final CI, acceptance, or merge authority.

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

Unknown, absent, stale, or pending required final-head data fails the barrier. The completed manual
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

## Post-merge cleanup

Cleanup is a separately approved effect set after merge, not an implication of publication, merge,
task ownership, or permission to write the repository. Start only after GitHub reports the exact
frozen candidate head `MERGED`; record repository, pull request, head, base, merge commit, and
observation time before inspecting any cleanup target. A pre-existing or externally performed merge
can satisfy this evidence gate, but grants no cleanup authority.

Freeze an exact inventory before the first effect and retain every exact authorized identity even
when it is absent. For each artifact record presence as `present`, `absent`, or `unknown`, its
owner-specific identity and OID, using `N/A` only when it is absent or non-Git, plus its authority and
recoverability. Include the remote branch; Codex task and observed managed worktree; local branch;
each local Mission tag and each remote Mission tag as separate artifacts; and the designated
local-main checkout, local-main OID, remote, canonical full ref, and observed remote-main OID. Keep
unknown or non-target artifacts out of the inventory. Do not discover a broader cleanup set while
executing.

Apply only the rows with separately frozen authority. An exact deletion artifact recorded absent
succeeds as `already_absent`; non-deletion rows use their row-specific status. A pre-effect OID,
owner, policy, status, or classification mismatch is `preserved` plus its reason, never a request to
widen authority or force the operation. Use `partial` only when an effect changed state before a
required postcondition failed; record its actual before/after state, reason, recovery, and dependency
stop.

| Artifact | Preconditions | Action | Postcondition | Failure disposition |
| --- | --- | --- | --- | --- |
| remote candidate branch | Exact full ref, presence, and OID are inventoried separately from merge authority | Preserve it. No current callable owner is proved to atomically bind the expected OID, absence of every open pull-request reference, repository policy, and delete authority; no deletion action is admitted | No branch state changes; an exact post-read records its actual presence and OID, with a present ref reported as `preserved`, never retired | An initially absent ref succeeds as `already_absent`. Drift, protection, an open-PR reference, policy or authority mismatch, or unknown state is preserved with the unavailable-owner capability reason |
| Codex-managed task/worktree | Exact task and host are terminal, unpinned, confirmed Codex-managed and non-permanent, have no newer activity or user work, and the candidate is recoverable; the observed current Codex app contract owns archive, background managed-worktree retirement, and a restore snapshot for this classification | Archive the exact task through that app owner and observe its background retirement; never remove its directory or run raw `git worktree remove` | Task is archived, managed worktree is absent, and the promised restore snapshot route is recorded | Already fully retired succeeds as `already_equal`. Active, pinned, permanent, dirty, unknown, or pre-effect contract mismatch is preserved. If archive changes task state but retirement or restore evidence is still incomplete, report `partial` and stop dependents |
| designated local `main` | Exact checkout is on the designated `main`, has empty tracked and untracked status, uses the frozen remote/canonical full ref, still equals the frozen local-main OID, and the observed remote ref still equals the frozen remote-main OID; no user change or divergence is present | Fetch only the explicit remote/full ref without tags, require the fetched ref to equal the frozen remote-main OID, then fast-forward the checkout to that exact OID with `git merge --ff-only <frozen-remote-oid>`; do not use `git pull`, stash, reset, rebase, or switch an unknown checkout | Local `main` and a fresh remote-ref read equal the frozen remote-main OID and the checkout remains clean; record `synchronized` when its OID changed and `already_equal` when it did not | An absent checkout, or any failure before the local-main OID moves, is `preserved` and stops dependents. If it moved but a later remote, cleanliness, or identity postcheck fails, report `partial` with actual before/after state and stop dependents |
| local candidate branch | Exact local name, full ref, presence, OID, and worktree ownership are inventoried | Preserve it. `git branch -d` does not bind the expected old OID, while expected-OID ref deletion does not enforce worktree ownership; no current native owner binds both, so no deletion action is admitted for ancestry or squash merges | No branch state changes; an exact post-read records its actual presence, OID, and worktree ownership, with a present ref reported as `preserved`, never retired | An initially absent ref succeeds as `already_absent`. Advanced, unmerged, checked-out, worktree-owned, squash-only, or unknown refs are preserved with the unavailable-owner capability reason; never use `-D`, `update-ref`, or a custom helper |
| local Mission tag | Exact local full tag ref was created for this Mission, was declared ephemeral before cleanup, still equals its frozen local OID, and local-tag cleanup is authorized | Default to preserve. With authority, delete only that explicit local full ref through an expected-OID compare-and-delete owner | An exact local ref read reports absent | Already absent succeeds. Undeclared, non-ephemeral, advanced, unauthorized, or unknown local tags are preserved |
| remote Mission tag | Exact remote full tag ref is inventoried separately, was created for this Mission, was declared ephemeral before cleanup, still equals its frozen remote OID, and remote-tag cleanup has separate authority and current policy permission | Default to preserve. With authority, delete only that explicit remote full ref through an owner bound to its expected remote OID; never infer its OID from the local tag | An exact remote-ref read reports absent | Already absent succeeds. Undeclared, non-ephemeral, divergent, advanced, policy-blocked, unauthorized, or unknown remote tags are preserved |

Keep the order fail-closed: freeze all rows; retire an eligible managed worktree and synchronize the
designated local `main` before finalizing the preserved local-branch receipt; and skip every later
action whose precondition depended on a failed, preserved, or partial earlier row. Independent tag
effects still need their own authority and current policy observations. Never use unresolved globs,
broad directories, `-D`, unconditional force, forced worktree removal, or `reset --hard`.

Finish with an exact receipt listing every inventoried artifact as `removed`, `already_absent`,
`synchronized`, `already_equal`, `preserved`, or `partial`. Record before/after presence and
owner-specific identity/OID, using `N/A` for absent or non-Git artifacts, plus reason, recoverability,
and every dependency stop. Managed worktrees use the app's saved snapshot when its observed current
contract provides one; a deleted tag can be recreated from its frozen OID only while that object
remains available; a fast-forwarded `main` is not rolled back by cleanup. An idempotent re-run must
classify the state it actually observes; it never rewrites a prior partial result as success.

Until a current owner proves the missing atomic branch-deletion contracts, Finalize must report the
aggregate user-visible outcome as safe partial cleanup, not as a `partial` row result, whenever either
candidate branch remains present and is preserved. An initially absent branch remains
`already_absent`; when both are absent, do not infer an aggregate partial outcome from the unavailable
deletion capability. Independently eligible artifacts may still close under their own rows.
