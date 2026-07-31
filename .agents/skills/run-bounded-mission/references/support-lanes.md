# Select Read-only Support Service Levels

Use this reference only after the main agent observes a decision gap whose evidence work may be
delegated read-only. A service level selects the minimum safe invocation strength; it is not a
lifecycle, role, model family, agent roster, queue, or authority transfer.

## Admit the lowest sufficient level

| Level | Admit when | Typical capability |
| --- | --- | --- |
| `fast` | Every fast gate below is observable and the result is cheap for the main agent to verify | bounded repository explorer or deterministic read-only query |
| `standard` | The question remains read-only but needs broader repository synthesis, an unknown candidate set, multiple sources, or ambiguity resolution | explorer, researcher, or planner selected by the existing Plan predicate |
| `high-assurance` | The question directly serves as an acceptance oracle or trust boundary, conflicts remain material, the candidate controls an oracle, or independent evaluation is required | isolated evaluator or another existing high-assurance read-only capability |

Admit `fast` only when all conditions hold:

1. the packet asks one narrow, unambiguous decision question;
2. authority is read-only and every input or source is named;
3. the expected return is compact, bounded, and directly checkable;
4. an error cannot authorize a write, external effect, candidate acceptance, or lifecycle decision;
5. one short branch Stop is enough; and
6. the result can change exactly one identified main-agent decision.

Refuse `fast` for user preference or authority, Frame freezing, Plan admission, candidate writing or
integration, cross-owner architecture trade-offs, conflict adjudication, security or trust-surface
judgment, Finalize, final independent acceptance, or a high-consequence conclusion the main agent
cannot cheaply verify. Low invocation strength never means a lower evidence-quality bar.

Use no support when no real decision gap remains. Eligibility alone does not justify dispatch:
expected context or latency saved must clearly exceed packet construction, launch, verification, and
merge cost.

## Dispatch and return evidence

Give each dispatch only one decision question, bounded scope, read-only authority, exact inputs or
sources, a compact expected return, a cheap validation method, one branch Stop, and observable
escalation conditions. Project these semantics into the host's existing packet fields; do not
require a universal serialized record.

Require a compact evidence packet that binds the original question and service level to a bounded
factual answer, exact locators and minimal observations, the cheapest validation, conflicts or
limits, and why the branch stopped. It must state whether the evidence is sufficient, requires
escalation, or is unavailable, without imposing a shared status enum or schema.

The packet is evidence, not deliberation. It cannot freeze Frame, admit Plan, select or modify the
candidate, authorize effects, judge acceptance, or sign Finalize. The main agent verifies the packet,
owns every synthesis, and remains responsible for the resulting decision.

## Escalate without lane loops

Return `escalate` when a fast result is ambiguous, conflicts with admitted evidence, spills beyond
scope, lacks a required source, or approaches its branch Stop without a checkable answer. Do not
retry fast, append protective fast queries, or generate sibling lanes around the uncertainty.

Promote that same decision question once to `standard` with the unresolved evidence and a new bounded
Stop. Preserve Origin, Frame, Authority, and consumed Stop; promotion does not widen the question or
reset lifecycle evidence. Before Plan admission, high-assurance remains read-only support through an
existing host capability; if the risk requires
[reviewer-handoff bindings](reviewer-handoff.md), return control to the main Plan and do not launch an
evaluator until an admitted Plan and candidate exist. After those bindings exist, launch at most the
admitted independent evaluator for that lens. A fresh agent sharing a candidate-controlled checkout
does not provide that isolation. Unavailable independence or authority routes through the main
Mission rather than another support loop.

## Parallelize only independent evidence

Launch lanes concurrently only when their questions, required inputs, and outputs are mutually
independent and non-overlapping, neither consumes the other's result, and merge cost is lower than
the expected elapsed-time or context saving. Give each lane its own packet and branch Stop.

Keep a dependency sequential. Do not pre-generate the dependent packet before its input exists,
disguise a sequence as parallel work, fill host capacity, or let lanes communicate laterally.
The main agent is the only integrator.

## Keep stage and host boundaries

| Mission area | Fast support fit |
| --- | --- |
| Frame | Do not delegate user intent, authority, Frame freezing, or the no-change judgment; retain existing bounded discovery only when it is independently justified |
| Plan | Preferred: independent repository facts and deterministic queries that change one path, owner, boundary, or reuse decision |
| Execute | No writing or integration; route a newly discovered design question back through the main agent |
| Verify | Preferred: independent factual checks; final acceptance and candidate-controlled oracles remain high-assurance |
| Finalize | None; the main agent alone selects and reports the route |

A host may project a service level only through an existing capability or adapter. Select the lowest
available configuration that preserves the packet's read-only tools, required source access, output
contract, Stop, and any isolation predicate. Do not hard-code model names, promise unsupported
reasoning controls, or infer safety from a label. If the host cannot satisfy the minimum, use a safer
available level or keep the work in the main context.

## Replay scenarios

| ID | Fixed scenario | Expected disposition |
| --- | --- | --- |
| S1 | Two non-overlapping file or symbol facts change one Plan decision, neither consumes the other, every fast gate holds, validation is cheap, and dispatch plus merge cost is lower than the expected saving | `fast-parallel` |
| S2 | One repository query has a deterministic, compact, directly checkable result | `fast-one-packet` |
| S3 | The second repository question requires the first result as input | `sequential-not-parallel` |
| S4 | Architecture alternatives, user authorization, security or trust judgment, or conflicting evidence must be decided | `refuse-fast` |
| S5 | A fast answer is incomplete or conflicts with admitted evidence | `standard-once-no-fast-retry` |
| S6 | No unresolved main-agent decision can change | `no-support` |
| S7 | A fast packet attempts to freeze Frame, admit Plan, modify a candidate, or sign Finalize | `evidence-only-reject-authority` |
| S8 | A governance, instruction, skill, agent-discovery, or judge candidate reaches Verify | `isolated-high-assurance-evaluator` |
