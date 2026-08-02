---
name: run-bounded-mission
description: "Run a compact Frame, Plan, Execute, Verify, Finalize workflow. Use only when the user affirmatively invokes the exact token $run-bounded-mission, clearly asks to use or run the bounded mission workflow, repository instructions require it for non-trivial implementation or delivery, or a later commit, push, pull-request, or merge turn continues a candidate produced under this workflow. Quoting, naming, linking, inspecting, auditing, explaining, diagnosing, or negating the token, skill name, or path is not invocation. Without one of those positive entries, do not use it for answer-only work, mechanical edits, routine status, task management, or internal subtasks. An affirmative explicit invocation wins over otherwise excluded request types, including when appended to the request."
---

# Run Bounded Mission

Use one lightweight lifecycle:

```text
Frame → Plan → Execute → Verify → Finalize
```

Stages and their locators are conversation evidence only. Do not persist workflow identity or state,
or create coordinators or helper code, unless the requested product behavior needs them. The
frontmatter description alone owns entry classification; this body starts after entry.

The main agent owns Frame, Plan admission, the writable candidate, evidence judgment, effects, and
Finalize. Support lanes receive bounded work and return evidence or proposals; they cannot authorize
effects, admit a Plan, accept a candidate, or choose a route.

## Frame

Immediately after entry and before any decision-changing probe or candidate mutation, emit this
visible locator:

```text
Frame projection
Outcome / consumer: <observable result; real consumer>
Included / excluded: <scope; non-goals>
Authority / effects: <canonical authority; permitted and prohibited effects>
Acceptance: <falsifiable and unavailable evidence>
Origin / Stop: <current origin; finite evidence-backed stops>
```

Use ordinary prose in populated labels; never substitute unlabelled prose or omit
decision-changing Frame content. The raw request and repository or user authority remain canonical;
the locator cannot repair skill entry or add authority, identity, or lifecycle state.

Treat these fields as the current Frame. Change a material field explicitly before continuing; do
not silently widen scope, authority, acceptance, or the stop condition.

Prefer no change, deletion, direct reuse, or a narrower behavior when it closes the outcome. These
are solution-selection principles, not acceptance or routing oracles. Treat a requested mechanism
as a proposal when repository evidence shows that it is broader or harmful.

Treat line, file, diff, step, agent, and revision counts only as diagnostics unless the user makes
one the observable Outcome; never let them decide admission, Stop, a route, or acceptance. The same
rule applies to child packets. Compression cannot trade away required behavior, consumer evidence,
dynamic verification, readability, or boundary closure. Judge minimality by removing unconsumed
owners, duplicate authority or state, branches, adapters, exceptions, indirection, and superseded
paths—not by net diff.
When bounded history for named paths can change the origin, no-change counterfactual, owner, scope,
removed invariant, or regression hypothesis, first record `git rev-parse --is-shallow-repository`,
then select commits from the repository root:
`GIT_NO_LAZY_FETCH=1 GIT_TERMINAL_PROMPT=0 git --literal-pathspecs log --no-merges --date-order
--since '<date>' --until '<date>' --max-count=<limit+1> --format='%H%x09%aI%x09%cI%x09%an%x09%s%x09%P'
--end-of-options '<revision-or-range>' -- '<repo-relative-path>'...`.
Every Git call in this discovery carries the same two environment variables.
Pass every revision, date, and path as its own shell-quoted argument; never leave or interpolate one
unquoted.
Name finite, narrow files or directories below the root. Retain at most `<limit>` commits and record
an extra result as commit truncation. For each retained non-boundary commit, run
`git --literal-pathspecs diff --numstat --find-renames --end-of-options '<first-parent-or-empty-tree>'
'<commit>' -- '<repo-relative-path>'...`; obtain a root commit's empty tree with
`printf '' | git hash-object -t tree --stdin`. With shell `pipefail` enabled, pipe every non-NUL
numstat stream through `awk -v limit='<remaining-file-limit+1>' 'NR <= limit'`, which drains Git but
emits at most that many file rows. If it emits the extra row, discard that row, record file
truncation, and stop; otherwise subtract the emitted row count from the remaining limit and continue.
When merge evidence matters, replace `--no-merges` with `--full-history` and compare each merge only
with its first parent. Add `--follow` only for one file, use the same commit bound, inspect each commit
with `git --literal-pathspecs log -1 --follow --format= --numstat --find-renames --end-of-options
'<commit>' -- '<current-path>'`, and carry a rename's old path backward.
When the repository is shallow, read OIDs from the shell-quoted path returned by
`git rev-parse --git-path shallow`; mark each matching selected commit and its numstat unavailable,
exclude it from decisions, and warn that earlier or parent history may be unavailable. Treat any
nonzero pipeline or Git exit as insufficient evidence. History never replaces current consumer
evidence.

