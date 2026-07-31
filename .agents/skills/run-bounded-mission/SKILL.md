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

After Frame, select the smallest mode that fits the admitted outcomes:

- With no independent Mission, handle the request directly without dispatch machinery.
- With one independent Mission, run it in the current session.
- With two or more independent Missions, use the loaded Codex task dispatch reference and keep one
  minimal session-only graph. Admit an outcome only when it has its own consumer, falsifiable
  Acceptance, owner and write surface, delivery boundary, and can be accepted, blocked, or cancelled
  independently. Diagnosis, tests, documentation synchronization, review corrections, coupled
  producer/consumer work for one behavior, and support roles remain internal subtasks.

In multi-Mission mode the current session is the sole orchestration authority. It owns graph
admission, direct `after` edges, conflict serialization, source-tip observation, bounded monitoring,
and release of at most one exact candidate head for merge at a time. Children still own their
individual Frame, Plan, candidate, worktree, branch, pull request, and verification. Parallelism is
limited to a ready wave whose owners, write surfaces, contracts, premises, and direct dependencies
are mutually independent. A merged child invalidates the observed base of every other open child;
the hub must observe the canonical source tip again before another merge release or creation of a
dependent child. This authority exists only in conversation prose and checkpoints. It does not
authorize a scheduler, durable state, a queue service, automatic retries or transfers, a second CLI,
background automation, or hidden execution in the hub worktree.

## Plan

Inspect the current owner, production entry point when one exists, affected contracts, tests, and
working-tree state. Choose the smallest vertical change that closes the outcome.
Plan is read-only. Admit the owner, path, affected boundary, candidate shape, and verification route
before mutation; when any of them remains unresolved, keep investigating or return to Frame.

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
