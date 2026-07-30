---
name: run-bounded-mission
description: "Run every root user turn through one bounded lifecycle: Mission-Start, Contract, Plan, Build, Evaluate, Handoff, and Mission-Terminate. Every stage is mandatory and may finish as done, noop, or blocked. Repository changes default to a merged pull-request endpoint; answer-only turns complete the same lifecycle with no candidate."
---

# Run Bounded Mission

This file is the sole lifecycle authority. Every root user message starts exactly one mission. No
answer, explanation, mechanical edit, wait, specialist workflow, or exact-command request bypasses
the lifecycle. A stage may be `noop`; it may never be omitted.

```text
Mission-Start
  -> Contract
  -> Plan
  -> Build
  -> Evaluate
  -> Handoff
  -> Mission-Terminate
```

The main agent owns the contract, candidate, evidence, route, and receipts. References provide
methods. Hooks project and enforce this lifecycle; they do not create a second authority.

## Admission and receipts

`UserPromptSubmit` supplies the current `turn_id` and emits a developer-context admission record
binding the hook-observed `cwd`, Git origin, workspace class, and GitHub repository. The Stop hook
reads that record and the matching `turn_context` from the host transcript; it does not trust a
candidate-writable side file. Use those exact values in every receipt. A Stop-hook continuation
resumes the same mission and must not create another `Mission-Start`.

Before investigation:

1. announce this skill and any specialist skill;
2. bind the host-provided worktree before mutation; use `none` only for a genuinely non-Git turn and
   never create a nested worktree;
3. create a working plan with separate `Contract`, `Plan`, `Build`, `Evaluate`, `Handoff`, and
   `Mission-Terminate` items;
4. emit exactly one start receipt:

```text
Mission-Start: {"turn_id":"<turn>","endpoint":"merged","origin":"git:0000000000000000000000000000000000000000","stop":"<total boundary>","workspace":"reused"}
```

`workspace` is `reused` or `none`. Use `none` only outside a Git-backed task. `endpoint`
is `response` when no repository candidate is authorized or expected and `merged` for repository
changes under the project's standing PR authority. Another endpoint requires explicit authority.

Every later stage emits exactly one receipt after that stage is complete:

```text
Mission-Contract: {"turn_id":"<turn>","endpoint":"merged","origin":"git:0000000000000000000000000000000000000000","status":"done"}
Mission-Plan: {"turn_id":"<turn>","endpoint":"merged","origin":"git:0000000000000000000000000000000000000000","status":"done"}
Mission-Build: {"turn_id":"<turn>","endpoint":"merged","origin":"git:0000000000000000000000000000000000000000","status":"done","candidate":"sha256:0000000000000000000000000000000000000000000000000000000000000000"}
Mission-Evaluate: {"turn_id":"<turn>","endpoint":"merged","origin":"git:0000000000000000000000000000000000000000","status":"done","candidate":"sha256:0000000000000000000000000000000000000000000000000000000000000000"}
Mission-Handoff: {"turn_id":"<turn>","endpoint":"merged","origin":"git:0000000000000000000000000000000000000000","status":"done","candidate":"sha256:0000000000000000000000000000000000000000000000000000000000000000","effects":[]}
Mission-Terminate: {"turn_id":"<turn>","endpoint":"merged","origin":"git:0000000000000000000000000000000000000000","candidate":"sha256:0000000000000000000000000000000000000000000000000000000000000000","acceptance":"passed","effects":[],"cleanup":"complete","route":"accept"}
```

Receipts are standalone lines outside code fences by default. `status` is `done`, `noop`, or `blocked`.
`origin` and `candidate` are `none`, `sha256:` plus 64 lowercase hex characters, or `git:` plus a
40- or 64-character lowercase commit hash. All receipts keep the start boundary unchanged.

When the response itself is structured, use one of the verifier-owned carriers instead of appending
invalid syntax:

- JSON whose schema permits an envelope: top-level `_mission` is an ordered array of
  `{"stage":"start","receipt":{...}}` through `terminate`; the domain result stays under
  `response`.
- YAML: prefix each normal receipt line with `# ` at column zero so the receipts remain YAML
  comments and cannot be mistaken for content inside a scalar.
- an immutable JSON or other exact schema that permits neither carrier: Contract is `blocked`;
  every later stage is `noop` or `blocked`, and Terminate reports the schema conflict. Do not
  silently omit the lifecycle or contaminate a claimed exact response.

For a response-only turn, use `candidate=none`; Build, Evaluate, and Handoff are `noop`. For a
repository candidate, Build, Evaluate, and Handoff are `done`, the endpoint is `merged`, and Handoff
does not complete until the exact evaluated Git commit is independently observed as the merged
head of the recorded GitHub pull request. `Mission-Handoff.effects` and
`Mission-Terminate.effects` must be identical and contain exactly one merge attestation:

```json
{"kind":"github_pull_request","url":"https://github.com/owner/repo/pull/1","state":"merged","head":"git:0000000000000000000000000000000000000000","merge":"git:1111111111111111111111111111111111111111"}
```