When an unresolved fact could change the candidate, consumer behavior, authority, acceptance, or a
hard-to-reverse choice, load [consequential ambiguity](references/plan-ambiguity.md).

Keep independent outcomes separate and never turn an internal subtask into a user-visible task. Load
[Codex task dispatch](references/task-dispatch.md) for separate task creation, an existing child, a
separately valuable follow-up, or multi-Mission operation; it owns proposal and consent requirements.

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
- `Plan → Execute`: the owner, path, affected boundary, candidate shape, verification route, and every
  required Plan action binding are admitted, and no decision-changing premise remains unresolved;
- `Execute → Verify`: the admitted candidate is complete and its full mission-owned diff is
  available, including untracked candidate material;
- `Verify → Finalize`: decisive passes, failures, and unavailable evidence have been recorded
  against the current candidate;
- `Finalize → accept`: acceptance is satisfied and bound to a recoverable diff or integrated commit.

All other continuation freezes mutation and unissued effects, enters Finalize, and takes exactly one
route under the highest-boundary order below. A cancellation override may instead terminate directly
after effects are frozen.

### Routing, Stop, and convergence

Frame must select observable stopping predicates. Counts and budgets are diagnostic and never decide
`accept`, `revise`, `replan`, `reframe`, or `blocked`.

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

After compaction or on a later turn, continue only when conversation and Git evidence reconstruct the
same Mission. When recovery materially requires it, reproduce the current projections and retain the
exact candidate and effects, decisive evidence, current position and next legal operation, observed
Stop predicates, and any valid Resume stage. Locators are conversation evidence, not workflow state.

Before continuing, match the Frame and Plan prose, origin, candidate/effects, Stop predicates, next
legal operation, and any resumable stage. If they cannot exclude a different Mission or candidate,
freeze before mutation or effects and obtain the missing user-owned fact or take the evidenced route.
An exactly recovered temporary `blocked` Mission re-enters its named `Resume` stage only after changed
evidence removes the blocker; terminal predicates follow the routes above. Multi-Mission recovery
also follows task dispatch.

## Plan

Inspect the current owner, production entry point when one exists, affected contracts, tests, and
working-tree state. Choose the smallest vertical change that closes the outcome.
Before freezing the candidate shape, name the consumer invariant and each representation axis the
candidate relies on, then ask who closes its value or state space. Admit the axis only when a located
authority makes it semantically relevant to the consumer contract. When the candidate enumerates or
otherwise depends on its values or states, also require that authority either makes the exact
representation part of the consumer contract or defines an exhaustive domain bound to a named
version with an unknown-value policy. Samples, fixtures, local enums, observed payloads, current path
presence, configuration declarations, and tool availability do not close a space by themselves. If
a compatible unseen or changed representation can reach the same consumer outcome without all
required authority, reject the candidate and remain in Plan.
When that evidence invalidates an admitted Plan, route it through [revision-pressure
replan](references/revision-pressure-replan.md).
For every nontrivial admitted Plan, immediately before Execute emit this compact visible locator:

