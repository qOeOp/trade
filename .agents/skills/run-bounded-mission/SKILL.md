---
name: run-bounded-mission
description: "Run a compact Frame, Plan, Execute, Verify, Finalize workflow. Use only when the user affirmatively invokes the exact token $run-bounded-mission, clearly asks to use or run the bounded mission workflow, repository instructions require it for non-trivial implementation or delivery, or a later commit, push, pull-request, or merge turn continues a candidate produced under this workflow. Quoting, naming, linking, inspecting, auditing, explaining, diagnosing, or negating the token, skill name, or path is not invocation. Without one of those positive entries, do not use it for answer-only work, mechanical edits, routine status, task management, or internal subtasks. An affirmative explicit invocation wins over otherwise excluded request types, including when appended to the request."
---

# Run Bounded Mission

Use one lightweight lifecycle:

```text
Frame → Plan → Execute → Verify → Finalize
```

The stages are reasoning boundaries, not repository state. Do not create lifecycle ledgers,
identities, marker files, coordinators, or helper code unless the requested product behavior needs
them.

The main agent owns the Frame, Plan admission, candidate, evidence judgment, effects, and final route.

The frontmatter description is the single owner for entry classification. This body defines behavior
after entry and does not broaden discovery, loading, or workflow-start conditions.

## Frame

Before mutation, state only what changes a decision:

- outcome and real consumer;
- included scope and explicit non-goals;
- permitted effects, especially commit, push, PR, deployment, scheduling, secrets, or live writes;
- falsifiable acceptance evidence;
- current Git origin and a practical stop condition.

Treat these fields as the current Frame. Change a material field explicitly before continuing; do
not silently widen scope, authority, acceptance, or the stop condition.

Prefer no change, deletion, direct reuse, or a narrower behavior when it closes the outcome. Treat a
requested mechanism as a proposal when repository evidence shows that it is broader or harmful.
Repository history and external prior art are optional evidence: inspect them only when they can
materially change ownership, compatibility, or the implementation choice.
When bounded history for named paths can change the origin, no-change counterfactual, owner, scope,
removed invariant, or regression hypothesis, run
`python3 .agents/skills/run-bounded-mission/scripts/git-path-history.py --format json` with
repository-relative paths and a bounded revision, date, count, and file range. Use `--follow` only
for one path whose rename history matters; history never replaces current consumer evidence.

Identify a decision-changing domain premise only when an empirical, regulatory, market, or
mechanism claim could reverse the expected benefit, safe or legal scope, architecture, or acceptance
evidence. Bind the claim, its decision consequence, and supplied or repository evidence or exact
gap. User preferences, mechanical work, and repository authority without depending on current external truth do not activate domain research.

When an unresolved fact could change the candidate, consumer behavior, authority, acceptance, or a
hard-to-reverse choice, load [consequential ambiguity](references/plan-ambiguity.md).

Keep independent outcomes separate and never turn an internal subtask into a user-visible task. Load
[Codex task dispatch](references/task-dispatch.md) only when the user asks to route or create an
independent outcome, or when Mission evidence supports a separately valuable follow-up proposal with
its own consumer and acceptance. A proposal is not creation; native creation still requires the
user's explicit request or approval of the ready proposal.

### Session mode selector

After Frame, select the smallest mode:

- With no independent Mission, handle the request directly.
- With one, run it in the current session unless the requested outcome is separate task creation or
  routing; that explicit effect follows task dispatch.
- With two or more, use the loaded dispatch reference and keep one minimal session-only graph. Admit
  only outcomes with their own consumer, falsifiable Acceptance, owner and write surface, delivery
  boundary, and independent acceptance, block, or cancellation. Diagnosis, tests, documentation
  synchronization, review corrections, coupled producer/consumer work, and support roles stay
  internal.

In multi-Mission mode the current session alone owns admission, direct `after` edges, conflict
serialization, source-tip observation, bounded monitoring, and one exact-head merge release.
Children own their Frame, Plan, candidate, worktree, branch, pull request, and verification; their
packets withhold merge until released. Parallel ready nodes must be independent in owner, write
surface, contract, premise, and dependency. A merge invalidates only open children bound to the same
source ref; observe each affected tip again before another release or dependent child. This
authority stays in conversation prose and checkpoints and never authorizes a scheduler, durable
state, queue service, automatic retry or transfer, second CLI, background automation, or hidden
execution in the hub worktree.

## Session transition contract

The current stage is a reasoning position in this conversation, not durable workflow state. Do not
skip a stage or infer a transition from elapsed time, a new turn, or a tool result alone. Move
forward only on these observable conditions:

