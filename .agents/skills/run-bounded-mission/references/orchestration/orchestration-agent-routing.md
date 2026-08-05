# Route Agent Lanes

Load this reference only when the main agent has one concrete evidence question, one frozen
non-overlapping build leaf, or at least two independent frozen-candidate risk questions. It is the
single common-protocol owner for researcher, planner, builder, and advisory lanes; their role TOMLs
contain startup deltas only. The independent evaluator instead loads its complete protocol from
`../verification/reviewer-handoff.md` after packet admission.

Every researcher, planner, builder, or advisory packet names an immutable Origin and this exact path.
The selected role loads these bytes from that Origin before acting and rejects missing, mutable,
candidate-controlled, or mismatched protocol. Do not copy this common protocol into role config or a
dispatch packet. Agent lanes are conditional work routes, not a lifecycle, standing team, vote,
authority transfer, or acceptance owner. Use no lane when launch, reference loading, duplicated
context, validation, and synthesis cost is not clearly lower than doing the work in main.

This reference owns the current role load map:

- `mission_planner` additionally loads `../planning/planning-decision-workflow.md`, and loads
  `../planning/planning-revision-workflow.md` only when revision pressure is its activation predicate;
- `mission_researcher` additionally loads `../planning/planning-decision-evidence.md`, and loads
  `../planning/planning-decision-workflow.md`
  only for `reuse/prior_art`;
- `fast_builder` needs no additional protocol reference.

A role delta first reads the immutable Origin's `orchestration-agent-routing.md` to select the protocol version. When
an older Origin does not declare this map, that selector plus the same Origin's same-name
`.codex/agents/<role>.toml` form the admitted legacy load set; the legacy TOML remains the sole role
protocol in that branch. Admit it only when its name, model, reasoning effort, and sandbox match the
current role and its instructions are neither a role delta nor another fallback; reject any mismatch
or missing or mutable file. This is a version-compatibility load condition, not a second current
authority. Never substitute candidate bytes for either branch or claim that selecting the legacy
branch loaded only the TOML.

The main agent always owns Frame, Plan admission, conflict judgment, the writable winner, evidence
synthesis, effects, acceptance, and Finalize. A lane returns evidence, a proposal, or a bounded leaf
diff; it cannot widen scope, authorize an effect, or choose a Mission route.

Classify the work before selecting a route. Model names configure existing roles; they do not define
the work class or transfer its owner.

## Route reasoning and build work

| Work | Route | Admission boundary |
| --- | --- | --- |
| Frame, Plan admission, cross-owner or safety judgment, finding synthesis, Finalize | high-reasoning main agent | never delegate the decision |
| evidenced structural Plan challenge | high-reasoning `mission_planner` | proposal only; main agent admits or rejects it |
| ordinary implementation | main agent or one standard builder | frozen owner, path, boundary, candidate shape, and verification route |
| low-risk mechanical leaf | custom `fast_builder` on exact `gpt-5.3-codex-spark` | every Spark gate below holds |
| deterministic repository or environment fact | existing helper or direct read-only command; no agent or model | exact inputs and directly checkable output |
| bounded repository synthesis | fast explorer | every fast evidence gate holds |
| bounded current or external evidence | `mission_researcher` | one decision-changing external question |
| frozen-candidate advisory lens | ordinary read-only support agent | advisory trigger and packet below |
| independent candidate audit | one `mission_evaluator`, or the reviewer packet's risk-triggered complementary pair | fresh non-builder context, origin-bound policy, exact candidate, and integrity gates; one set-wide generic fallback only after explicit terminal transport or capability failure |

The role files own their pinned model and reasoning settings. For an unpinned internal route, treat
the selected model as host-discretionary and do not promise an exact model without observing it.
User-visible Mission model authority remains with task dispatch.

Use one standard builder for normal implementation after Plan freezes. Give it non-overlapping paths
and one candidate shape; ambiguity in Plan, authority, owner, boundary, or oracle returns to main.

Use the repository's `.codex/agents/fast-builder.toml` only for a deterministic low-risk leaf whose
packet freezes owner, exact paths, affected boundary, candidate shape, acceptance commands, and Stop.
It must have one writer, no design branch, and be cheap for main to inspect. For a revision leaf, the
main agent must first reproduce the material finding, classify it as candidate-local, confirm the
admitted owner, path, boundary, and oracle are unchanged, and freeze the correction semantics and
shape. No safety, authority, secrets, schema, public-contract, dependency, concurrency,
authentication, live, or external-effect decision may remain.

Before dispatch, compare the expected mechanical execution saved with the serialized packet, spawn,
candidate recheck, and main diff inspection. Delegate only when the saving is greater; a directly
obvious one- or two-line patch stays in main. Neither the existence nor count of revisions activates
the lane. Spark never interprets or chooses instruction or judge semantics or wording. It may apply
changes to those files only when the main packet supplies exact replacement bytes, retains the
independent Origin-bound evaluator, and still clears the efficiency gate; otherwise main applies them.