The Stop hook requires the PR repository to match the admitted checkout, re-reads the pull request,
and rejects a forged endpoint, head, merge commit, origin, workspace, repository, or effect. A
blocked mission may report no effect, or a GitHub PR effect whose open/merged state the hook can
re-read; an unverifiable external effect does not close. If any stage is `blocked`,
subsequent stages still run as `noop` or `blocked`, and Terminate uses
`acceptance=blocked / route=blocked`.

Only `Mission-Terminate` closes the mission. Handoff never closes it. For line and YAML carriers,
Terminate must be the last non-whitespace content in the final assistant message. For the JSON
carrier it must be the final `_mission` element. Later assistant output makes the mission active.

## Contract

Before investigation, set provisional discovery Scope, Authority, and total Stop. They may narrow;
expansion requires explicit authority. Separate repository facts from user-owned preferences or
external effects.

State the no-change counterfactual. Before Build or a consequential final decision, freeze:

```text
Outcome: user-observable result and delivery endpoint
Consumer: real user, system, or entry point that must exhibit it
Scope: included work, bounded discovery, and explicit non-goals
Authority: permitted effects and forbidden external actions
Acceptance: falsifiable consumer, regression, review, and delivery signals
Origin: immutable starting revision, tree, content, or diff identity
Stop: total revision, retry, wait, time, tool, or cost boundary
```

For an answer-only or exact-response turn, a minimal contract is enough. Emit
`Mission-Contract status=noop` only when the user supplied a complete, non-consequential answer
shape and no decision remains. Otherwise emit `done`.

Acceptance is the frozen oracle. A material change after Build starts routes to `replan`; never
weaken Acceptance to fit a candidate.

## Plan

Choose the smallest vertical change through an existing owner and real consumer. Inspect that path,
its implementation, tests, current behavior, and governing documentation. Resolve reuse before new
implementation.

Use the relevant method from [planning methods](references/planning-methods.md) only when needed.
For concentrated churn, use
[revision-pressure replan](references/revision-pressure-replan.md). For a GitHub endpoint, load
[GitHub PR handoff](references/github-pr-handoff.md).

Define the candidate, consumer exercise, regression checks, endpoint, and first condition forcing
`replan`. An implementation candidate cannot change the workflow, judge, policy, or reporting
authority that accepts it. Such work is a separate governance candidate with candidate-uncontrollable
acceptance evidence.

Planning may be `noop` for a direct response with no decision or action. Emit the receipt anyway.

## Build

Implement only the candidate required by the contract. Keep effects inside Authority. Give every
cumulative candidate a new immutable identity and inspect it before revision.

Build is `noop` when the mission needs no writable candidate. A no-op Build must use
`candidate=none`; do not create placeholder files, commits, or branches.

## Evaluate

For a writable candidate:

1. exercise the real consumer through its actual entry point;
2. inspect staged, unstaged, and untracked material;
3. falsify affected-boundary closure;
4. run the smallest authoritative regression checks;
5. bind raw evidence to the exact candidate.

Before accepting a non-mechanical writable candidate, complete a fresh-context, read-only review
through [reviewer handoff](references/reviewer-handoff.md). Use
[architecture sensor](references/architecture-sensor.md) only for material structural change,
cross-owner effects, or persistent patch pressure.

Evaluate is `noop` only when `candidate=none`. It must use the same candidate as Build.

## Handoff

Handoff always runs as a separate stage.

- `candidate=none`: emit `status=noop`, perform no commit or remote effect.
- repository candidate: audit candidate-controlled execution and secrets, commit only the exact
  candidate, push its branch, create a pull request, observe the required signals, and use the
  existing GitHub barrier for direct merge. Emit `status=done` only after the evaluated head is
  observed merged.
- missing authority, failed acceptance, or exhausted Stop: emit `status=blocked`; do not publish or
  bypass a failed barrier.

A changed remote candidate returns to Evaluate before Handoff can emit its receipt.

## Mission-Terminate

Terminate always runs after Handoff, including response-only and blocked missions.

1. bind the final candidate and all performed effects;
2. remove mission-created temporary resources;
3. delete mission-created local/remote branches and worktrees when their owner surface permits and
   they no longer carry unmerged work;
4. preserve unrelated pre-existing user changes;
5. emit exactly one `Mission-Terminate` receipt in the terminal position defined above.

`acceptance=passed` requires `route=accept`; `acceptance=blocked` requires `route=blocked`.
`cleanup=preserved` is allowed only with `route=blocked` and an explicit residual reason. Only
`accept` and `blocked` terminate. `revise` and `replan` continue inside the original Stop without a
Terminate receipt.

Before any assistant message that might otherwise end while stages remain incomplete, append no
terminal receipt. The Stop hook will continue the same turn once; if closure still fails, it stops
with an explicit lifecycle failure.

## Host boundary

Subagents receive one bounded evidence packet and never own the lifecycle route. A reviewer is fresh,
read-only, and uninvolved in Build.

Keep lifecycle semantics here. Agent definitions, tool mappings, hooks, and configuration are
projections. Verify each projection with both a response-only all-noop turn and a writable
Start-to-Terminate exercise.
