---
name: run-bounded-mission
description: "Use when explicitly invoked. Otherwise use for repository-required non-trivial software work or consequential technical decisions that need one bounded lifecycle across scope, authority, planning, implementation, evaluation, authorized handoff, and terminal reporting. It may wrap a specialist skill, which must return control before Handoff. Do not auto-activate for explanation or reporting only, obvious mechanical edits, passive waiting, generic advice, exact-command execution, or a specialist workflow that already owns the complete terminal endpoint."
---

# Run Bounded Mission

This file is the sole lifecycle authority. References provide methods; host hooks only enforce the
terminal receipt. The main agent owns the contract, candidate, evidence, Handoff, and final route.

## Lifecycle

For an explicitly requested complete mission, run every stage:

```text
Contract -> Plan -> Build -> Evaluate -> Handoff -> Terminal
```

For other requests, use only the stages required by the request, but once a non-trivial change mission
starts it remains active through `Handoff` and `Terminal`. A specialist skill returns here after its
bounded work and cannot terminate, defer Handoff, or ask whether to continue.

Stages are serial. Do not enter a later stage until the required work and subagent returns for the
current stage are complete or explicitly unavailable. Within a stage, use host-native agent tools to
start stable, independent packets together, continue non-dependent main-context work, then collect
the required returns. Do not create a coordinator agent, queue, ledger, or stage hook.

| Stage | Stage-internal execution |
| --- | --- |
| Contract | The main agent fixes provisional Scope, Authority, Origin, and total Stop. |
| Plan | When multiple decision-changing evidence paths exist, start all stable independent lanes together within current host capacity: built-in `explorer` for repository paths and `mission_researcher` for current external sources. After required briefs return, use one `mission_planner` to synthesize the contract and smallest vertical plan. Keep one short evidence chain in the main context. |
| Build | Keep exactly one writable winner. Read-only support may run only on non-overlapping evidence paths. |
| Evaluate | Run fresh `mission_evaluator` instances against the same immutable candidate, one admitted lens per instance. |
| Handoff / Terminal | The main agent owns effects, receipts, and the route; these stages do not fan out. |

Before mutation:

1. announce this skill and any specialist skill being used;
2. create a working plan with separate `Contract`, `Plan`, `Build`, `Evaluate`, and `Handoff` items;
3. never combine `Evaluate`, `Handoff`, or `Terminal`;
4. emit this visible activation receipt:

```text
Mission-Start: {"endpoint":"merged","origin":"git:0000000000000000000000000000000000000000","stop":"<total boundary>"}
```

Emit it as one standalone line outside a code fence. `endpoint` and `origin` freeze the mission
boundary that Handoff must close; `origin` uses the same immutable identity forms as `candidate`
below. `Mission-Start:` is the human-visible audit receipt. Do not emit it for an answer-only task
that does not require the full lifecycle.

After compaction, resume, or context transfer, re-read governing instructions and this file, then bind
the frozen contract, repository state, candidate identity, remaining Stop, and raw evidence before
mutation. A summary is a locator, not evidence.

## Contract

Before investigation, set provisional discovery Scope, Authority, and total Stop. They may narrow;
expansion requires explicit authority. Separate decision-changing gaps into:

- repository or current-source facts to investigate;
- user-owned preferences or external effects requiring the smallest question.

For repeated corrections or concentrated churn, inspect bounded history before planning. Use
[revision-pressure replan](references/revision-pressure-replan.md) when a finding recurs or another
additive correction would protect the same design.

State the no-change counterfactual. Prefer an answer, existing behavior, wiring, deletion, rollback,
or a narrower decision when it closes the consumer outcome.

Before Build or a consequential final decision, freeze:

```text
Outcome: user-observable result and delivery endpoint
Consumer: real user, system, or entry point that must exhibit it
Scope: included work, bounded discovery, and explicit non-goals
Authority: permitted effects and forbidden external actions
Acceptance: falsifiable consumer, regression, review, and delivery signals
Origin: immutable starting revision, tree, content, or diff identity
Stop: total revision, retry, wait, time, tool, or cost boundary
```

The endpoint is one of `local-only`, `commit`, `change-request`, `merge-ready`, `merged`, deployment,
or another repository-owned endpoint. Freeze each external effect separately. Never infer commit,
push, review, merge, deployment, scheduling, secret access, or shared-state authority.

Acceptance is the frozen oracle. A material change after Build starts routes to `replan`; never weaken
Acceptance to fit a candidate.