- `Frame → Plan`: every Frame field is explicit enough to make the next design decision, unresolved
  consequential ambiguity is resolved or isolated, and the practical Stop is finite;
- `Plan → Execute`: the owner, path, affected boundary, candidate shape, and verification route are
  admitted, the required-action inventory is complete, every entry is Plan-admissible, and no
  decision-changing premise remains unresolved;
- `Execute → Verify`: the admitted candidate is complete and its full mission-owned diff is
  available, including untracked candidate material, and every admitted pre-Verify gate has passed;
- `Verify → Finalize`: decisive passes, failures, and unavailable evidence have been recorded
  against the current candidate;
- `Finalize → accept`: acceptance is satisfied and bound to a recoverable diff or integrated commit.

All other continuation goes through one named Finalize route. `revise` returns to Execute only for a
candidate-local correction with the same admitted design and oracle. `replan` returns to Plan when
an admitted design field fails. `reframe` returns to Frame before any material change to outcome,
consumer, scope, non-goals, authority, acceptance, origin, or Stop. Freeze mutation and external
effects before taking any backward route. `blocked` ends the current run when a required input is
unavailable or the next operation would cross Stop; it is not a weaker form of acceptance.
When a backward or blocked condition is observed in Plan, Execute, or Verify, freeze work, enter the
Finalize reasoning boundary with that evidence, and then take exactly one route. A cancellation
override may instead terminate directly from any nonterminal stage after effects are frozen.

### Finite Stop and convergence

Frame must select an observable finite Stop. Unless the user supplies another explicit finite
envelope, use all of these defaults for the current Mission:

- at most two distinct evidence attempts for the same unresolved Frame, Plan, or Verify question;
- at most two total backward routes after the first `Plan → Execute`, counting `revise`, `replan`,
  and `reframe` together;
- no repeat of an unchanged failed investigation, check, candidate, or external request;
- at most one replacement candidate for each admitted replan, as governed by revision pressure.

An attempt or backward route is consumed when its work begins, even if it is interrupted or fails.
A retry is legal only after naming the changed candidate, input, environment, authority, or evidence
source and the observation that could now disconfirm the failure. Plan investigation converges by
admitting the unresolved field or classifying the dependent decision `blocked`; Verify converges by
accepting changed evidence or selecting one backward route; revision pressure converges by promoting
one admitted replacement or stopping. A new turn, context compaction, branch, checkout, task, or
smaller apparent diff does not reset consumed Stop. When the next operation would exceed the
envelope, freeze the candidate and route `blocked`. Only an explicit user-approved finite Stop
change may continue, and that change requires `reframe` before new work.

### Override and recovery

A user override freezes the next mutation and every unissued external effect. Plain cancellation
ends the Mission with its existing candidate preserved when one exists. When the user explicitly
requests discard or revert, that request authorizes cleanup only of the exactly identified
mission-owned diff after comparing the working tree and preserving unrelated work; then terminate.
A materially changed Frame uses `reframe`; an unrelated outcome remains a separate request and must
not be mixed into this Mission. Scope expansion always requires `reframe` and a newly admitted Plan
before execution. New authority never applies retroactively to an operation already stopped or
rejected.

After context compaction or on a later turn, continue only when the same Mission can be reconstructed
from conversation and Git evidence. When that is not otherwise unambiguous, retain or reproduce this
minimal, copyable current-Mission evidence locator in conversation prose:

```text
Current Mission evidence
Frame: <current outcome, consumer, scope/non-goals, authority, acceptance, origin, Stop>
Plan: <admitted owner, path, boundary, candidate shape, verification route; complete required-action
inventory and each admitted binding or later-stage gate>
Candidate/effects: <exact commit or complete diff locator; effects already performed>
Evidence: <decisive checks and remaining blocker>
Position: <current stage or terminal route; consumed Stop and next legal operation>
Resume: <stage to re-enter after a named blocker is removed, or none>
```

This locator is evidence, not an identity, receipt, file, ledger, or host state. Match the Frame, the
complete admitted Plan including its action inventory, bindings, and later-stage gates, origin,
candidate/effects, consumed Stop, next legal operation, and any resumable stage before continuing.
Do not assume that prior Plan admission still holds when any of those Plan facts is missing or
changed. If any field cannot be recovered exactly enough to exclude a different Mission, Plan
admission, or candidate, freeze before the next mutation or external effect and route `blocked` or
ask for the missing user-owned fact. Resuming an exactly recovered `blocked` Mission re-enters its
explicit `Resume` stage only after the named blocker is removed, without resetting Stop.
Multi-Mission recovery additionally follows the session graph contract; this locator does not
replace it.

