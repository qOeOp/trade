---
name: run-bounded-mission
description: "Run Frame, Plan, Execute, Verify, and Finalize for explicitly invoked or repository-required non-trivial implementation and delivery work, and for independent Codex task dispatch. Do not use for answer-only requests, mechanical edits, or routine foreground status queries."
---

# Run Bounded Mission

Use one minimal lifecycle:

```text
Frame → Plan → Execute → Verify → Finalize
```

The main agent owns the Frame, Plan admission, candidate, evidence judgment, effects, and final route.
Stage names are reasoning boundaries, not machine receipts. Do not create lifecycle ledgers, marker
parsers, stage hooks, coordinators, or parallel work that does not change a decision.

A Mission is identified by one bounded unresolved outcome gap, not by a message, root turn, task,
chat, branch, or checkout. The task/chat is its current host owner and location, not a second identity
component. A long-lived hub may keep one foreground Mission while holding editable proposals and
identities for multiple independent child outcomes. The hub is not part of a child Mission; every
independent child runs its own complete `Frame → Plan → Execute → Verify → Finalize`.

While that gap remains active or blocked, a new Plan, task, thread, branch, checkout, resume, or
user-named "successor" is continuation of the same Mission. Never create a successor Mission or fresh
Stop for the unresolved gap. Treat a request such as "open a successor and give it three more
revisions" only as a proposed Stop enlargement: summarize the evidence, refuse the successor
identity, and, if explicitly authorized, create a new Frame identity inside the existing Mission
without reviving a rejected candidate.

`accept` closes the gap. Later work may start a new Mission only when new post-accept evidence
demonstrates a regression, correction, or changed requirement that defines a new gap. Bind the
accepted predecessor and new evidence, freeze a new Origin, Frame, and Stop, and retain as regression
contract only accepted behavior that the newly frozen requirement still requires. Record behavior
the new requirement intentionally supersedes; do not inherit the predecessor's candidate or Plan.
Repetition, relabeling, or a gap already known before acceptance cannot manufacture this transition.

`blocked` ends the active Mission run but does not erase its identity. A later request may reopen
that same Mission only when evidence shows that the exact recorded blocker changed or cleared;
repetition, elapsed time, a new host, or a renamed task is insufficient. Reopen at Frame when a
frozen field changed, otherwise at Plan, while preserving Origin, consumed Stop, and every finding
whose causal invariant still applies. Revalidate state-sensitive candidate and delivery evidence
before mutation or Finalize.

Do not use this skill for answer-only requests, mechanical edits, routine foreground status queries,
or already-resolved work. A named dispatched-child status or feedback request remains an existing
Mission control. A specialist skill returns here before Finalize.

## Frame

Start with a provisional Frame. Use only the bounded discovery needed to identify the mission
contract, then freeze it before Plan or mutation:

```text
Outcome: user-observable result and endpoint
Consumer: real user, system, or entry point that must exhibit it
Scope: included work envelope, bounded discovery, and explicit non-goals
Authority: permitted effects and forbidden external actions
Acceptance: falsifiable consumer, regression, review, and delivery signals
Origin: immutable starting revision, tree, content, or diff identity
Stop: total revision, retry, wait, time, tool, or cost boundary
Support: admissible read-only capability classes, activation predicates, and budget
```

Classify every incoming message by outcome, not wording. Keep continuation, correction, review,
status, or feedback for the foreground outcome in the active task. Route a named child status or
feedback request to that child without changing the foreground Mission. For each independent outcome,
prepare a complete editable task proposal and ask for minimal consent; do not create the task first.
An unambiguous approval of that proposal is an explicit user request for the host to create exactly
that task.

Load [task dispatch](references/task-dispatch.md) when an incoming message may contain an independent
outcome or when the host exposes task-management tools. It defines proposal, consent, native task
creation, immediate return, child controls, and capability fallback. Never serialize another Mission
inside the active task/worktree or use a subagent as a user-visible task substitute.

Apply the same outcome rule when evidence at any lifecycle stage reveals work outside the frozen
Frame or a failure not attributable to the candidate. Preserve the bounded evidence, leave the
current Scope and attribution unchanged, and use task dispatch only when the finding has its own
consumer and falsifiable Acceptance. Stage names are examples of discovery timing; they do not
create stage-specific hooks, Mission types, routes, or dispatch policy.

State the no-change counterfactual. Prefer an answer, existing behavior, direct wiring, deletion,
rollback, or narrower outcome when it closes the consumer need.