This is an internal custom sub-agent, not a user-visible task per build or revision. At dispatch,
observe that the host exposes the custom role and its exact model; the TOML or this prose alone is not
runtime proof. Spark has no authority to branch, commit, push, open or merge a pull request, comment,
review, resolve a thread, deploy, schedule, perform a live write, alter a queue or automation, accept,
Finalize, or cause any other external/shared-state effect. Ambiguity, path growth, a failed premise,
or unavailable exact model returns once to standard main handling; never use another fast model or
retry the fast lane. Candidate mutation invalidates only affected evidence. A separately approved
user-visible Mission uses task dispatch's `create_thread` route and model-consent contract. Static
configuration and role observation are not positive dynamic proof: leave it unproved until the next
genuine qualifying leaf.

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

A planner or researcher must not inspect live agent, thread, lifecycle, transcript, or task state;
consume live or unadmitted sibling output; communicate laterally with sibling agents; delegate; or
trigger an external write or effect. Only completed briefs sanitized and supplied by the main agent
are admitted packet evidence.

### Mission planner delta

Use `mission_planner` only for an evidenced harmful or unjustified mechanism, revision-pressure
incumbent, materially different credible paths, or consequential cross-owner trade-off. Supply the
complete current Frame locator, immutable repository evidence, activation predicate, completed briefs,
one decision question, required return, and branch Stop. It does not search or inspect live task state.

Require exactly one result: `not_triggered`, `evidence_unavailable`, `needs_user_alignment`,
`frame_mismatch`, `mechanism_rejected`, or `ready_for_plan_admission`. A ready proposal names the
selected owner and smallest vertical candidate; affected surfaces and exercises; responsibility
added, retained, and deleted; compatible boundary evidence; structural kill conditions; coherent
slices; required support lanes; real-consumer/regression verification; and delivery prerequisites.
For every nontrivial action outside ordinary main capability it also names execution owner, exact
effect and authority, and observed capability or a later owned fail-closed gate. It treats endpoint
and authorized effects as Frame inputs and never infers publication, review, merge, or deployment
authority.

Return `not_triggered` when the supplied activation predicate is absent. Treat completed briefs as
claims and use only their decisive locators, conflicts, negative evidence, and unavailable facts; do
not repeat their research. Classify every remaining decision-changing gap as evidence-owned or user-
owned. A user-owned preference or authority choice returns `needs_user_alignment` with one smallest
separating question. Missing required evidence returns `evidence_unavailable` with the blocked decision
and exact missing evidence. No executable path that preserves every Frame field returns
`frame_mismatch` with the smallest demonstrated reframe reason. Decisive evidence that rejects the
requested mechanism while a narrower path preserves the Frame returns `mechanism_rejected` with the
refused mechanism, decisive evidence, preserved outcome, smallest substitute, and its admission packet.

When the main packet supplies an independent-audit predicate, a planner may return only a non-
dispatchable template that names the main-selected single or complementary-pair mode, Frame locator,
one lens per evaluator, planned fresh launch context, immutable instruction origin, discovery boundary,
integrity evidence, and failure branch. After Plan admission and candidate freeze, main alone inserts
the exact complete Plan, freezes lens bytes, invokes the reviewer packet helper, and dispatches. An
unavailable required evaluator is `evidence_unavailable`, not permission to weaken delivery.

An incomplete, ambiguous, conflicting, or source-blocked fast result may return once for standard
classification. Preserve Frame, Origin, Authority, and consumed Stop; do not retry fast, surround the
gap with sibling lanes, or reset evidence. Keep dependent questions sequential. Parallelize only
mutually independent questions whose inputs and outputs do not overlap or consume one another.

## Run independent audit lenses

Use [the reviewer handoff](../verification/reviewer-handoff.md) for every independent audit. It alone selects the
single or risk-triggered complementary-pair route and owns complete Frame and Plan rebinding, result
classification, fallback, and integrity gates. When it selects a pair, dispatch both one-lens
`mission_evaluator` instances concurrently from the same frozen binding and immutable,
content-addressed common packet core whose ordered manifest binds every exact lens delta;
neither may consume sibling output. Fan in once for main-agent reproduction and arbitration.

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
it cannot satisfy an independent-audit requirement.

Only after advisory activation and candidate freeze, load
`../../assets/verification-advisory-template.md`. Copy and fill its complete dispatch packet once per activated
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

## Keep independent audit evidence fail-closed

An advisory lane never substitutes for the reviewer handoff, and no evaluator becomes a vote. Apply
that owner's endpoint restriction when any required current lens is invalid or unavailable. Generic
fallback evidence is integrity-checked, not sandbox-enforced.
