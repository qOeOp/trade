---
name: run-bounded-mission
description: "Run a compact Frame, Plan, Execute, Verify, Finalize workflow for explicitly invoked or repository-required non-trivial implementation and delivery work. Do not use for answer-only requests, mechanical edits, or routine status queries."
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

## Frame

Before mutation, state only what changes a decision:

- outcome and real consumer;
- included scope and explicit non-goals;
- permitted effects, especially commit, push, PR, deployment, scheduling, secrets, or live writes;
- falsifiable acceptance evidence;
- current Git origin and a practical stop condition.

Prefer no change, deletion, direct reuse, or a narrower behavior when it closes the outcome. Treat a
requested mechanism as a proposal when repository evidence shows that it is broader or harmful.
Repository history and external prior art are optional evidence: inspect them only when they can
materially change ownership, compatibility, or the implementation choice.

Identify a decision-changing domain premise only when an empirical, regulatory, market, or
mechanism claim could reverse the expected benefit, safe or legal scope, architecture, or acceptance
evidence. Bind the claim, its decision consequence, and supplied or repository evidence or exact
gap. User preferences, mechanical work, and repository authority without depending on current external truth do not activate domain research.

Keep independent outcomes separate. Use host-native task dispatch only after the user explicitly
asks for another task; do not turn an internal subtask into a user-visible task.

## Plan

Inspect the current owner, production entry point when one exists, affected contracts, tests, and
working-tree state. Choose the smallest vertical change that closes the outcome.

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
classification. Resolve reuse before new implementation:

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

Plan in ordinary prose. Content hashes and formal Frame or Plan identities are not required.

## Execute

Implement only the admitted change. Keep one writer for overlapping files and preserve unrelated
user work. The candidate is the mission-owned diff, not every staged, unstaged, or untracked file in
the checkout.

Do not perform commit, push, PR, merge, deployment, scheduling, live writes, or other shared-state
effects without authority for that effect.

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

Instruction and judge changes require review that does not rely on the changed rule to approve
itself. If the host cannot provide independent acceptance, the local candidate may still be prepared
and verified, but the limitation must be explicit and it must not be represented as independently
accepted or remotely delivered.

## Finalize

Lead with the user-visible result and exact effect state. Summarize changed paths, decisive checks,
and material limits. Do not emit lifecycle receipts, internal identities, generic follow-up work, or
a mandatory closing template.

Treat a completed outcome as `accept` only when the verified candidate and decisive evidence are
recoverably bound to its integrated commit or preserved local diff. This is an evidence handoff, not
a lifecycle ledger.

For local-only work, leave the verified diff recoverable and do not commit or publish it. For an
authorized remote endpoint, publish only the verified candidate and observe the resulting state.
When the endpoint includes a GitHub pull request, load
[GitHub delivery](references/github-pr-handoff.md) before publication or merge.
Use `No action needed` only when the user explicitly chose the completed local-only endpoint or when
delivery is complete and no preserved candidate awaits a user-owned delivery decision; for an implicit `local-only` stop with meaningful uncommitted or unpublished changes, use `Optional next step` and name the concrete available continuation, such as review, commit, pull request, or deployment authorization.

## Agent boundary

The main agent owns scope, implementation, evidence judgment, and final delivery. A subagent receives
one bounded question or non-overlapping file ownership, preserves other work, and cannot authorize
external effects. Agent count and revision count are never goals.