Separate the consumer outcome from the requested mechanism. Treat the mechanism as a proposal, not
authority or Acceptance. Before freezing the Frame, identify evidence that it is necessary, its
existing owner, the responsibility it adds, its failure mode, and the smallest alternative. Do not
freeze a mechanism that admitted evidence shows is harmful, duplicative, broader than the outcome,
or unjustified by a real consumer. State the engineering objection and the narrower route plainly.
User repetition, urgency, prior effort, or a request to "just implement it" is not contrary evidence
and does not clear the objection. Do not reject a user-owned preference on taste alone.

When bounded history for named paths can change Origin, the no-change counterfactual, the likely
owner, or Scope, run `scripts/git-path-history.py` from this skill. Pass repository-relative
`--path` values and bound the query with `--revision`, dates, `--max-count`, and `--max-files`; use
`--follow` only for one path whose rename history matters. Do not inspect history without a decision
question.

Support is a conditional envelope, not a reservation. Define capability classes and observable
activation predicates from decision gaps and risks, not a subjective complexity score. Do not fix
agent counts, pre-spawn agents, reserve host capacity, or create work merely to consume the budget.
Fast, standard, and high-assurance are service levels for an activated read-only question, not
lifecycle stages, agent roles, model names, or standing teams. The main agent selects the lowest
level that can safely return decision-changing evidence.

Freeze each external effect separately. Never infer commit, push, pull-request creation, comment,
review, thread resolution, merge, deployment, scheduling, secret access, or shared-state authority.
For a GitHub endpoint, load [GitHub delivery](references/github-pr-handoff.md).

Give the frozen Frame an immutable content identity. A material Frame change creates a new identity
and invalidates its downstream Plan and candidate evidence; it never resets Origin or silently
extends Stop.

Stop belongs to the unresolved outcome gap, not its current Plan, task, slice, label, or checkout.
Replan, reframe, dispatch, resume, and a successor for that same gap inherit consumed Stop and every
structural finding whose causal invariant still applies. Only explicit user authorization after a
concrete evidence summary may enlarge it; a bare continuation or repeated request does not.
An authorized enlargement materially changes the Frame identity inside the same Mission and
invalidates candidate-bound evidence. A rejected implementation may be reconsidered only as a fresh
candidate when the new Frame demonstrably removes the finding's causal invariant; an unchanged cause
cannot be relabeled, revived, or patched.

A candidate cannot change the workflow, judge, policy, or reporting authority that accepts it.
Treat such work as a governance candidate and require acceptance evidence the candidate cannot
control.

Reframe only when a frozen Frame field must materially change.

## Plan

Plan is read-only. Consume the frozen Frame and produce the smallest executable route through an
existing owner and real consumer. Inspect the owner path, current behavior, tests, governing
contracts, and evidence needed to choose:

```text
Decision: admit, substitute a narrower mechanism, or reject the requested mechanism
Path: selected owner and smallest vertical candidate
Boundary: affected producers, consumers, restatements, enforcers, and compatible stopping evidence
Prior art: search exemption or adopt, adapt, reference, or build decision with decisive evidence
Shape: responsibility added, retained, and deleted; structural kill conditions
Execution: coherent implementation slices and one writable integrator
Support: activated read-only lanes, packets, dependencies, and branch Stops
Verification: real-consumer exercise, authoritative regressions, evaluator predicates, and isolation
Delivery: prerequisites for the frozen endpoint without adding authority
Fallback: first conditions forcing revise, replan, reframe, or blocked
```

When a failing test can change the candidate, an escaped defect shows that existing tests missed
required behavior, or the Plan may refactor tests, load
[test effectiveness governance](references/test-effectiveness-governance.md) before mutation.
Resolve contract and consumer authority before treating a test as an oracle. Never degrade
production behavior merely to satisfy an unclassified or obsolete test.

Resolve reuse before new implementation: existing behavior, direct reuse, thin adapter, bounded
adaptation, then evidence-backed new responsibility. For every non-mechanical Plan that would add,
replace, or materially redesign responsibility, presume public prior art can change the path until
evidence shows otherwise. Before Plan admission, load
[decision-relevant prior art](references/plan-prior-art.md) and run its method in order:
breadth-first discovery of materially different open-source, standard, product, and reference
implementations; shortlist the credible fits; then depth-first verification of only those candidates.
Record exactly one decision for each proposed responsibility: `adopt`, `adapt`, `reference`, or
`build`. `build` must explain why the strongest credible reusable candidate fails the frozen outcome,
constraints, or acceptance.

Skip external prior-art discovery only when the Plan records a falsifiable reason: the change is
mechanical; it repairs repository-specific behavior already fixed by an authoritative contract; no
new responsibility or implementation choice is introduced; external lookup is forbidden by
Authority; or the user explicitly requires a named implementation approach. Unknown candidate
availability is not an exemption. Missing search capability cannot justify `build`; narrow or replan
from admitted evidence, or return `blocked` when the unresolved reuse decision can materially change
the candidate.

