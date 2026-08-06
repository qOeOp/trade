# Assure Mission Quality Across the Lifecycle

Load this policy only when observed evidence suggests a mismatch between a Mission's requirement,
Plan, candidate, verification, delivery claim, integrated behavior, or lifecycle operation. Do not
load it for an ordinary Mission whose current transition is supported by its existing evidence.

Treat QA as a cross-lifecycle control plane. It observes relationships, classifies a signal, and
routes the root cause to an existing owner. It is not a sixth stage, a second verifier, a repairer, or
an authority to widen scope. Continue to use Frame → Plan → Execute → Verify → Finalize; run the
smallest assurance check at the boundary where a credible signal appears.

## Inspect the lifecycle relationship

Inspect only the row implicated by current evidence. Verification proves candidate behavior; QA asks
whether the requirement, Plan, candidate, evidence, and claim still support one another.

| Boundary | Assurance question | Decisive mismatch |
| --- | --- | --- |
| Requirement / Frame | Is the outcome rational for a real consumer, authorized, internally consistent, and falsifiable? | The requested mechanism cannot produce the outcome, contradicts authority, or lacks a consumer or decidable acceptance. |
| Plan | Does the admitted owner, scope, candidate shape, and verification close every material Frame obligation? | An obligation is omitted, invented, assigned to the wrong owner, or supported only by an unresolved premise. |
| Execute | Does the complete candidate cover the admitted Plan without hidden scope or unrelated effects? | Required behavior has no candidate locus, or the diff adds unapproved behavior, authority, state, or effects. |
| Verify | Is evidence current, independent where required, integrity-bound, consumer-relevant, and able to distinguish failure? | Evidence targets the wrong candidate, omits an affected consumer, echoes candidate claims, or uses an inadequate oracle. |
| Finalize | Are every stated result, limitation, effect, head, check, review, and terminal status true now? | A claim exceeds observed evidence, unavailable evidence is presented as passing, or an effect/terminal is attributed to the wrong owner. |
| Post-merge / system | Does the integrated result preserve the consumer outcome, authority graph, load routes, and maintenance boundary? | Merge integration creates conflicting authority, dead or duplicate loading, a regression, or systemic cost hidden by local success. |
| RBM self-QA | Did the framework choose and execute its own stages, routes, communication, and effects correctly? | The Mission lifecycle itself loses work, loops, misroutes, over-blocks, or regresses behavior. |

## Classify one minimal signal

Choose exactly one outcome for the observed mismatch. Do not average signals or let a lower-severity
fact overwrite a higher boundary already selected by coherent evidence.

| Outcome | Evidence threshold | Required action |
| --- | --- | --- |
| `block` | A mandatory condition for the current transition or effect is false, or evidence required to prove it is unavailable. | Freeze that transition or effect and return the finding to its root-cause owner. |
| `route` | A mandatory defect is real, but it does not invalidate the current transition; correction belongs to another existing owner or a later system boundary. | Preserve the exact impact and locator, send it to that owner, and continue only unaffected work. |
| `advisory` | Current research supports a bounded improvement opportunity, but present authority and acceptance remain satisfied. | Offer a proposal with benefit, cost, risk, and falsifier; do not alter the current Frame or Plan. |
| `no-signal` | Evidence supports current alignment, is insufficient for a non-required concern, or the observation is a controlled false positive. | Add no QA work, artifact, or communication and continue the existing lifecycle route. |

Unknown evidence is not automatically a defect. Use `block` only when that evidence is required for
the current transition or effect; otherwise use `no-signal` and make no claim that the unknown passed.

## Separate findings from improvements

Emit a **mandatory finding** only for an evidenced violation of current Outcome, authority, admitted
Plan, required consumer behavior, verification integrity, effect safety, or truthful delivery. Name
the failed relationship, immutable locator, impact, and responsible owner. The owner performs the
smallest root-cause correction through the existing lifecycle; QA performs none of it.

Emit an **improvement proposal** only after current primary or strong community evidence supports the
premise and the proposal names a consumer benefit, adoption cost, regression risk, and disconfirming
observation. Classify it `advisory`. An unsupported preference is not a QA signal. A proposal becomes
work only through a newly admitted Frame or Plan; it never silently expands the current Mission.

## Route the root cause

Route by the defective authority or behavior, not by where the symptom was noticed.

| Owner | Route here when the root cause is |
| --- | --- |
| planner | Requirement rationality, authority selection, scope, acceptance, Plan alignment, or repeated causal pressure requiring replan. |
| orchestrator | Task identity, dependency release, Hub↔child monitoring or communication, recovery, or coherence-window behavior. |
| executor | Candidate implementation or admitted candidate-to-Plan coverage. |
| verifier | Evidence selection, test integrity, oracle strength, independence, provenance, or affected-consumer coverage. |
| delivery | Finalize truth, exact-head state, CI/review/conversation evidence, publication, merge readiness, or another external-effect barrier. |
| optimizer | Post-merge/system coherence, repeated cross-Mission degradation, duplicate authority, context or latency inflation, or an RBM behavior regression. |

