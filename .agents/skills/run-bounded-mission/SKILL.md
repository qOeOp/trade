---
name: run-bounded-mission
description: "Run a bounded repository mission through Frame, Execute, Verify, and Disposition. Use when explicitly invoked and for repository-required non-trivial software work or consequential technical decisions. Preserve a frozen contract, an identified complete candidate, real-consumer evidence, and separately authorized delivery effects without fixed agent counts, receipts, or revision rituals."
---

# Run Bounded Mission

Use one minimal lifecycle:

```text
Frame → Execute → Verify → Disposition
```

The main agent owns the contract, candidate, evidence judgment, effects, and final route. Stage names
are reasoning boundaries, not machine receipts. Do not create lifecycle ledgers, marker parsers,
stage hooks, coordinators, or parallel work that does not change a decision.

For answer-only, mechanical, or already-resolved work, keep the lifecycle implicit and brief. A
specialist skill returns here before Disposition.

## Frame

Before mutation or a consequential final decision, freeze:

```text
Outcome: user-observable result and endpoint
Consumer: real user, system, or entry point that must exhibit it
Scope: included work, bounded discovery, and explicit non-goals
Authority: permitted effects and forbidden external actions
Acceptance: falsifiable consumer, regression, review, and delivery signals
Origin: immutable starting revision, tree, content, or diff identity
Stop: total revision, retry, wait, time, tool, or cost boundary
```

Classify the requested outcome, not its wording. Continue related corrections, reviews, and status
requests in the active task. Create or hand off to a separate user-visible task only when the user
requests it or the host policy independently authorizes it; never transfer an active candidate to a
subagent.

State the no-change counterfactual. Prefer an answer, existing behavior, direct wiring, deletion,
rollback, or narrower change when it closes the outcome.

Choose the smallest vertical path through an existing owner and real consumer. Trace changed meaning
through direct producers, consumers, restatements, and enforcers; stop at the first
evidence-backed compatible boundary. Put each affected surface and its exercise in Acceptance.

Use optional methods only when they can change the candidate:

- use a read-only researcher for an unresolved current-source, compatibility, maintenance, license,
  prior-art, or failure-mode question;
- use a read-only planner only when multiple credible paths, cross-owner trade-offs, or consequential
  authority choices remain after evidence collection;
- use [planning methods](references/planning-methods.md) only for the needed method;
- use [revision-pressure reframe](references/revision-pressure-replan.md) only when a finding recurs
  or the next correction would add another protective path.

The main agent synthesizes evidence and freezes Frame. Researchers and planners may propose; they
never own admission, authority, or route.

Freeze each external effect separately. Never infer commit, push, pull-request creation, comment,
review, thread resolution, merge, deployment, scheduling, secret access, or shared-state authority.
For a GitHub endpoint, load [GitHub delivery](references/github-pr-handoff.md).

A candidate cannot change the workflow, judge, policy, or reporting authority that accepts it.
Treat such work as a governance candidate and require acceptance evidence the candidate cannot
control.

Reframe only when Outcome, ownership, Authority, or Acceptance materially changes. Reframing does
not reset Origin or Stop.

## Execute

Implement only the complete candidate needed for the consumer journey. Prefer the simplest existing
owner; do not add abstractions, agents, scripts, state, or compatibility paths without a distinct
consumer and acceptance need.

Keep one writable integrator for overlapping files. Independent read-only evidence work may run in
parallel when it saves time. Agent count and revision count are never goals.

Keep effects inside Authority. Treat candidate-controlled executable content as untrusted until
accepted and run it only in credential-free containment.

Give every cumulative candidate an immutable revision, tree, content, or diff identity. The candidate
includes staged, unstaged, and untracked material. Bind evidence to Contract, Origin, candidate,
invocation, status, and raw output or artifact identity. Delete temporary and superseded paths before
Verify.

A material finding may trigger a bounded revision while the design still holds. If a finding recurs,
responsibility spreads, or protective exceptions accumulate, return to Frame and simplify instead of
patching again.

## Verify

Verify one identified, complete candidate against the frozen contract:

1. exercise the real consumer through its actual entry point;
2. inspect all staged, unstaged, and untracked candidate material;
3. falsify affected-boundary closure, including omitted unchanged dependents;
4. run the smallest authoritative regression checks;
5. preserve exact invocations, status, raw output, versions, and unavailable evidence;
6. compare with Origin and remove structure without a distinct consumer or acceptance need.

Tests, static checks, documents, and packages support acceptance unless they are the frozen consumer.
Candidate-caused architecture or authority violations are material failures.

Use [reviewer handoff](references/reviewer-handoff.md) when independent review is warranted. One
general read-only review is enough by default. Add a fresh evaluator only for a governance or
authority-sensitive candidate, high-impact failure mode, conflicting evidence, or a
candidate-controlled oracle. Give each evaluator one non-duplicated risk lens; reviewers do not vote.

When a candidate changes instructions, skills, agent definitions, discovery paths, or the judge,
launch independent review from the immutable Origin or a neutral context that cannot discover the
candidate version. If this isolation cannot be verified, report independent acceptance as
unsupported.

Any candidate change invalidates all earlier candidate-bound evidence and starts a new Verify.
`partial`, `unsupported`, or any material failed or unverified Acceptance signal cannot pass.
Use [architecture sensor evidence](references/architecture-sensor.md) only for a material structural
change, cross-owner effect, or persistent patch pressure.

## Disposition

Choose one route:

- `accept`: every material Acceptance and required delivery signal passes for the exact candidate;
- `revise`: the admitted design holds and a bounded material correction remains;
- `reframe`: ownership, design, Authority, or Acceptance must change;
- `blocked`: required authority, facts, capability, independence, or Stop is unavailable.

`revise` returns to Execute. `reframe` returns to Frame. Only `accept` and `blocked` end the mission.

For `local-only`, bind the exact candidate and evidence, report working-tree effects and recovery
path, clean mission-owned temporary resources, and perform no commit or remote effect.

For commit or remote endpoints:

1. recheck the separate Authority for every effect;
2. publish only the exact verified candidate;
3. observe current signals through the repository or host-native owner;
4. return changed candidates to Verify;
5. treat pending, missing, stale, or unknown signals as outstanding.

Unexpected drift in a tracked head, base, merge tree, instruction origin, or candidate invalidates
prior evidence before delivery continues. A completed external effect must be observed; an armed or
queued action is not completion.

Report Outcome, Consumer, candidate identity, decisive evidence, residual limits, effects, cleanup,
and final route. Do not claim evidence that was not produced.

## Host and Agent Boundary

Subagents receive one bounded packet containing their question or lens, scope, read-only authority,
candidate when applicable, required return, and Stop. They return evidence to the main agent, do not
communicate laterally, and never own Frame or Disposition.

Keep lifecycle semantics in this file. Agent definitions, tool mappings, MCP configuration, and
host adapters may project capabilities but cannot add routes, authority, state, deadlines, or peer
coordination. Use host-native task, worktree, review, and delivery primitives under their own
policies. A host projection is trustworthy only after a behavior-equivalent consumer exercise.