Trace changed meaning to the first evidence-backed compatible boundary. Put each affected surface
and its exercise in the plan without expanding the frozen Scope or weakening Acceptance.

Plan admission is an engineering decision, not a transcription of the request. Admit only a path
whose added responsibility is necessary for the frozen outcome and strictly justified over the
no-change or narrower alternative. If decisive evidence rejects the requested mechanism, preserve
the legitimate outcome through a substitute or return `blocked`; do not execute the rejected
mechanism while discussion continues. An unresolved evidence-backed design objection prevents Plan
admission and can be cleared only by contrary evidence or a material reframe.

Use `scripts/git-path-history.py --format json` when per-commit path changes can resolve an owner,
removed invariant, repeated correction, or compatible stopping boundary. Treat full commit hashes,
timestamps, and per-file numstat as source evidence. Treat line totals and filename overlap only as
supporting signals; they do not establish intent, semantic ownership, or affected-boundary closure.

Activate support only when its Frame predicate is observed:

- use a host-native read-only repository explorer for a bounded codebase question whose result can
  change the plan; a fast lane is admissible only under the observable gate in
  [read-only support service levels](references/support-lanes.md);
- use a read-only researcher for the breadth-then-depth prior-art method when the candidate set is
  unknown, or for another unresolved current-source, compatibility, maintenance, license, or
  failure-mode question;
- use a read-only planner as a design challenger after admitted evidence when a requested mechanism
  may be harmful or unjustified, multiple credible paths or materially different candidate shapes
  remain, consequential cross-owner trade-offs exist, or revision pressure has frozen an incumbent;
- admit an independent evaluator predicate for governance or authority-sensitive candidates,
  high-impact failure modes, conflicting evidence, candidate-controlled oracles, and changes to
  instructions, skills, agent definitions, discovery paths, or the judge.

Load [read-only support service levels](references/support-lanes.md) before dispatching a fast lane,
promoting a support question, or launching two or more lanes concurrently. It defines the detailed
admission and exclusion matrix, minimum dispatch and evidence packets, one-way escalation,
dependency-aware concurrency, host projection boundary, stage fit, and replay scenarios. Do not
dispatch when no real main-agent decision gap remains or when dispatch and merge cost is not expected
to beat direct inspection.

For every evaluator predicate, freeze one risk lens, the planned launch context, its instruction
origin and automatic discovery boundary, and the evidence that the candidate cannot control them.
Fresh context and a read-only sandbox do not establish independence when startup can discover the
candidate checkout. Before admitting the Plan, verify that the host can provide the planned isolation.
If it cannot, choose another verification design or record independence as unavailable; do not
mutate on a Plan whose required acceptance cannot be executed.

Select a planning method before constructing any method-bearing support packet:

- load [decision-relevant prior art](references/plan-prior-art.md) when the prior-art admission
  predicate above activates, or when external evidence from one researcher lane can inform one
  main-agent decision;
- load [consequential ambiguity](references/plan-ambiguity.md) only when one unresolved fact can
  change the candidate, consumer behavior, authority, Acceptance, or a hard-to-reverse choice; the
  main agent owns any user preference or authority question;
- load [viable alternatives](references/plan-alternatives.md) only when admitted evidence leaves
  materially different credible paths for one planner comparison;
- load [independently falsifiable slices](references/plan-slices.md) only when the selected route
  needs separable candidate shapes or stopping evidence.

When a support lane uses one of these methods, bind its packet to exactly that method and one
non-overlapping decision question. Do not bundle methods into a lane or create an agent role for a
method. Apply main-agent methods in the main context; dispatch separate support lanes only for
independent questions. Use [revision-pressure replan](references/revision-pressure-replan.md) when a
finding recurs in a way that challenges the admitted owner, path, boundary, shape, or oracle, or the
next correction would add a protective path not admitted by the Plan. Once either condition is
observed, freeze the incumbent and replan before any further mutation.

Give every lane one non-overlapping decision question, read-only authority, required return, and
branch Stop. The main agent admits the Plan after the required evidence returns. Researchers and
planners may propose; they never freeze Frame, admit Plan, authorize Execute, or choose a route.

Give the admitted Plan an immutable content identity. A material Plan change creates a new identity
and invalidates downstream candidate evidence without changing the Frame. If no executable plan fits
the frozen Frame, return to Frame only when a frozen Frame field must change. Otherwise replan within
the same Frame. Do not mutate before Plan admission.