## Plan

Choose the smallest vertical change through an existing owner and real consumer. Inspect that path,
its implementation, tests, current behavior, and governing documentation.

Resolve reuse before build: existing owner, direct reuse, thin adapter, bounded adaptation, then
evidence-backed new implementation. Before inventing workflow, skill, agent, or evaluator
infrastructure, use current official and primary sources when repository evidence leaves a
decision-changing unknown. Load only the relevant method from
[planning methods](references/planning-methods.md).

Trace changed meaning through direct producers, consumers, restatements, and enforcers. Stop at the
first evidence-backed compatible boundary. Put each affected surface and its exercise in Scope and
Acceptance.

Split evidence by independent decision question, not by agent count. Give every lane a unique
evidence path and bounded return; do not send multiple agents to repeat the same repository or source
scan. Research briefs go to the planner, not raw search transcripts. The planner synthesizes only:
it does not repeat repository or external research and never owns admission, dispatch, Build, or the
lifecycle route. Load [planning methods](references/planning-methods.md) only for the evidence method
needed by a lane.

Define the candidate, exact consumer exercise, regression checks, delivery endpoint, and first
condition forcing `replan`. For a GitHub endpoint, load
[GitHub PR handoff](references/github-pr-handoff.md).

An implementation candidate cannot change the workflow, judge, policy, or reporting authority that
accepts it. Such work is a separate governance candidate and requires candidate-uncontrollable
acceptance evidence.

## Build

Implement only the candidate needed for the consumer journey. Prefer verification-first for
configuration and integration; use TDD when stable behavior needs regression protection.

Keep effects inside Authority. Treat candidate-controlled executable content as untrusted until
accepted and run it only in credential-free containment.

Give every cumulative candidate a new immutable revision, tree, content, or diff identity. Bind
evidence to Contract, Origin, candidate, invocation, status, and raw output or artifact identity.
Delete temporary and superseded paths before evaluation.

Before every revision, inspect the cumulative candidate. If exceptions, adapters, rules, or paths are
accumulating to protect the design, stop Build and use
[revision-pressure replan](references/revision-pressure-replan.md). Replanning cannot reset Origin or
Stop.

## Evaluate

Evaluate the identified candidate against the frozen Contract:

1. exercise the real consumer through its actual entry point;
2. inspect the complete candidate, including staged, unstaged, and untracked material;
3. falsify affected-boundary closure, including omitted unchanged dependents;
4. run the smallest authoritative regression checks;
5. verify exact commands, status, raw output, versions, and unavailable evidence;
6. compare with Origin and delete structure without a distinct consumer or acceptance need.

Unit tests, static checks, documents, and packages are supporting evidence unless they are the frozen
consumer. Candidate-caused repository architecture violations are material failures.

Admit a finding only when reproducible evidence ties it to Acceptance, the consumer, binding
authority, or a material safety rule. Route design-invalidating findings to `replan`; report
out-of-scope findings without implementing them.

Use [reviewer handoff](references/reviewer-handoff.md) for every evaluator. A mechanical or read-only
outcome may use one general lens. Every non-mechanical writable candidate requires at least two
fresh, read-only lenses before `accept`: `behavior` for the consumer outcome and `architecture` for
ownership, affected-boundary closure, reuse, and entropy. Add only acceptance-critical independent
lenses such as `regression`, `security-authority`, and `runtime-operations`. Do not add reviewers for
confidence, voting, or duplicate scans. One reproducible material failure is not cancelled by other
passes.

All evaluator returns must bind the same candidate identity. Any candidate change invalidates every
earlier evaluator result and starts a new Evaluate wave. `partial`, `unsupported`, or a material
failed or unverified result leaves Acceptance unsatisfied. Use
[architecture sensor evidence](references/architecture-sensor.md) only when a material structural
change, cross-owner effect, or persistent patch pressure needs that method.

## Handoff

Handoff is always a separate stage. Never stop at local completion, readiness to publish, or a
continuation prompt.

For `local-only`:

1. bind the exact candidate identity and complete Acceptance evidence;
2. remove mission-owned temporary resources;
3. report the working-tree effects and recovery path;
4. perform no commit or remote effect.

For commit or remote endpoints:

1. audit candidate-controlled execution, secrets, tokens, and integration automation;
2. publish only the exact candidate through separately authorized effects;
3. bind every commit, change request, release, deployment, review, and required signal;
4. observe current signals through the repository's host-native owner;
5. return changed candidates to Evaluate before republishing.

