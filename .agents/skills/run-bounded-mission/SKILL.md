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
- current Git origin and a practical Stop predicate tied to concrete authority, evidence,
  capability, candidate convergence, boundary growth, or repeated-root-cause evidence.

Treat these fields as the current Frame. Change a material field explicitly before continuing; do
not silently widen scope, authority, acceptance, or the stop condition.

Prefer no change, deletion, direct reuse, or a narrower behavior when it closes the outcome. These
are solution-selection principles, not acceptance or routing oracles. Treat a requested mechanism
as a proposal when repository evidence shows that it is broader or harmful.

Line count, file count, diffstat, step count, agent count, and revision count are diagnostic or
supporting evidence only. Unless the user explicitly defines one as the observable Outcome, none may
decide Plan admission, Stop, `accept`, `revise`, `replan`, `reframe`, or `blocked`; reject the same
metric substitution when it appears in a child or task packet. Even an explicit compression request
cannot trade away required behavior, a real consumer exercise, dynamic verification, readability,
or owner and boundary closure. Judge minimality by removing unconsumed owners, duplicate authority,
state, branches, adapters, exceptions, indirection, and superseded paths—not by the sign of a net
diff.
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
[Codex task dispatch](references/task-dispatch.md) for separate task creation, an existing child, a
separately valuable follow-up, or multi-Mission operation. A proposal is not creation; native task
creation still requires the user's explicit request or approval of the ready proposal.

### Session mode

At workflow entry, a new turn, compaction recovery, or a resumed hub checkpoint, call `get_goal`
before selecting a Goal-bound mode or issuing a Goal-driven effect. Use the smallest mode:

- With zero independent Missions, handle the request directly and leave Goal state untouched.
- With one, use the current thread unless separate routing was explicitly requested. It participates
  in a Goal only with explicit Goal authority and a matching overall Outcome.
- With two or more, require a matching active overall Goal and load task dispatch from its link in
  Frame before any Goal-driven effect.

Diagnosis, tests, documentation sync, review corrections, coupled work, and support roles remain
internal. A missing, completed, paused, blocked, or nonmatching Goal freezes multi-Mission effects
until task dispatch reconciles it; never infer create, update, replacement, or resume authority.

## Session transition contract

The current stage is a reasoning position in this conversation, not durable workflow state. Do not
skip a stage or infer a transition from elapsed time, a new turn, or a tool result alone. Move
forward only on these observable conditions:

- `Frame → Plan`: every Frame field is explicit enough to make the next design decision, unresolved
  consequential ambiguity is resolved or isolated, and the practical Stop is finite;
- `Plan → Execute`: the owner, path, affected boundary, candidate shape, and verification route are
  admitted and no decision-changing premise remains unresolved;
- `Execute → Verify`: the admitted candidate is complete and its full mission-owned diff is
  available, including untracked candidate material;
- `Verify → Finalize`: decisive passes, failures, and unavailable evidence have been recorded
  against the current candidate;
- `Finalize → accept`: acceptance is satisfied and bound to a recoverable diff or integrated commit.

All other continuation goes through one named Finalize route. `revise` returns to Execute only for a
candidate-local correction with the same admitted design and oracle. `replan` returns to Plan when
an admitted design field fails. `reframe` returns to Frame before any material change to outcome,
consumer, scope, non-goals, authority, acceptance, origin, or Stop. Freeze mutation and external
effects before taking any backward route. `blocked` ends the current run only on an evidenced
unavailable required input, unsatisfiable acceptance, or no viable path after a completed replan; it
is not a weaker form of acceptance.
When a backward or blocked condition is observed in Plan, Execute, or Verify, freeze work, enter the
Finalize reasoning boundary with that evidence, and then take exactly one route. A cancellation
override may instead terminate directly from any nonterminal stage after effects are frozen.

### Stop predicates and convergence

Frame must select observable stopping predicates. A main candidate never fails because a revision,
patch, correction, replacement, or backward-route count was reached. Revision count is diagnostic
only and never decides `accept`, `revise`, `replan`, `reframe`, or `blocked`.

Route a coherent evidence set by its highest boundary, in this order:

1. a changed outcome, consumer, scope, non-goal, authority, acceptance, origin, or Stop predicate
   returns to Frame;
2. an invalid owner, path, boundary, responsibility shape, or oracle, recurrence of the same causal
   root, or a non-shrinking or growing candidate returns to Plan through revision-pressure replan;
3. otherwise, a candidate-local finding with the admitted design and oracle intact returns to
   Execute as the smallest coherent root-cause correction;
4. `blocked` requires observed provenance bound to a required decision showing unavailable
   authority, evidence, or capability; unsatisfiable acceptance; or no viable route after a completed
   replan under the unchanged Frame. A hint, failure class, finding, resource budget, or count is not
   such a predicate.

A no-viable comparison is admissible only after an actually taken Finalize-to-Plan structural
replan and binds the current Frame and replan generation. Another replan or reframe makes it stale.
Candidate non-convergence likewise requires comparison of the admitted and observed candidate
fingerprint or boundary; size or count alone is not that evidence. Once a coherent finding set picks
the highest route, a later lower-boundary finding cannot overwrite it.

