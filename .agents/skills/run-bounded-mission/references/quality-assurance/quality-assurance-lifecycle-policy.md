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

## Keep an Assurance Trace, not a ledger

Reconstruct only the relationship needed for the active signal from current owners:

```text
obligation or claim → authority locator → candidate locus or snapshot → evidence locator and result
                    → signal outcome → responsible owner
```

Use existing Frame/Plan projections, Git objects and diffs, task items, check runs, review artifacts,
and delivery receipts as locators. Do not create a report, database, registry, persistent trace file,
or second status model. Retain only the decisive relation in the existing checkpoint, finding,
reviewer packet, or Finalize evidence. When there is `no-signal`, retain nothing and impose no
ordinary-path context cost.

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
- **patch loop**: the same causal root recurs, the candidate does not shrink, or local corrections
  keep moving the symptom instead of reopening Plan;
- **context or latency inflation**: unrelated policies, repeated evidence, reports, or extra lanes add
  load or critical-path delay without changing a decision;
- **skill behavior regression**: an immutable Origin/candidate comparison shows lost work, a changed
  route, weakened effect boundary, or other real-Mission behavior regression.

Message, file, line, test, revision, token, elapsed-time, low-information traffic, or delay alone
never proves a signal. A single necessary checkpoint handoff, one candidate-local correction,
a deliberately slow external gate, a
provider failure handled once by the admitted fallback, or a large but coherent Mission is
`no-signal` unless evidence shows the harmful relation above. Correctly suppressing duplicate
authorization or declining an unadmitted proposal is also `no-signal`.

For a candidate that changes this policy or another instruction/judge, bind immutable Origin and
candidate evidence and require a fresh independent audit. The changed policy cannot certify itself.

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
