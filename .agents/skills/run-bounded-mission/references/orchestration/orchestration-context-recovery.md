# Mission Replacement Checkpoint

Use one complete replacement checkpoint in the current conversation when a nontrivial single Mission
has an admitted Plan or task dispatch activates a multi-Mission hub. It is conversation evidence, not
Goal prose, repository state, durable workflow state, a registry, scheduler, ledger, retry engine, or
second lifecycle.

Immediately after single-Mission Plan admission, emit the current checkpoint before Execute. Replace
it as a whole after any decision-changing Frame, Plan, origin, candidate, effect, evidence, finding,
position, authority, Stop, Resume, or terminal-route change; never append a delta that can drop an
older fact. Ordinary progress that changes none of those fields needs no replacement.

Treat the current user-inherited `interaction_language` as a recovery-critical Frame and authority
fact. Preserve its exact value through task dispatch, interruption, Handoff, and compaction; only an
explicit user change replaces it. Recovery never guesses it again from recent messages, task output,
locale, or repository content. User-visible commentary and Finalize use the inherited value while
code, commands, schemas, identifiers, and raw evidence preserve their original form.

For a multi-Mission hub only, task dispatch may retain one in-turn observation wave before classifying
its receipts. Preserve every raw receipt and locator, normalize every unrecognized or malformed value
as unknown-impact, and close the wave at any declared boundary. Reconcile one authoritative snapshot,
including the complete approved-node inventory, exact create attempts or identities, admitted relation
locators, stable component grouping, owner arbitration, the derived compact graph with non-empty
waiting/runnable/running/frozen/needs_attention/terminal slices, and at most one stage/global judgment.
Preserve blocked/completed reasons and results plus their raw locators. Retain the exact target set and
latest cursor per observed `threadId`/`hostId`; a continued target with missing/reset/malformed cursor,
revision regression, host mismatch, or an omitted poll at an early wake is not evidence of no change.
When the latest bounded wait returned no actionable or terminal event, recover the Hub position as
`yielded`, not as a still-running monitor. A later Goal continuation or real health anomaly may consume
the retained target/cursor facts for one compact read, then must either act on an actionable or
terminal event or yield again. Recovery never immediately resubscribes after a no-event result,
replays polling history, narrates unchanged state, or creates a scheduler, timer, daemon, or background
service.
Fan in each component once, derive the hub position, then emit the complete replacement before any hub-issued
question/message, effect, dependent release,
turn/interruption/Handoff/compaction, source or authority drift, or unknown-impact handling. A wave
cannot cross a boundary, hide changed facts, or weaken the single-Mission rule above. A same-canonical-
ref predecessor merge or source drift closes the wave; after tip reconciliation, release only its
direct successor's identity-bound final slice.

```text
Mission checkpoint
Frame: <exact complete current Frame projection>
Plan: <exact complete current Plan projection, or none — invalidated/pending admission>
Origin / candidate / effects: <origin; exact diff, commit, or none; issued and unissued effects>
Evidence / findings: <decisive passes, failures, unavailable evidence, findings, and rejected candidates>
Position / next legal operation: <current stage or route; one exact next legal operation>
Authority / Stop / Resume / terminal: <current authority; Stop evidence; valid Resume predicate or none; terminal predicate or none>
```

A reframe or Plan invalidation makes the prior Plan stale. Before another operation, re-emit the
complete checkpoint: use the changed current Frame after reframe, reconcile every other field whose
live value changed (including `Position / next legal operation`), preserve only unaffected fields,
and set Plan to exactly `Plan: none — invalidated/pending admission`. Never retain residual Plan
prose. After a new Plan is admitted, replace the whole checkpoint again with its exact complete
projection before Execute.

For a multi-Mission hub, use the same fields and let task dispatch add only node identity; approved
create attempt or receipt; `blocks`, `superseded_by`, and `revalidate_after` evidence locators and
affected slices; current component snapshot; child, release, Goal, endpoint, and current-wave facts
that have no single-Mission equivalent; and the compact graph plus cursor-bound target facts needed to
resume the current wait without replaying history. Keep assessment data once at checkpoint level. Native tasks
own identity, Git and GitHub own repository facts, and the raw request and current Frame remain
authority; the checkpoint authorizes no effect. A node stays in the inventory when superseded,
interrupted, blocked, cancelled, terminal, or pending identity until its authoritative disposition is
reconciled; runnable work is not the inventory boundary.

The hub checkpoint may index current anomaly locators and signals not yet fanned into a component, but
it remains active-run evidence. At a wave or Goal boundary, the lifecycle-QA owner may emit one
compressed terminal receipt into native task history and the checkpoint may retain its locator; never
copy that receipt into a durable hub ledger or treat the checkpoint itself as cross-run authority.

## Interruption and recovery gate

A later turn, user interruption, compaction, Codex chat Handoff, or source drift freezes the next
mutation and every unissued effect. Call `get_goal`, then reconcile the whole checkpoint with the raw
request and authority plus current conversation, native task, Git, pull request, and external-effect
facts that can change the next operation. Replace the checkpoint with the reconciled live facts before
continuing; a static contract or fresh-context trace is not runtime proof.

Match the exact Frame and either the admitted Plan prose or the exact cleared Plan representation,
plus origin, candidate and effects, decisive evidence and findings, current position, next legal
operation, interaction language, authority, Stop predicates, and any Resume or terminal route. If those facts cannot exclude
a different Mission or candidate, freeze before mutation or effects and obtain the missing user-owned
fact or take the main skill's evidenced route. A user override follows the main skill before this gate
can release work.

For a recovered hub, also reconcile every approved node and create attempt against its exact native
identity or unresolved receipt, reopen every relation locator and affected slice, rebuild the current
component snapshot and compact graph, verify every continued target's cursor continuity, and test the
projected release graph for acyclicity. Missing a previously approved
node, adopting a same-title resemblance, issuing a second create for an unresolved attempt, or treating
an old component grouping as current keeps all affected releases frozen. A pressure cycle returns the
preserved members to hub Plan for one component Mission; recovery never chooses an arbitrary order or
stores a scheduler state.

Do not turn ordinary friction into `blocked`. Candidate-local revise, revision-pressure replan,
reframe, temporary external or capability delay, cancellation, and terminal impossibility retain the
main skill's distinct routes. Only an exactly recovered temporary unavailable predicate may retain a
`Resume` stage, and only changed evidence for the same required decision releases it. Unsatisfiable
acceptance and completed-replan no-viable predicates remain terminal under the unchanged Frame.
