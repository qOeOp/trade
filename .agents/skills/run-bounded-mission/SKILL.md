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

A Mission is identified by one outcome and its owning task/chat, not by a message or root turn. A
long-lived hub may keep one foreground Mission while holding editable proposals and identities for
multiple independent child tasks. The hub is not part of a child Mission; every child runs its own
complete `Frame → Plan → Execute → Verify → Finalize`.

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

State the no-change counterfactual. Prefer an answer, existing behavior, direct wiring, deletion,
rollback, or narrower outcome when it closes the consumer need.

Support is a conditional envelope, not a reservation. Define capability classes and observable
activation predicates from decision gaps and risks, not a subjective complexity score. Do not fix
agent counts, pre-spawn agents, reserve host capacity, or create work merely to consume the budget.

Freeze each external effect separately. Never infer commit, push, pull-request creation, comment,
review, thread resolution, merge, deployment, scheduling, secret access, or shared-state authority.
For a GitHub endpoint, load [GitHub delivery](references/github-pr-handoff.md).

Give the frozen Frame an immutable content identity. A material Frame change creates a new identity
and invalidates its downstream Plan and candidate evidence; it never resets Origin or silently
extends Stop.

A candidate cannot change the workflow, judge, policy, or reporting authority that accepts it.
Treat such work as a governance candidate and require acceptance evidence the candidate cannot
control.

Reframe only when a frozen Frame field must materially change.

## Plan

Plan is read-only. Consume the frozen Frame and produce the smallest executable route through an
existing owner and real consumer. Inspect the owner path, current behavior, tests, governing
contracts, and evidence needed to choose:

```text
Path: selected owner and smallest vertical candidate
Boundary: affected producers, consumers, restatements, enforcers, and compatible stopping evidence
Execution: coherent implementation slices and one writable integrator
Support: activated read-only lanes, packets, dependencies, and branch Stops
Verification: real-consumer exercise, authoritative regressions, and evaluator predicates
Delivery: prerequisites for the frozen endpoint without adding authority
Fallback: first conditions forcing revise, replan, reframe, or blocked
```

Resolve reuse before new implementation: existing behavior, direct reuse, thin adapter, bounded
adaptation, then evidence-backed new responsibility. Trace changed meaning to the first
evidence-backed compatible boundary. Put each affected surface and its exercise in the plan without
expanding the frozen Scope or weakening Acceptance.

Activate support only when its Frame predicate is observed:

- use a host-native read-only repository explorer for a bounded codebase question whose result can
  change the plan;
- use a read-only researcher for an unresolved current-source, compatibility, maintenance, license,
  prior-art, or failure-mode question;
- use a read-only planner only after admitted evidence when multiple credible paths, cross-owner
  trade-offs, or materially different candidate shapes remain;
- admit an independent evaluator predicate for governance or authority-sensitive candidates,
  high-impact failure modes, conflicting evidence, candidate-controlled oracles, and changes to
  instructions, skills, agent definitions, discovery paths, or the judge.

Select a planning method before constructing any method-bearing support packet:

- load [decision-relevant prior art](references/plan-prior-art.md) only when external evidence from
  one researcher lane can inform one main-agent decision;
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
finding recurs or the next correction would add another protective path.

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

Use [reviewer handoff](references/reviewer-handoff.md) when an evaluator predicate admitted by Plan
matches the identified candidate. Do not launch one for ceremony. Launch a fresh evaluator for a
governance or authority-sensitive candidate, high-impact failure mode, conflicting evidence, or a
candidate-controlled oracle. Give each evaluator one non-duplicated risk lens; reviewers do not vote.

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

Finalize closes the current Verify cycle by choosing exactly one route. It does not imply mission
termination or deployment; only `accept` and `blocked` end the mission.

Choose one route:

- `accept`: every material Acceptance and required delivery signal passes for the exact Frame, Plan,
  and candidate;
- `revise`: the admitted design holds and a bounded material correction remains;
- `replan`: the frozen Frame holds but the selected path, owner, boundary, or verification plan must
  change;
- `reframe`: a frozen Frame field must materially change;
- `blocked`: required authority, facts, capability, independence, or Stop is unavailable.

`revise` returns to Execute. `replan` returns to Plan. `reframe` returns to Frame.

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

Report Outcome, Consumer, Frame identity, Plan identity, candidate identity, decisive evidence,
residual limits, effects, cleanup, and final route. Do not claim evidence that was not produced.

## Host and Agent Boundary

Subagents receive one bounded packet containing their question or lens, scope, read-only authority,
Frame identity, Plan question or admitted Plan identity when applicable, candidate when applicable,
required return, and Stop. They return evidence to the main agent, do not communicate laterally, and
never own Frame, Plan admission, or Finalize.

Keep lifecycle semantics in this file. Agent definitions, tool mappings, MCP configuration, and
host adapters may project capabilities but cannot add routes, authority, state, deadlines, or peer
coordination. Use host-native task, worktree, review, and delivery primitives under their own
policies. A host projection is trustworthy only after a behavior-equivalent consumer exercise.

Task dispatch is root-level outcome routing, not stage-internal agent delegation. Parent routing,
Codex chat Handoff, and a child Mission's delivery Finalize are distinct operations; none transfers
the child's lifecycle ownership to the hub.
