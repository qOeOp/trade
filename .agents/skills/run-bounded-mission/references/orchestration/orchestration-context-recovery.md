# Mission Replacement Checkpoint

Use one complete replacement checkpoint in the current conversation when a nontrivial single Mission
has an admitted Plan or task dispatch activates a multi-Mission hub. It is conversation evidence, not
Goal prose, repository state, durable workflow state, a registry, scheduler, ledger, retry engine, or
second lifecycle.

Immediately after single-Mission Plan admission, emit the current checkpoint before Execute. Replace
it as a whole after any decision-changing Frame, Plan, origin, candidate, effect, evidence, finding,
position, authority, Stop, Resume, or terminal-route change; never append a delta that can drop an
older fact. Ordinary progress that changes none of those fields needs no replacement.

For a multi-Mission hub only, task dispatch may retain one in-turn observation wave before classifying
its receipts. Preserve every raw receipt and locator, normalize every unrecognized or malformed value
as unknown-impact, and close the wave at any declared boundary. Reconcile one authoritative snapshot,
including owner arbitration and at most one stage/global judgment, derive the hub position, then emit
the complete replacement before any hub-issued question/message, effect, dependent release,
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

For a multi-Mission hub, use the same fields and let task dispatch add only node identity, dependency,
child, release, Goal, endpoint, and current-wave facts that have no single-Mission equivalent. Keep
assessment data once at checkpoint level. Native tasks own identity, Git and GitHub own repository
facts, and the raw request and current Frame remain authority; the checkpoint authorizes no effect.

## Interruption and recovery gate

A later turn, user interruption, compaction, Codex chat Handoff, or source drift freezes the next
mutation and every unissued effect. Call `get_goal`, then reconcile the whole checkpoint with the raw
request and authority plus current conversation, native task, Git, pull request, and external-effect
facts that can change the next operation. Replace the checkpoint with the reconciled live facts before
continuing; a static contract or fresh-context trace is not runtime proof.

Match the exact Frame and either the admitted Plan prose or the exact cleared Plan representation,
plus origin, candidate and effects, decisive evidence and findings, current position, next legal
operation, authority, Stop predicates, and any Resume or terminal route. If those facts cannot exclude
a different Mission or candidate, freeze before mutation or effects and obtain the missing user-owned
fact or take the main skill's evidenced route. A user override follows the main skill before this gate
can release work.

Do not turn ordinary friction into `blocked`. Candidate-local revise, revision-pressure replan,
reframe, temporary external or capability delay, cancellation, and terminal impossibility retain the
main skill's distinct routes. Only an exactly recovered temporary unavailable predicate may retain a
`Resume` stage, and only changed evidence for the same required decision releases it. Unsatisfiable
acceptance and completed-replan no-viable predicates remain terminal under the unchanged Frame.