## Plan

Inspect the current owner, production entry point when one exists, affected contracts, tests, and
working-tree state. Choose the smallest vertical change that closes the outcome.
Plan is read-only. Admit the owner, path, affected boundary, candidate shape, and verification route
before mutation; when any of them remains unresolved, keep investigating or return to Frame.

Before `Plan → Execute`, the main agent independently derives the complete required-action inventory
from all admitted implementation, verification, delivery, and support needs. An omitted required
action makes the inventory incomplete; proposed bindings do not prove completeness. Each entry is
Plan-admissible only when it records a named executor, exact effect, effect authority, required
context, and either evidence of capability observable during Plan or an explicit later-stage gate
for a predicate that can only be judged against the completed candidate. A later-stage gate must
name executable owners for producing the exact candidate, running the gate, and taking its failure
route; it is not permission to defer an otherwise observable executability gap. Do not require a
candidate locator or completed-candidate fact during Plan. Assign actions to the main agent when it
can legally execute them; do not invent or require a subagent.

For an evaluator action, Plan records only the prospective inspection, its required isolation and
capability predicates, and a candidate-bound gate before Verify launch. The main agent owns candidate
creation, copying, packaging, and evaluator dispatch; the evaluator only read-only inspects the
admitted exact candidate and never creates, copies, writes, packages, or dispatches it. After Execute
and before Verify launch, validate actual evaluator capability and same-exact-candidate binding. Do
not enter Verify until every admitted pre-Verify gate passes; a failed or unavailable gate freezes
work, enters Finalize, and takes its admitted failure route. If independent acceptance is frozen and
its evaluator route is observably unavailable during Plan, record `evidence_unavailable`, freeze
work, enter Finalize, and route `blocked`. If the endpoint authorizes local preparation, admit
executable local actions and make unavailable independent review a delivery limitation; Finalize
must report `prepared and locally verified, independent acceptance unavailable` rather than
blocking candidate creation or claiming acceptance.

When a test failure can change the candidate, an escaped defect shows that tests missed required
behavior, or the Mission may restructure tests, load
[test effectiveness governance](references/test-effectiveness-governance.md) before mutation.

Resolve an activated domain premise before solution architecture, prior-art, or reuse research.
Inspect repository authority and supplied evidence first. Activation does not mandate web search, a domain specialist, or proof of a universal claim; it requires enough evidence to classify the
decision-changing premise. A user-named implementation never bypasses this classification. Bind the classification and decisive evidence to the existing Decision:

- `supported`: continue with the bounded implementation;
- `testable_hypothesis`: validate before dependent implementation;
- `contradicted`: reject or reframe before solution search;
- `unknown`: block only the decision that depends on it.

| Replay | Expected disposition |
| --- | --- |
| D1: supplied evidence contradicts the benefit premise | `contradicted-reject-before-solution-search` |
| D2: the premise is decision-changing and cheaply testable | `testable-hypothesis-validation-first` |
| D3: the request is mechanical or governed by stable repository authority | `not-applicable-no-domain-research` |
| D4: decisive evidence is unavailable | `unknown-block-dependent-decision` |

The named-approach exemption applies only to reusable-candidate discovery after domain premise
classification. When external reuse evidence can change the owner or path, load
[decision-relevant prior art](references/plan-prior-art.md). Resolve reuse before new implementation:

- Reuse an existing owner before adding responsibility.
- Do not add abstractions, compatibility paths, agents, scripts, or state without a current consumer.
- Put every evidenced dependent boundary into the change or verification set; do not expand through
  hypothetical dependencies.
- Separate instruction, workflow, judge, ruleset, or signing-policy changes from ordinary
  implementation candidates.
- Use read-only support only for a concrete unresolved question whose answer can change the plan.
  When support is needed, load
  [read-only support service levels](references/support-lanes.md) for its admission and handoff
  boundary.

Fast, standard, and high-assurance are service levels for activated read-only support, not standing
teams or required stages.

Load [viable alternatives](references/plan-alternatives.md) only when materially different credible
paths remain. Load [independently falsifiable slices](references/plan-slices.md) only when the route
needs separable candidate shapes or stopping evidence.

Plan in ordinary prose. Content hashes and formal Frame or Plan identities are not required. A
researcher or planner packet locates the current Frame or Plan by quoting the relevant prose or
naming where it was supplied. Only an evaluator exact-match needs stronger binding: repeat the
frozen Frame prose and admitted Plan prose, then identify the candidate by an exact commit or by a
complete diff against a named origin, including untracked candidate material. These are evidence
locators, not lifecycle identities or persisted state.

## Execute

