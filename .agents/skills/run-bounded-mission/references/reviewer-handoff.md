# Verify Reviewer Packet

Use this packet for the independent candidate audit required by `SKILL.md`. The main agent owns
findings, acceptance, effects, and Finalize; one evaluator returns evidence for one frozen risk lens.

## Freeze the launch

Freeze an exact commit, or a named Origin plus complete diff and untracked material, before launch.
Use a fresh non-builder context whose control plane is the immutable Origin or a neutral source the
candidate cannot change. When the candidate changes instructions, skills, agent definitions,
discovery, judges, or reviewer policy, supply it only as an object or complete diff; never launch
from its checkout or let it control automatic discovery.

Fingerprint immediately before dispatch:

- Origin and candidate commits, trees, parent set, complete binary diff, and changed-path list;
- every relevant Origin instruction, skill, agent, reviewer-policy, and consumer byte sequence;
- tracked status plus an ordered untracked manifest containing path, type, content hash, or symlink
  target for every entry; reject unsupported filesystem types.

Give no mutation or external-effect authority. A write-capable host surface is an observed risk, not
automatic unavailability: admit `integrity-checked` behavioral read-only review only when the packet
does so explicitly, then recompute every fingerprint after return. Reject mutation, candidate
mismatch, candidate-controlled policy or discovery, builder context, delegation, lateral
communication, external effects, or an incomplete packet. Integrity checks prove only the stated
repository audit, not sandbox isolation or absence of unobservable effects.

Observe the dedicated `mission_evaluator` route before dispatch. Launch it exactly once from the
frozen control plane. If it is invalid before inspection, or later reaches an explicit terminal
transport or capability failure without a valid audit return, use one fresh generic agent only when
that agent independently satisfies this entire packet. Record the changed route and
`enforcement_status=integrity-checked`; never retry the same route and context. An ambiguous
`running` state, elapsed time, or repeated wait is not proof of stall and does not authorize fallback.
With no valid route, return the precise unavailable capability and do not claim an audit.

## Dispatch locator first

Send only this compact packet. Repeat the exact frozen Frame and admitted Plan prose; do not copy
the transcript. Put object locators, the one lens, and replay bytes before supporting claims so the
evaluator can reject a mismatch without broad repository reading.

```text
Purpose: independent candidate audit

Locator
- Origin commit and review checkout:
- candidate commit, or Origin plus complete diff and untracked material:
- candidate fingerprint and changed paths:
- control-plane and worktree fingerprints:

Admission
- planned launch context: dedicated evaluator | fresh generic fallback
- instruction origin and automatic discovery boundary:
- enforcement required: sandbox-enforced | integrity-checked
- parent receipt route: <exact parent identity/tool, or unavailable>
- activation predicate and one independent risk lens:
- required inspected scope and compatible stop boundary:

Replay
- exact commands or supplied bytes for candidate binding:
- exact consumer/regression commands and expected evidence shape:
- evidence groups whose completion can emit progress:
- concurrently pending evidence and locator:
- unavailable or unchecked evidence:

Frozen Frame
- frame locator (exact prose):

Admitted Plan
- plan locator (exact prose):

Return
- required terminal schema: reviewer-handoff v1
- Stop:
```

The evaluator validates `Locator` and `Admission` before candidate inspection. When the host exposes
the named parent receipt route, it sends this single-line JSON immediately after that validation:

```json
{"schema":"mission-evaluator-receipt/v1","event":"admitted|unsupported","origin":"<oid>","candidate":"<oid-or-diff-sha256>","fingerprint":"<sha256>","evidence":"<admission fact or precise reason>"}
```

After admission, send a `progress` receipt through the same route only when a packet-named evidence
group actually completes. Use the same keys, set `event` to `progress`, and bind `evidence` to the
group plus its command status and artifact or output hash. Do not send periodic heartbeats. A newer
valid receipt proves evidence progress; an observed host state transition proves runtime progress;
`running` alone proves only process state. If the host cannot expose receipts, record
`receipt_route=unavailable`; do not infer evidence progress, stall, failure, or success from waits.

A final root gate is not a packet prerequisite when it consumes the same frozen candidate and does
not feed the audit question. Start it concurrently, mark it `pending concurrent fan-in`, and fan in
once. Keep work sequential only when one result is an admitted input to the other. Candidate changes
invalidate only affected evidence and the whole-candidate locator; never rerun unchanged gates.

## Audit and return

Inspect the complete changed surface, affected callers and consumers, supplied replay evidence, and
the governing Origin controls. Use the supplied commands or bytes first. Read other repository
content or history only when a demonstrated candidate claim requires it. Treat success labels and
caller rationale as claims. Actively try to refute each issue through callers, guards, validation,
and the consumer effect; ignore lexical, speculative, duplicate, pre-existing, or context-refuted
claims.

Return exactly:

```text
review_status: completed | partial | unsupported
frame_locator:
plan_locator:
activation_predicate:
candidate_locator:
observed_launch_context:
instruction_origin:
discovery_boundary:
observed_available_tool_surface:
independence_status: supported | compromised | unverified
enforcement_status: sandbox-enforced | integrity-checked
receipt_status: admitted | unsupported | unavailable
mutation_observation: none | observed | unverified
audit_results: signal, pass | fail | unverified, direct evidence
findings: severity (blocking | important | nit), failure_class (candidate_local | plan_failure |
  frame_failure), bounded causal claim, location, validation evidence, next action
inspected_scope:
limits:
```

`completed` means the audit ran, not that the candidate passed. Missing evidence is an `unverified`
result or limit, not a finding. Report one finding per root cause and assign severity only from its
demonstrated acceptance impact.

Classify a finding at the highest material boundary. It is not candidate-local when correction needs
a new owner, path, responsibility boundary, acceptance proxy, branch, exception, adapter, fallback,
parallel path, or affected boundary. An omitted or faulty implementation of structure already frozen
in the Plan remains candidate-local. Under architecture or revision pressure, compare the cumulative
candidate with Origin and the narrowest admitted alternative.

After return, the main agent recomputes every fingerprint, reopens decisive evidence, reproduces
material findings, and routes the coherent set by its highest boundary. Resolve conflicts by
provenance and consumer impact, never agent count. Do not send builder advocacy, hidden reasoning,
unrelated files, secrets, a suggested Mission route, or a Finalize decision.
