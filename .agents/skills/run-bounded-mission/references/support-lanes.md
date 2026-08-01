# Route Agent Lanes

Load this reference only when the main agent has one concrete evidence question, one frozen
non-overlapping build leaf, or at least two independent frozen-candidate risk questions. Agent lanes
are conditional work routes, not a lifecycle, standing team, vote, authority transfer, or acceptance
owner. Use no lane when launch, duplicated context, validation, and synthesis cost is not clearly
lower than doing the work in the main context.

The main agent always owns Frame, Plan admission, conflict judgment, the writable winner, evidence
synthesis, effects, acceptance, and Finalize. A lane returns evidence, a proposal, or a bounded leaf
diff; it cannot widen scope, authorize an effect, or choose a Mission route.

## Route reasoning and build work

| Work | Route | Admission boundary |
| --- | --- | --- |
| Frame, Plan admission, cross-owner or safety judgment, finding synthesis, Finalize | high-reasoning main agent | never delegate the decision |
| evidenced structural Plan challenge | high-reasoning `mission_planner` | proposal only; main agent admits or rejects it |
| ordinary implementation | main agent or one standard builder | frozen owner, path, boundary, candidate shape, and verification route |
| low-risk mechanical leaf | `GPT-5.3-Codex-Spark` only when the host exposes that exact capability | every Spark gate below holds |
| repository fact | fast explorer or deterministic read-only query | every fast evidence gate holds |
| broader repository, external-evidence, or design question | standard explorer, `mission_researcher`, or `mission_planner` by predicate | one decision-changing question |
| frozen-candidate advisory lens | ordinary read-only support agent | advisory trigger and packet below |
| independent candidate evidence | `mission_evaluator` | reviewer preflight proves trusted capability |

Use a standard builder for normal implementation after Plan freezes. Give it non-overlapping file
ownership and one candidate shape; keep one writable winner for overlapping files. It returns to the
main agent when the Plan, authority, owner, boundary, or oracle becomes ambiguous.

Use Spark only for a deterministic, low-risk leaf when all of these are frozen and supplied: owner,
exact paths, affected boundary, candidate shape, acceptance commands, and Stop. The leaf must have no
design branch and be cheap for the main agent to inspect. Spark never owns Frame, cross-owner Plan,
public contracts, schemas, dependency or concurrency changes, authentication, authorization,
security, instructions or judges, live effects, acceptance, or Finalize. Any ambiguity, path growth,
failed assumption, or unavailable exact model returns the same leaf to the main agent for standard
handling; do not approximate the route with a differently named fast model.

This model routing applies only to internal lanes whose host exposes the capability. Keep the host
default for a user-visible Codex task unless the user separately authorized that model override. A
route described here is not capability evidence: observe the exact internal-agent model surface at
dispatch time, and use standard handling when Spark is absent or unobservable.

## Route read-only evidence

Admit a fast lane only when its packet asks one narrow unambiguous question, names every input,
requires a compact directly checkable return, cannot authorize a write or acceptance on error, has
one short Stop, and can change exactly one main-agent decision. Refuse fast handling for user
authority, Frame or Plan ownership, candidate writing, cross-owner architecture, security or trust
judgment, conflict adjudication, or Finalize.

Use one standard lane when a broader read-only question remains:

- a repository explorer synthesizes named repository locators;
- `mission_researcher` gathers decision-changing current or external evidence;
- `mission_planner` compares supplied structural choices after its activation predicate holds.

Each dispatch supplies one question, bounded scope, read-only authority, exact sources, required
return, cheapest main-agent validation, one Stop, and escalation conditions. Require exact locators,
minimal observations, conflicts and limits, and a stop reason. The main agent reopens decisive
locators and verifies the result.

An incomplete, ambiguous, conflicting, or source-blocked fast result may return once for standard
classification. Preserve Frame, Origin, Authority, and consumed Stop; do not retry fast, surround the
gap with sibling lanes, or reset evidence. Keep dependent questions sequential. Parallelize only
mutually independent questions whose inputs and outputs do not overlap or consume one another.

## Run advisory candidate lenses

Advisory review finds reproducible leads; it is not independent acceptance. Activate it only after
the writer stops and the candidate is frozen as an exact commit, or as a named origin plus complete
diff and untracked manifest. Fan out only when at least two of these mutually exclusive root-cause
lenses each have an independent question that can change main-agent judgment:

1. `safety_authority`: permissions, secrets, untrusted input, live writes, or agent/tool authority;
2. `architecture_boundary`: owner, responsibility, dependency direction, state, concurrency, or
   cross-owner contract;
3. `performance_context`: measured hot path, scale, I/O, memory, payload, or token/context growth;
4. `correctness_consumer`: remaining observable behavior, error path, contract, real consumer, or
   regression oracle.

Assign a root cause to the first matching lens above; shared immutable candidate bindings may repeat,
but lens questions and evidence slices must not. Keep a dependency sequential. Use no fan-out for a
small or mechanical candidate, zero or one actual risk question, a changing candidate, an incomplete
locator, user-owned authority, writable reproduction, external effects, or a question whose answer
feeds another lens.

An ordinary advisory agent is only behaviorally read-only. A shared checkout, fresh prompt, or role
label does not prove isolation. When the candidate controls discovered instructions, skills, agents,
judges, or reviewer policy, record that contamination and treat the return only as an untrusted lead;
it cannot satisfy an independent-acceptance requirement.

Only after advisory activation and candidate freeze, load
`../assets/advisory-lens-packet.md`. Copy and fill its complete dispatch packet once per activated
lens, without transcript, builder advocacy, sibling output, hidden reasoning, or secrets, and
require the agent to copy and fill its complete fixed return shape. Do not load the asset for other
lane routes. This shapes model output; it is not deterministic schema validation.

The main agent first recomputes the candidate locator; a change makes every bound return stale. It
then validates the schema and lens, reopens decisive evidence, reproduces material claims, deduplicates
causal roots, and resolves conflicts by provenance and consumer impact rather than agent count.
`partial`, `unsupported`, `mismatched`, and `unverified` never mean pass. Only the main agent maps a
verified finding to the highest Mission boundary and chooses the route.

Measure coordination before fan-out from the actual serialized common packet, each lens delta,
expected return bound, and the dispatch, return, candidate-recheck, validation, and synthesis events.
Compare their observed characters, available tokenizer count, and event count with the same evidence
work in the main context. Use fewer lenses whenever expected elapsed-time or context saving does not
exceed that copied context and coordination cost. These measurements route support only; they never
decide acceptance, Stop, revision, or an agent-count budget.

## Keep independent acceptance fail-closed

An advisory lane never substitutes for `mission_evaluator`. When an admitted candidate risk lens
requires independent acceptance, load [the reviewer handoff](reviewer-handoff.md) and run its current
host preflight exactly once. Dispatch `mission_evaluator` only when trusted host evidence makes that
preflight exit `0` with `dispatch_allowed=true` and proves read-only authority, a non-builder context,
candidate-external instruction discovery, a complete read-only tool surface, no delegation, no
lateral communication, and exact Frame, Plan, candidate, and lens bindings.

Treat the reviewer-handoff preflight's observed output as the sole capability decision. When it
returns `unsupported`, do not replace that result with a prompt, role configuration, fresh agent,
alternate checkout, ordinary advisory lanes, or majority agreement. When the endpoint permits local
preparation, report `prepared and locally verified, independent acceptance unavailable`; otherwise
the required acceptance evidence remains unavailable.
