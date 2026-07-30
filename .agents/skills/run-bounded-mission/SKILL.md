---
name: run-bounded-mission
description: "Run every root user message through one bounded Mission-Start, Contract, Plan, Build, Evaluate, Handoff, and Mission-Terminate lifecycle. Use for all repository turns, including answer-only and mechanical requests; stages without work are explicit noop stages."
---

# Run Bounded Mission

Run every root user message exactly once through:

```text
Mission-Start -> Contract -> Plan -> Build -> Evaluate -> Handoff -> Mission-Terminate
```

A stage may be `done`, `noop`, or `blocked`; never omit one. The main agent owns the lifecycle.
Hooks enforce admission, the standard write gate, and termination; they do not plan or orchestrate.

## Receipts

Use the `turn_id` supplied by `UserPromptSubmit`. Emit each receipt once after its stage finishes:

```text
Mission-Start: {"turn_id":"<turn>","status":"done"}
Mission-Contract: {"turn_id":"<turn>","status":"done"}
Mission-Plan: {"turn_id":"<turn>","status":"done"}
Mission-Build: {"turn_id":"<turn>","status":"noop"}
Mission-Evaluate: {"turn_id":"<turn>","status":"noop"}
Mission-Handoff: {"turn_id":"<turn>","status":"noop"}
Mission-Terminate: {"turn_id":"<turn>","status":"done"}
```

Receipts are standalone lines outside code fences. Use only `done`, `noop`, or `blocked`.
`Mission-Terminate` is the last non-whitespace line of the final assistant message. A Stop
continuation resumes the same turn and never emits a second receipt.

## Mission-Start

Bind the immutable origin, intended endpoint, workspace, and one total Stop. For writable work,
reuse the host-created task worktree or create one sibling worktree and target every later repository
tool at it. Never modify an unrelated dirty checkout. If isolation is required but unavailable,
block.

For answer-only work, the endpoint is the response and no worktree is needed. For repository
changes, use the project-authorized PR endpoint.

## Contract

State the smallest user-visible outcome, consumer, provisional scope, authority, acceptance, origin,
and total Stop. Keep factual investigation separate from user-owned choices. Scope may narrow;
expansion requires user authority.

Before Build, freeze:

```text
Outcome:
Consumer:
Scope:
Authority:
Acceptance:
Origin:
Stop:
```

Do not weaken Acceptance or reset Stop after Build begins.

## Plan

Make Plan a user-facing design conversation:

1. **Understand** — restate the outcome, constraints, and current assumptions.
2. **Clarify** — ask one high-leverage question at a time when a user-owned choice matters.
3. **Explore** — present materially different viable options only when a real choice exists.
4. **Compare** — explain consumer impact, tradeoffs, reversibility, and verification cost.
5. **Align** — recommend one path and incorporate the user's correction or approval.
6. **Freeze** — emit the executable change set, acceptance checks, endpoint, and Stop.

Every Plan is visible. An exact mechanical request uses a short mini-plan and proceeds without an
extra approval prompt. A product, architecture, experience, authority, or acceptance choice requires
explicit user alignment before Build. In Plan mode, use the host's structured question surface when
available. Outside Plan mode, return one smallest question; later stages are `noop`, terminate the
turn, and use the next user message to continue from the answer.

Repository inspection and current-source research support this conversation; they do not replace it.
Use [planning methods](references/planning-methods.md) only for a decision-changing gap. Do not create
options, agents, or research lanes merely to make Plan look substantial.

The standard file-write hook opens only after a current-turn `Mission-Plan status=done` receipt.

## Build

Implement only the frozen vertical change through an existing owner and real consumer. Keep one
writable candidate. Prefer direct edits over new layers and delete superseded paths.

The standard Build write window is 30 minutes from `UserPromptSubmit`. `PreToolUse` denies
`apply_patch` before Plan completion, in Plan mode, or after that window. This is a practical
repository guardrail, not a security boundary: specialized and hosted tools may bypass local hooks.

Allow one local correction when the design still holds. A design-invalidating finding, repeated
failure, or additive correction ends the current mission as `blocked`; propose a new Plan in the next
user turn instead of looping through replan and Build.

## Evaluate

Exercise the real consumer, inspect the complete candidate, and run the smallest authoritative
regression checks. Bind evidence to the exact candidate.

Use one focused evaluation wave. Add independent lenses only when Acceptance contains genuinely
independent risks. A candidate change invalidates earlier evidence but does not create an unlimited
review cycle. For `candidate=none`, Evaluate is `noop`.

## Handoff

Run Handoff separately:

- Response-only: `noop`, with no commit or remote effect.
- Repository candidate: commit the exact evaluated candidate, push, create a PR, observe required
  checks, and use the existing GitHub handoff barrier for an authorized merge.
- Missing authority, failed Acceptance, remote drift requiring code changes, or exhausted Stop:
  `blocked`; never publish around the failure.

Pending remote work remains inside the original Stop. Handoff never resets the budget.

## Mission-Terminate

Terminate every mission, including response-only and blocked missions:

1. report the outcome, candidate, decisive evidence, and performed effects;
2. remove mission-created temporary resources;
3. delete merged or abandoned mission branches and worktrees when safe;
4. preserve unrelated user changes;
5. emit the terminal receipt last.

Only accepted or blocked missions terminate. Preserve cleanup residue only when blocked and report
the exact reason.

## Host boundary

`UserPromptSubmit` admits each root turn. `PreToolUse` guards standard file edits. `Stop` validates
the ordered receipts and allows one completion continuation. Add `PostToolUse`, compaction, session,
or subagent hooks only for a demonstrated missing behavior; they are not lifecycle stages.

Only when maintaining, auditing, or explaining this workflow, load
[lifecycle shape](references/lifecycle-shape.md).