```text
Plan projection
Owner / path: <existing owner; exact paths>
Boundary: <affected consumers and contracts; frozen write surface>
Candidate: <smallest responsibility and behavior shape>
Verification: <consumer and owner checks; final gate; unavailable evidence>
Dependencies / action bindings: <prerequisites; effect owner and authority; capability or gate>
```

Use ordinary prose in populated labels; never substitute unlabelled prose. A tiny
Mission with no decision-changing Plan emits only the Frame locator and loads no heavy reference.
Plan is read-only. Admit the owner, path, affected boundary, candidate shape, and verification route
before mutation. For every required nontrivial action outside the main agent's ordinary observed
capability, also bind its execution owner and exact effect and authority, plus either the necessary
capability observed at the stage where the action must run or a named, owned later-stage fail-closed
gate. An inherently candidate-bound capability may use such a gate after Execute; Plan must not claim
that its candidate locator or capability is already proven. If neither current capability nor such a
gate exists, remain in Plan with the necessary capability evidence unavailable. These are the
required Plan action bindings. Freeze the mission-owned boundary against the named Origin and the
observed pre-existing user work instead of admitting paths later from Execute. When any Plan field
remains unresolved, keep investigating or return to Frame.

When a test failure can change the candidate, an escaped defect shows that tests missed required
behavior, or the Mission may restructure tests, load
[test effectiveness governance](references/test-effectiveness-governance.md) before mutation.

After Mission entry and before solution or reuse research, activate domain-premise classification
solely when an empirical, regulatory, market, or mechanism claim could reverse the affected Plan
decision's expected benefit, safe or legal scope, architecture, or acceptance evidence. Apparent size
or routine shape never overrides that consequence, including for an explicitly invoked small or
routine-shaped Mission.
Repository-settled facts, user preference or authority, and mechanical work do not activate it.
Without an affirmative Mission entry, genuine no-Mission work and ordinary routine status remain
outside this body under the frontmatter entry contract. Inspect repository and supplied evidence
first. If current external evidence remains necessary, load
[consequential ambiguity](references/plan-ambiguity.md) and resolve only that delta before Plan, then
bind the claim, consequence, evidence or gap, and classification to the affected Plan decision:

- `supported`: continue with the bounded implementation;
- `testable_hypothesis`: validate before dependent implementation;
- `contradicted`: reject or reframe before solution search;
- `unknown`: block only the decision that depends on it.

When external reuse evidence can change the owner or path, load
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

Load [viable alternatives](references/plan-alternatives.md) only when materially different credible
paths remain. Load [independently falsifiable slices](references/plan-slices.md) only when the route
needs separable candidate shapes or stopping evidence.

Load [evidence assessment matrices](references/mission-assessment.md) before mutation only for an
explicitly requested scored report, a named multi-Mission quality decision the comparison can change,
or an optimization/refactor that must distinguish local gain from system regression. It owns the
conditional baseline and terminal reassessment, adds no stage or acceptance owner, and never activates
from Mission count, task size, or generic quality alone.

Projection values remain ordinary prose. Downstream packets quote or navigate only their relevant
current fields and raw evidence locators instead of copying the transcript; only an evaluator needs
the exact Frame, Plan, and candidate bindings defined by its reviewer packet.

## Execute

Implement only the admitted change. Keep one writer for overlapping files and preserve unrelated
user work. The candidate is the mission-owned diff, not every staged, unstaged, or untracked file in
the checkout.

Do not perform commit, push, PR, merge, deployment, scheduling, live writes, or other shared-state
effects without authority for that effect.

After the main agent reproduces and classifies a material finding as candidate-local, keep a directly
obvious one- or two-line correction in the main context. Only when the frozen correction could be a
low-risk mechanical leaf whose execution saving may exceed its coordination cost, load
[agent lane routing](references/support-lanes.md) before editing; it owns `fast_builder` admission,
exact-model observation, and standard-main fallback. Finding judgment, the Mission route, and the
revision count never select that lane.