A material Handoff finding or candidate change returns to Evaluate. Unexpected drift in a tracked
remote head, base, or merge tree invalidates prior candidate-bound evidence before delivery continues.

Pending remote work keeps Handoff active inside Stop. A missing or started signal is outstanding, not
clean. `blocked` skips publication but still completes terminal reporting.

After Handoff actions finish, mark the working-plan Handoff item `completed`. The final response must
carry exactly one Handoff receipt using one of these equivalent forms.

For an ordinary response, emit one standalone line outside a code fence:

```text
Mission-Handoff: {"endpoint":"local-only","origin":"sha256:1111111111111111111111111111111111111111111111111111111111111111","candidate":"sha256:0000000000000000000000000000000000000000000000000000000000000000","acceptance":"passed","effects":[],"cleanup":"complete","route":"accept"}
```

When a strict JSON document owns the final output, freeze this envelope in Acceptance and return the
exact JSON document instead of a raw marker line:

```json
{"result":{},"mission_handoff":{"endpoint":"local-only","origin":"sha256:1111111111111111111111111111111111111111111111111111111111111111","candidate":"sha256:0000000000000000000000000000000000000000000000000000000000000000","acceptance":"passed","effects":[],"cleanup":"complete","route":"accept"}}
```

If an immutable external schema cannot include that recognized envelope, route `blocked`; do not
invent an unparsed field or append invalid text to the JSON document.

Required fields:

- `endpoint`: frozen endpoint;
- `origin`: frozen immutable starting identity, equal to the activation receipt;
- `candidate`: `none`, `sha256:` plus 64 lowercase hex characters, or `git:` plus a 40- or
  64-character lowercase commit hash;
- `acceptance`: `passed` or `blocked`;
- `effects`: array of external or working-tree effects; entries may be any JSON values owned by the
  reporting consumer;
- `cleanup`: `complete` or `preserved`;
- `route`: `accept` or `blocked`.

`acceptance=passed` requires `route=accept`; `acceptance=blocked` requires `route=blocked`. Do not emit
the receipt before Handoff finishes. A Handoff closes only the active mission with the same
`endpoint` and `origin`; multiple raw or enveloped Handoff receipts in one response are invalid.

Before any message that may terminate while the mission is still active, append this exact line:

```text
Mission-Terminal: {"status":"active","endpoint":"merged","origin":"git:0000000000000000000000000000000000000000"}
```

Use the frozen endpoint and origin. Lifecycle markers are valid only as structurally valid standalone
lines outside fenced examples, or as the exact structured-output envelope above. The repository Stop
hook reads assistant JSONL records backward from the transcript tail. An active tail marker returns
immediately; a closing attempt reconstructs the lifecycle back to its original start so a later
continuation cannot replace the frozen endpoint or origin. A matching valid Handoff closes the
mission only when it is the latest lifecycle marker; a later active marker keeps it active. A first
miss requests one bounded continuation and a second terminates as an explicit failure instead of
looping.

## Terminal

Choose exactly one route:

- `accept`: every material Acceptance and delivery signal passes for the identified candidate;
- `revise`: the design holds and one bounded replacement remains;
- `replan`: ownership, design, or Acceptance failed, or the next correction would be additive;
- `blocked`: required authority, facts, capability, independence, or Stop is unavailable.

Only `accept` and `blocked` terminate. `revise` and `replan` continue inside the original Stop and do
not produce a terminal Handoff receipt.

Report Outcome, Consumer, candidate identity, decisive evidence, residual limits, performed effects,
and route. Never claim evidence that was not produced or accept with a material failed or unverified
signal.

## Host Boundary

Subagents receive one bounded packet containing scope, authority, candidate, required return, and
Stop. They return evidence only to the main agent, do not communicate laterally, and never own the
lifecycle route. A reviewer must be fresh, read-only, and uninvolved in Build.

Keep lifecycle semantics here. Agent definitions, tool mappings, hooks, MCP configuration, and
discovery paths are host projections and cannot add routes, authority, state, or peer coordination.
Use native spawn and wait operations for stage-internal work; hooks may guard mechanical tool or
terminal behavior but cannot orchestrate fan-out. Verify each claimed host with activation and one
behavior-equivalent lifecycle exercise.

Only when this skill is explicitly invoked to maintain, audit, or explain this workflow, load the
[lifecycle shape](references/lifecycle-shape.md); do not load it during ordinary mission execution.