Implement only the admitted change. Keep one writer for overlapping files and preserve unrelated
user work. The candidate is the mission-owned diff, not every staged, unstaged, or untracked file in
the checkout.

Do not perform commit, push, PR, merge, deployment, scheduling, live writes, or other shared-state
effects without authority for that effect.

Route a finding to `revise` only when the admitted owner, path, affected boundary, responsibility
shape, and acceptance oracle still hold. Return to Plan for `replan` when any of those design fields
fails or the next correction would add an unadmitted branch, exception, adapter, fallback, owner, or
boundary. Return to Frame for `reframe` when a Frame field must materially change. When a finding
recurs against the design or another correction would grow the candidate outside the Plan, load
[revision-pressure replan](references/revision-pressure-replan.md) before further mutation.

## Verify

Verify the exact mission-owned diff in proportion to risk:

1. exercise the real consumer when the change claims user or runtime behavior;
2. run the smallest authoritative owner and boundary regressions;
3. inspect the complete mission-owned diff and `git diff --check`;
4. confirm checks did not create unintended workspace changes;
5. report unavailable or failed evidence when it changes confidence.

Documents, static checks, and unit tests support a behavior claim but do not replace a relevant real
consumer. Conversely, do not change correct production behavior merely to satisfy a test that
contradicts a higher-authority current contract.

A candidate change invalidates only evidence affected by that change. Reuse read-only discovery and
unaffected checks when their inputs remain identical.

Use [architecture sensor evidence](references/architecture-sensor.md) only for material structural
change, cross-owner effects, or persistent patch pressure.

Instruction and judge changes require review that does not rely on the changed rule to approve
itself. When an independent evaluator predicate activates, load
[the Verify reviewer packet](references/reviewer-handoff.md) before dispatch. If the host cannot
prove the admitted read-only, candidate-external, no-delegation, and no-lateral-communication
boundaries through that packet's fail-closed preflight, do not launch the evaluator. The local
candidate may still be prepared and verified when the authorized endpoint allows that result, but
Finalize must call it `prepared and locally verified, independent acceptance unavailable`; it must
not represent the candidate as independently accepted or remotely delivered.

## Finalize

Choose one evidence-backed route: `accept`, `revise`, `replan`, `reframe`, or `blocked`. `revise`
returns to Execute, `replan` returns to Plan, and `reframe` returns to Frame. Use `blocked` only when
required authority, evidence, capability, independence, or stop alignment is unavailable; do not
weaken acceptance to manufacture `accept`.

Lead with the user-visible result and exact effect state. Summarize changed paths, decisive checks,
and material limits. Do not emit lifecycle receipts, internal identities, generic follow-up work, or
a mandatory closing template.

Treat a completed outcome as `accept` only when the verified candidate and decisive evidence are
recoverably bound to its integrated commit or preserved local diff. This is an evidence handoff, not
a lifecycle ledger.

For local-only work, leave the verified diff recoverable and do not commit or publish it. For an
authorized remote endpoint, publish only the verified candidate and observe the resulting state.
Treat later authority to commit, push, open a pull request, or merge the preserved candidate as the
same Mission's Finalize; reload this skill instead of replacing its delivery barriers with a generic
publication workflow.
When the endpoint includes a GitHub pull request, load
[GitHub delivery](references/github-pr-handoff.md) before publication or merge.
After two or more related Missions are accepted and integrated into the current canonical source
tip, load [Refactor Mission proposals](references/refactor-mission-proposal.md) only when that
integrated head contains concrete structural evidence. Acceptance count alone is investigation
eligibility, not proposal justification. Any justified refactor is a new proposal requiring user
approval; the old graph does not authorize it.
Use `No action needed` only when the user explicitly chose the completed local-only endpoint or when
delivery is complete and no preserved candidate awaits a user-owned delivery decision; for an implicit `local-only` stop with meaningful uncommitted or unpublished changes, use `Optional next step` and name the concrete available continuation, such as review, commit, pull request, or deployment authorization.

## Agent boundary

The main agent owns scope, implementation, evidence judgment, and final delivery. A subagent receives
one bounded question or non-overlapping file ownership, preserves other work, and cannot authorize
external effects. Mission role definitions are self-contained host startup packets, not lifecycle
authority; their returns are evidence or proposals for the main agent, never Plan admission,
candidate acceptance, or Finalize. A researcher activates only for unresolved decision-changing current or external
evidence, a planner only for an evidenced design dispute or structural choice, and an evaluator only
for an admitted candidate risk lens with exact bindings and enforceable isolation. Missing fields,
authority overreach, or unavailable isolation return to the main agent without another lane. Agent
count and revision count are never goals.