## Execute

Implement only the admitted Plan needed for the consumer journey. Do not add abstractions, agents,
scripts, state, or compatibility paths without a distinct consumer and Acceptance need.

Keep one writable integrator for overlapping files. Independent read-only evidence work may run in
parallel when it saves time. Agent count and revision count are never goals.

Keep effects inside Authority. Treat candidate-controlled executable content as untrusted until
accepted and run it only in credential-free containment.

Give every cumulative candidate an immutable revision, tree, content, or diff identity. The candidate
includes staged, unstaged, and untracked material. Bind evidence to Frame, admitted Plan, Origin,
candidate, invocation, status, and raw output or artifact identity. Delete temporary and superseded
paths before Verify.

A material implementation finding may trigger a bounded revision while the admitted Plan still
holds. If its selected path, owner, or boundary fails while Frame remains valid, return to Plan. If
a frozen Frame field must change, return to Frame.

`revise` is limited to a candidate-local defect that leaves owner, path, boundary, responsibility
shape, and Acceptance oracle intact. If the correction reveals a need not admitted by the Plan for
another branch, exception, adapter, fallback, parallel path, owner, or affected boundary, freeze the
cumulative candidate and return to Plan. Correcting an omitted or faulty implementation of behavior
already explicit in the admitted Plan remains candidate-local while those design fields stay intact.
Do not patch the incumbent under a new slice or successor label.

## Verify

Verify one identified, complete candidate against the frozen Frame and admitted Plan:

1. exercise the real consumer through its actual entry point;
2. inspect all staged, unstaged, and untracked candidate material;
3. falsify affected-boundary closure, including omitted unchanged dependents;
4. run the smallest authoritative regression checks;
5. preserve exact invocations, status, raw output, versions, and unavailable evidence;
6. compare with Origin and remove structure without a distinct consumer or acceptance need.

Tests, static checks, documents, and packages support acceptance unless they are the frozen consumer.
Candidate-caused architecture or authority violations are material failures.

For an escaped defect or a disputed test oracle, apply the authority, failure classification,
escaped-defect review, and test restructuring predicates in
[test effectiveness governance](references/test-effectiveness-governance.md). A green suite cannot
close an unexercised consumer, and a red test cannot override a compatible higher-authority contract.
Any separate Refactor Mission remains governed after `accept` by
[Refactor Mission proposals](references/refactor-mission-proposal.md).

Classify each material failure before correction. A localized implementation error may route to
`revise`; a wrong owner, path, responsibility boundary, candidate shape, acceptance proxy, or added
protective path not admitted by the current Plan must route to `replan`; a failed frozen field must
route to `reframe`. Faulty or omitted execution of already-admitted structure is candidate-local and
routes to `revise` while those design fields stay intact. Sunk effort, revision count, and incumbent
code are never evidence for retention. Compare the cumulative candidate with Origin and the
narrowest viable alternative, not only with its preceding revision.

Inspect path history with `scripts/git-path-history.py` only when a removed or moved control,
ambiguous intent, regression hypothesis, or repeated candidate correction makes it probative.
History never substitutes for exercising the identified candidate and current consumer.

Use [reviewer handoff](references/reviewer-handoff.md) when an evaluator predicate admitted by Plan
matches the identified candidate. Do not launch one for ceremony. Launch a fresh evaluator for a
governance or authority-sensitive candidate, high-impact failure mode, conflicting evidence, or a
candidate-controlled oracle. Give each evaluator one non-duplicated risk lens; reviewers do not vote.

Before dispatch, exact-match the packet's Frame identity, Plan identity, activation predicate, risk
lens, candidate identity, planned launch context, instruction origin, automatic discovery boundary,
and isolation evidence to the frozen values, then recheck that the observed host context still
satisfies them. Missing or mismatched bindings, or isolation that is already known to fail, are
verification design failures: do not launch the evaluator; return to Plan. If unexpected context
drift is observed only after launch, the evaluator returns `unsupported` and the mission returns to
Plan. If no independent context is available within Authority and Stop, choose `blocked`; never
weaken Acceptance.

When a candidate changes instructions, skills, agent definitions, discovery paths, or the judge,
launch independent review from the immutable Origin or a neutral context that cannot discover the
candidate version. If this isolation cannot be verified, report independent acceptance as
unsupported.

Any candidate change invalidates all earlier candidate-bound evidence and starts a new Verify.
`partial`, `unsupported`, or any material failed or unverified Acceptance signal cannot pass.
Use [architecture sensor evidence](references/architecture-sensor.md) only for a material structural
change, cross-owner effect, or persistent patch pressure.