Load the routed owner's existing policy only after classification. In particular, use
[revision pressure](../planning/planning-revision-workflow.md) for recurring causal pressure,
[test integrity](../verification/verification-test-integrity-policy.md) for defective test evidence,
[reviewer handoff](../verification/reviewer-handoff.md) for independent audit, and
[GitHub delivery](../delivery/delivery-pullrequest-workflow.md) for remote delivery facts.

When the signal is corrosion, select only the exact owner-local playbook whose activation predicate
the raw evidence satisfies. The link is a route, not repair authority: QA does not copy, summarize,
or execute the playbook. Load no playbook for `no-signal`, and do not preload the table.

| Signal root | Repair owner | On-demand playbook |
| --- | --- | --- |
| repository structure, authority, or dependency corrosion | optimizer | [architecture corrosion](../optimization/optimization-architecture-corrosion-playbook.md) |
| current-state documentation drift or superseded exploration | optimizer | [documentation corrosion](../optimization/optimization-documentation-corrosion-playbook.md) |
| test-suite redundancy, obsolescence, or deletion pressure | optimizer | [Test GC](../optimization/optimization-test-gc-playbook.md) |
| RBM trigger, authority, load-route, or instruction corrosion | optimizer | [Skill corrosion](../optimization/optimization-skill-corrosion-playbook.md) |
| weak test selection, scenario, boundary, or oracle | verifier | [test corrosion](../verification/verification-test-corrosion-playbook.md) |
| duplicate, ambiguous, dead, universal, or parameter-heavy Step glue | verifier | [BDD Step corrosion](../verification/verification-bdd-step-corrosion-playbook.md) |
| CI selection, trigger, final-head, or required-check corrosion | delivery | [CI corrosion](../delivery/delivery-ci-corrosion-playbook.md) |

Load a minimal set only when the same raw evidence independently activates more than one repair
boundary. If the boundaries or owners are not independent, route the combined cause to Plan instead
of making playbooks call one another.

## Keep an Assurance Trace, not a second ledger

Reconstruct only the relationship needed for the active signal from current owners:

```text
obligation or claim → authority locator → candidate locus or snapshot → evidence locator and result
                    → signal outcome → responsible owner
```

Treat native task terminal and checkpoint receipts, Git objects and history, and GitHub pull-request,
review, CI, and delivery receipts as the cross-run facts. Do not copy those facts into a report,
database, registry, persistent trace file, or second status model. A hub checkpoint is only the
active-run index for current anomaly locators and unmerged signals; it is not the cross-run record.

At an architecture-wave or Goal Finalize, inspect only its current terminal, checkpoint, and anomaly
locators. When they contain one or more concrete signals, emit one compressed, deduplicated self-QA
terminal receipt in the native task history. Keep only the causal fingerprint and category, decisive
evidence locators, observed or unavailable cost, `systemic` or `incidental` classification, canonical
repair owner, current repair status, dynamic acceptance, and the supported recurrence count and
observation window. This is an index back to native facts, not a copy of them or a new schema. When
there is `no-signal`, retain nothing and impose no ordinary-path history scan or context cost.

Only when that terminal aggregation actually groups facts by task type, load
[canonical task types](../orchestration/orchestration-task-types.md) and consume its compact projection.
Keep missing or unrecognized values in an explicit `unknown` group so the aggregation remains
conservative and count-preserving. Type may index evidence, but it cannot by itself change signal
outcome, severity, recurrence, priority, route, repair owner, verdict, or acceptance. Ordinary QA
inspection and routing do not load the taxonomy.

On a later run, read the prior terminal receipt, current checkpoint, and anomaly locators first. Drill
into native task or Git/GitHub history only for a signal whose classification, cost, recurrence,
repair status, or acceptance cannot otherwise be reconstructed. Build a fingerprint from the failed
relationship, causal root, and canonical owner rather than symptom wording. Count recurrence only
when another observation demonstrates that same root inside the stated window; unknown history or an
elapsed-time, token, message, or task count alone remains unavailable rather than `systemic`.

Cost may include observed wait, rework, elapsed latency, repeated coordination, and exposed token or
context load. Preserve unavailable dimensions instead of estimating them as facts. QA owns this
reconstruction, clustering, classification, tracking, and acceptance evidence; the hub may deduplicate
and batch routed residuals, but the routed planner, orchestrator, executor, verifier, delivery, or
optimizer owns every repair.

## Observe RBM itself

Treat the following as self-QA candidates only when a concrete consequence and current evidence are
both present:

- **missed stage**: a required lifecycle boundary was skipped and a downstream decision now lacks its
  admitted input;