Route findings by the highest-boundary rule above. When revision pressure activates, load
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

Do not keep repository tests for this skill's instructions or bundled helpers; validate them through
actual helper calls in real Missions and hub observation, and fix the real owner on an observed failure.

A candidate change invalidates only evidence affected by that change. Reuse read-only discovery and
unaffected checks only when their evidence-specific affected inputs, source and dependency inputs,
proven consumer closure, configuration, toolchain, and environment remain identical; track the
changed whole-candidate locator separately. A full root gate is candidate-bound: run it on the final
integrated candidate and repeat it only when an input actually changes or a failure is corrected,
never because a run-count budget was reached.

Release Verify work from immutable inputs, not another lane's completion. When the final root gate
and a required independent audit both consume the same frozen candidate locator and neither needs the
other's output, create the exact commit or named-Origin complete diff and untracked manifest first,
launch both concurrently, and fan in once. Do not wait for root completion merely to create the
evaluator locator; mark that root result as pending concurrent evidence in its packet. If one output
is an admitted input to the other, keep that dependency sequential. Candidate mutation invalidates
only the evidence whose inputs changed.

Use [architecture sensor evidence](references/architecture-sensor.md) only for material structural
change, cross-owner effects, or persistent patch pressure.

When a frozen candidate has two or more mutually independent, decision-changing risk questions,
use the advisory candidate-lens contract in agent lane routing and activate only the needed lenses.
Their returns are untrusted leads for main-agent reproduction, never independent acceptance or votes.

Instruction and judge changes activate an independent candidate audit. Load
[the Verify reviewer packet](references/reviewer-handoff.md); it owns the fresh non-builder context,
Origin-bound policy, exact candidate, dedicated-first fallback, and integrity gates. Advisory lanes
never substitute, and the main agent must reproduce findings. If no valid audit survives those gates,
report the limitation and do not claim independent audit or remote delivery.

## Finalize

Choose one evidence-backed route under the highest-boundary rule above; do not weaken acceptance to
manufacture `accept`.

Lead with the user-visible result and exact effect state. Summarize changed paths, decisive checks,
and material limits. Do not emit lifecycle receipts, internal identities, generic follow-up work, or
a mandatory closing template.

Treat a completed outcome as `accept` only when the verified candidate and decisive evidence are
recoverably bound to its integrated commit or preserved local diff.

For local-only work, leave the verified diff recoverable and do not commit or publish it. For an
authorized remote endpoint, publish only after the evidence required by its delivery contract; a
publication is not acceptance. A GitHub `merge-ready` or `merged` route may publish its bounded
pre-root discovery head only as that reference permits, then must Verify the final candidate before
its endpoint. Treat later commit, push, PR, or merge authority as the owning Mission's Finalize. For
a multi-Mission node ending `merged`, task dispatch projects child delivery as `merge-ready`: child
Finalize accepts that terminal handoff, while hub Finalize owns merge and node closure. Reload this
skill instead of a generic publication workflow.
When the endpoint includes a GitHub pull request, load
[GitHub delivery](references/github-pr-handoff.md) before publication or merge.
When a Mission owns post-merge cleanup for a GitHub pull request, load the same reference before
inventorying or changing any cleanup target.
When an evidence assessment was activated, follow its same-rubric terminal-locator and reassessment
contract. Scores remain diagnostic; route an independently valuable gap through task dispatch instead
of extending the accepted outcome or graph.
After two or more related Missions are accepted and integrated into the canonical tip, and every
related node in the current completion boundary is terminal, load
[Refactor Mission proposals](references/refactor-mission-proposal.md) only for concrete structural
evidence. Count alone is insufficient and any proposal needs new user approval. In multi-Mission
work only the hub loads it after checkpoint reconciliation; otherwise the main agent owns the
decision. A child only reports terminal evidence.