Route a candidate-local failure to Execute when Plan still holds. Route a failed owner, path,
boundary, or verification design to Plan when Frame still holds. Return to Frame only when a frozen
Frame field must change.

## Finalize

Finalize closes the current Verify cycle by choosing exactly one route. It does not imply deployment;
`accept` and `blocked` end the active Mission run.

Choose one route:

- `accept`: every material Acceptance and required delivery signal passes for the exact Frame, Plan,
  and candidate;
- `revise`: the admitted design holds and a bounded material correction remains;
- `replan`: the frozen Frame holds but the selected path, owner, boundary, or verification plan must
  change;
- `reframe`: a frozen Frame field must materially change;
- `blocked`: required authority, facts, capability, independence, or Stop is unavailable and no
  pending in-scope alignment can supply it.

`revise` returns to Execute. `replan` returns to Plan. `reframe` returns to Frame.
The narrowly defined terminal reopen above is the only transition out of `blocked`.
There is no transition out of `accept`; only the evidence-bound new-gap rule above may start a new
Mission.

After `accept`, load [Refactor Mission proposals](references/refactor-mission-proposal.md) only when
read-only evidence spanning accepted Missions may demonstrate a separate structural outcome. This
follow-up investigation is not another Finalize route, does not reopen or continue an accepted
Mission, and may produce at most one editable proposal before any native task dispatch.

For `local-only`, bind the exact Frame, Plan, candidate, and evidence, report working-tree effects
and recovery path, clean mission-owned temporary resources, and perform no commit or remote effect.

For commit or remote endpoints:

1. recheck the separate Authority for every effect;
2. publish only the exact verified candidate;
3. observe current signals through the repository or host-native owner;
4. return changed candidates to Verify;
5. treat pending, missing, stale, or unknown signals as outstanding.

Unexpected drift in a tracked head, base, merge tree, instruction origin, Frame, Plan, or candidate
invalidates prior evidence before delivery continues. A completed external effect must be observed;
an armed or queued action is not completion.

Child execution is not pending work of the parent after dispatch. The hub returns immediately and
observes or updates a child only when the user asks.

Bind Finalize to Outcome, Consumer, Frame identity, Plan identity, candidate identity, decisive
evidence, residual limits, effects, cleanup, and final route. Do not claim evidence that was not
produced.

When Finalize reaches `accept`, `blocked`, or another point that returns control to the user, write
the handoff for the user's next decision, not as a lifecycle receipt:

- lead with the user-observable result and exact delivery or effect state;
- link or name the delivered artifact, change, pull request, deployment, or preserved local work
  when it helps the user act or verify;
- summarize only decisive evidence. Omit routine successful commands, logs, and internal identities
  unless the user requested them or they materially support trust, audit, or recovery;
- state a failed or unavailable check, omission, unknown, or residual limit only when it changes
  confidence or what happens next, and make the consequence explicit;
- end with one labeled next-action line, localized to the user's language: `Next step` for required
  action, `Optional next step` for a valuable continuation, or `No action needed` when the endpoint
  is complete;
- when blocked, name the exact blocking condition recognized by the route, say whether the user can
  resolve it, and state what will resume after it clears. Never invent user action or replace a
  resolvable blocker with a generic offer;
- do not invent follow-up work, ask a generic "what next?", force an optional review after objective
  acceptance, or end on an internal route token or identity.

Keep the format proportional. Use short prose for a small delivery and a few descriptive headings or
bullets when they improve scanning; do not impose one universal template.

## Host and Agent Boundary

Subagents receive one bounded packet containing their question or lens, scope, read-only authority,
Frame identity, Plan question or admitted Plan identity when applicable, candidate when applicable,
required return, and Stop. They return evidence to the main agent, do not communicate laterally, and
never own Frame, Plan admission, or Finalize.

Keep lifecycle semantics in this file. Agent definitions, tool mappings, MCP configuration, and
host adapters may project capabilities but cannot add routes, authority, state, deadlines, or peer
coordination. Use host-native task, worktree, review, and delivery primitives under their own
policies. A host projection is trustworthy only after a behavior-equivalent consumer exercise.

The Git history helper is local and read-only. It requires Git and Python 3, emits no Mission state,
and has no commit, push, pull-request, review, merge, or other GitHub authority. Its merge statistics
compare a merge commit with its first parent; its result reports whether the local repository is
shallow and marks boundary statistics unavailable when parent history is missing.

Task dispatch is root-level outcome routing, not stage-internal agent delegation. Parent routing,
Codex chat Handoff, and a child Mission's delivery Finalize are distinct operations; none transfers
the child's lifecycle ownership to the hub.