- **wrong triggering**: a conditional policy or lane ran without its predicate, or a relevant signal
  was ignored and changed the route;
- **blocking churn**: unchanged evidence repeatedly freezes or retries the same boundary without a
  new observation capable of changing the result;
- **coordination churn**: one causal root repeatedly invalidates work through low-information
  Hub↔child messages, duplicate commands, or stale status requests without changing an admitted
  relation, component, candidate, release predicate, authority, effect barrier, or terminal judgment;
- **Hub execution ownership breach**: in an admitted multi-Mission boundary, exact command or diff
  evidence shows the Hub produced a child-owned candidate or executed a dispatchable implementation or
  verification leaf, and the bypass caused lost routing, stale work, an unauthorized effect, or a
  missing lifecycle input;
- **dispatch persistence or projection defect**: an independently valuable diagnosis lacks a same-turn
  node/deduplicated/rejected disposition, or a fresh child receives only a summary, prefix, truncated
  locator, hidden setup, prose-only byte edge, or later supplement and therefore cannot admit its first
  legal action after interruption or compaction;
- **functional task loss or identity collision**: a waiting task's observed release predicate does not
  make it runnable until a user reminder, or one causal collision projection yields multiple native
  attempts/tasks and the Hub neither maps to the existing identity nor fails closed before create;
- **conflict arbitration bypass**: overlapping candidates or contradictory evaluator/direct-consumer
  evidence are selected by status, count, recency, or preference without Main reproducing the decisive
  consumer fact and recording accepted/rejected/superseded dispositions for the whole component;
- **support critical-path corrosion**: a support lane remains nonterminal after its one bounded
  convergence opportunity, repeats context or packet transfer, or delays the owning decision without
  returning decision-relevant evidence, and the Main fails to consume the admitted fallback or Stop;
- **patch loop**: the same causal root recurs, the candidate does not shrink, or local corrections
  keep moving the symptom instead of reopening Plan;
- **context or latency inflation**: unrelated policies, repeated evidence, reports, or extra lanes add
  load or critical-path delay without changing a decision;
- **skill behavior regression**: an immutable Origin/candidate comparison shows lost work, a changed
  route, weakened effect boundary, or other real-Mission behavior regression.

Message, command, file, diff, line, test, revision, token, elapsed-time, low-information traffic, or delay alone
never proves a signal. A single necessary checkpoint handoff, one candidate-local correction,
a Hub-owned admission, checkpoint, source-observation, or merge operation, a deliberately slow external gate, a
provider failure handled once by the admitted fallback, or a large but coherent Mission is
`no-signal` unless evidence shows the harmful relation above. Correctly suppressing duplicate
authorization or declining an unadmitted proposal is also `no-signal`.

For a candidate that changes this policy or another instruction/judge, bind immutable Origin and
candidate evidence and require a fresh independent audit. The changed policy cannot certify itself.

Capture a concrete self-QA signal online at the boundary where it appears, or through task dispatch's
spare-capacity retrospective lane when that route is independently admitted. Deduplicate both paths
by causal fingerprint. Do not open one task per issue. Batch only residuals that share a demonstrated
root and compatible owner, dependency, and acceptance boundary; keep incidental signals with their
evidence and route them without manufacturing a systemic program.

After the repair owner closes a signal, rerun the same scenario that demonstrated it and retain the
result in the next applicable terminal receipt. Later observations decide recurrence; a one-time pass
does not prove a zero recurrence rate. A stable generic case may be proposed to a separately governed
cross-version Skill evaluation repository, but this policy creates no golden-case file, eval harness,
or model-cost store in the current repository.

## Route degradation without taking over repairs

Route a current candidate-local defect to planner, orchestrator, executor, verifier, or delivery and
let that owner re-enter the earliest affected lifecycle boundary. Route a repeated or integrated
systemic cause to optimizer with
[architecture sensor evidence](../optimization/optimization-architecture-assessment.md) only when its
loading predicate holds. Do not create a new task, playbook, hook, scheduler, test framework, or
remediation mechanism from a QA signal.

Use these external sources only for the stated practice premises; local Mission authority decides the
actual classification and route:

- [ISTQB CTFL 4.0.1](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf): test early without neglecting later lifecycle testing and use a whole-team approach.
- [OWASP secure development integration](https://devguide.owasp.org/en/02-foundations/02-secure-development/): integrate assurance actions into the existing lifecycle instead of creating a separate one.
- [NIST SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final): integrate practices across an SDLC, retain evidence, and address root causes to prevent recurrence.
- [GitHub required-check guidance](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks): bind required checks to the latest relevant commit.
- [Google SRE postmortems and toil](https://sre.google/sre-book/postmortem-culture/): distinguish root-cause learning from repetitive work with no enduring value.
- [DORA loosely coupled teams](https://dora.dev/capabilities/loosely-coupled-teams/): avoid fine-grained cross-team coordination when an owner can complete work independently.