Only a genuinely temporary unavailable authority, evidence, or capability predicate may carry a
`Resume` stage. Resume requires a new observation that binds the same fact category and required
decision and proves it is now available; removing or renaming a source is not evidence. Unsatisfiable
acceptance has no Resume under the unchanged Frame and continues only through `reframe` with new
acceptance evidence. A completed replan with no viable path also has no Resume; a later credible path
returns through Plan with its new evidence, never directly to Verify on the original candidate.

Do not repeat an unchanged failed investigation, check, candidate, or external request. Each retry
must name the changed candidate, input, environment, authority, or evidence source and the
observation that can now disconfirm the prior result. Maintain one writable winner at a time as an
integrity constraint, never as an attempt quota.

A separately isolated read-only research or wait lane may have a bounded time, query, or tool budget
for the same unresolved Frame, Plan, or Verify question. Exhaustion returns evidence unavailable,
escalation, or an explicit recovery gate; it does not reject the Mission or candidate. Only an
explicit user-approved finite Stop change may continue that exhausted lane. A new turn, compaction,
branch, checkout, task, or smaller diff does not reset consumed Stop evidence or erase an observed
causal predicate.
When a decision depends on that exhausted lane, no admission or main-Mission block route may proceed
until recovery or escalation disposes the lane. Any later `blocked` route requires a separate
post-disposition observation with its own required-decision binding and provenance.

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
Plan: <admitted owner, path, boundary, candidate shape, verification route>
Candidate/effects: <exact commit or complete diff locator; effects already performed>
Evidence: <decisive checks and remaining blocker>
Position: <current stage or terminal route; observed Stop predicates and next legal operation>
Resume: <stage to re-enter after a named blocker is removed, or none>
```

This locator is evidence, not an identity, receipt, file, ledger, or host state. Match the Frame,
origin, candidate/effects, Stop predicates, next legal operation, and any resumable stage before
continuing. If any cannot be recovered exactly enough to exclude a different Mission or candidate,
freeze before the next mutation or external effect and route `blocked` or ask for the missing
user-owned fact. An exactly recovered temporary `blocked` Mission re-enters its explicit `Resume`
stage only after changed evidence removes the named blocker; terminal blocked predicates follow the
reframe or Plan routes above. Multi-Mission recovery
additionally follows the session graph contract; this locator does not replace it.

## Plan

Inspect the current owner, production entry point when one exists, affected contracts, tests, and
working-tree state. Choose the smallest vertical change that closes the outcome.
Plan is read-only. Admit the owner, path, affected boundary, candidate shape, and verification route
before mutation. For every required nontrivial action outside the main agent's ordinary observed
capability, also bind its execution owner and exact effect and authority, plus either the necessary
capability observed at the stage where the action must run or a named, owned later-stage fail-closed
gate. An inherently candidate-bound capability may use such a gate after Execute; Plan must not claim
that its candidate locator or capability is already proven. If neither current capability nor such a
gate exists, remain in Plan with the necessary capability evidence unavailable. Freeze the
mission-owned boundary against the named Origin and the observed pre-existing user work instead of
admitting paths later from Execute. When any Plan field remains unresolved, keep investigating or
return to Frame.

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
- Use an agent lane only for a concrete unresolved question, a frozen non-overlapping build leaf, or
  an independently useful frozen-candidate risk lens. When one activates, load
  [agent lane routing](references/support-lanes.md) before dispatch.

Agent lanes are conditional execution choices, not standing teams or required stages.

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
boundary. Return to Frame for `reframe` when a Frame field must materially change. When the same
causal root recurs, the candidate does not shrink, its boundary grows, or pressure invalidates the
admitted design, load [revision-pressure replan](references/revision-pressure-replan.md) before
further mutation.

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

Do not keep repository tests for this skill's instructions or bundled helpers; validate them through actual helper calls in real Missions and hub observation, and fix the real owner when a failure is observed.

A candidate change invalidates only evidence affected by that change. Reuse read-only discovery and
unaffected checks only when their evidence-specific affected inputs, source and dependency inputs,
proven consumer closure, configuration, toolchain, and environment remain identical; track the
changed whole-candidate locator separately. A full root gate is candidate-bound: run it on the final
integrated candidate and repeat it only when an input actually changes or a failure is corrected,
never because a run-count budget was reached.

Use [architecture sensor evidence](references/architecture-sensor.md) only for material structural
change, cross-owner effects, or persistent patch pressure.

When a frozen candidate has two or more mutually independent, decision-changing risk questions,
use the advisory candidate-lens contract in agent lane routing and activate only the needed lenses.
Their returns are untrusted leads for main-agent reproduction, never independent acceptance or votes.

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
observed provenance bound to a required decision proves unavailable authority, evidence, or
capability, acceptance is unsatisfiable, or a completed replan under the unchanged Frame proves no
viable route; do not weaken acceptance to manufacture `accept`.

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
tip, and every related node in the current completion boundary is terminal, load
[Refactor Mission proposals](references/refactor-mission-proposal.md) only when that integrated head
contains concrete structural evidence. Acceptance count alone is investigation eligibility, not
proposal justification. Any justified refactor is a new proposal requiring user approval; the old
graph does not authorize it. In multi-Mission work only the hub evaluates this trigger after its
complete checkpoint reconciliation; a child reports terminal evidence but never initiates the
refactor investigation.
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
authority overreach, or unavailable isolation return to the main agent without another lane.
