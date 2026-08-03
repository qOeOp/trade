# Verify Reviewer Packet

Use this packet for the independent candidate audit required by `SKILL.md`. The main agent owns
findings, acceptance, effects, and Finalize; each evaluator returns evidence for one frozen risk lens.

## Freeze the launch

Freeze an exact commit, or a named Origin plus complete diff and untracked material, before launch.
Use a fresh non-builder context whose control plane is the immutable Origin or a neutral source the
candidate cannot change. When the candidate changes instructions, skills, agent definitions,
discovery, judges, or reviewer policy, supply it only as an object or complete diff; never launch
from its checkout or let it control automatic discovery.

Use one evaluator by default. Use the complementary pair only for a deterministic judge or helper
when both observed risks are material and decision-changing:

- `authority_representation`: it grants or denies authority or acceptance from an open, external, or
  normalized representation whose producer contract and unknown-value behavior must be challenged;
- `consumer_fail_close_closure`: that representation or result crosses multiple consumers, terminal
  or error paths, fail-close guards, or sibling parser or normalization paths.

For `authority_representation`, challenge raw and normalized forms plus the producer's unknown-value
policy. For `consumer_fail_close_closure`, first enumerate every decision-changing direct consumer of
the shared representation or result, then cross each admitted and refuting representation boundary
through those consumers. A standalone pass for an error or fail-close guard does not cover the case
where another parser, recognizer, or normalization path can suppress or trigger that guard.

Do not infer either risk from task size, file type, revision count, or a generic quality concern. If
only one risk exists, use one evaluator. Ordinary non-judge work may require no evaluator. All
packets in one audit set bind the same exact complete current Frame and Plan prose. A replan or
reframe invalidates every outstanding packet and return in that set even when candidate bytes do not
change; construct a new set from the complete replacement prose, never a delta or residual excerpt.

Choose one binding route from the frozen candidate form:

- For an exact committed candidate, immediately before dispatch run the repository-owned binding
  helper with the clean Origin control plane as its working directory. Use the helper script from
  Origin when Origin contains those bytes. Only when the candidate itself introduces or changes the
  helper may the main agent invoke that exact candidate script path for packet construction: bind its
  candidate commit, path, blob, and actual invocation argv, while keeping the working directory and
  automatic discovery at Origin. The evaluator never executes that candidate script; it inspects the
  helper diff and independently replays the emitted Git facts. Supply the repository identity,
  Origin, candidate, enforcement mode, and each relevant Origin instruction, skill, agent,
  reviewer-policy, and consumer file as a repeated `--required-file`:

```text
bun <helper-script> \
  --repository <owner/name> \
  --origin <origin> \
  --candidate <candidate> \
  --enforcement <sandbox-enforced|integrity-checked> \
  --required-file <repo-relative-path> [...]
```

- Require exit zero and one `mission-evaluator-binding/v1` JSON line with `status=bound`. Paste that
  line into the packet verbatim. Never transcribe, abbreviate, summarize, or manually replace its Git
  facts. The helper derives the complete commits, trees, actual parent set and Origin relationship,
  binary diff, changed paths, required blob hashes, clean tracked and non-ignored untracked candidate
  material, replay argv, and one binding fingerprint. Gitignored dependency or build material is not
  candidate material and is explicitly outside this attestation. A rejection freezes launch; do not
  repair its facts in prose or treat the binding as a full-filesystem or sandbox claim.
- For a local candidate, the commit helper does not apply. Bind the named Origin, complete binary
  diff, and an ordered manifest containing every non-ignored untracked path, filesystem type, file
  content hash, or symlink target. Reject unsupported filesystem types. Include the complete diff and
  manifest bytes plus their hashes in the packet, fingerprint the clean Origin review worktree, and
  repeat those exact bytes after return. Missing or changed candidate material freezes launch.

Give no mutation or external-effect authority. A write-capable host surface is an observed risk, not
automatic unavailability: admit `integrity-checked` behavioral read-only review only when the packet
does so explicitly, then recompute every fingerprint after return. Reject mutation, candidate
mismatch, candidate-controlled policy or discovery, builder context, delegation, lateral
communication, external effects, or an incomplete packet. Integrity checks prove only the stated
repository audit, not sandbox isolation or absence of unobservable effects.

Observe the dedicated `mission_evaluator` route before dispatch. Launch each admitted lens exactly
once from the frozen control plane. Across the whole audit set, use at most one fresh generic agent,
and only after a required dedicated route reaches an explicit terminal transport or capability
failure without a valid audit return. The generic agent must independently satisfy this entire
packet. A stale or contradictory Frame or Plan, packet or admission defect, unsupported evidence,
finding, ambiguous `running` state, elapsed time, or repeated wait never authorizes fallback. Record
the changed route and `enforcement_status=integrity-checked`; never retry the same route and context.
With no valid route for every required lens, return the precise unavailable capability and do not
claim an audit.

## Dispatch binding first

Send only this compact packet. Repeat the exact complete current frozen Frame and admitted Plan
prose; do not copy the transcript or an earlier packet. For a pair, serialize the shared core once
for measurement and give each evaluator that same core plus only its lens question and evidence
delta. Put object locators, the one lens, and replay bytes before supporting claims so the evaluator
can reject a mismatch without broad repository reading.

```text
Purpose: independent candidate audit

Binding
- committed candidate: exact `mission-evaluator-binding/v1` stdout line; or
- local candidate: named Origin, complete binary diff bytes and hash, ordered non-ignored untracked
  manifest bytes and hash, and clean Origin review-worktree fingerprint:
- when the candidate introduces or changes the helper: helper source commit, path, blob, and actual
  packet-construction argv; the evaluator treats the script as evidence and does not execute it:

Admission
- planned launch context: dedicated evaluator | fresh generic fallback
- instruction origin and automatic discovery boundary:
- parent receipt route: <exact parent identity/tool, or unavailable>
- audit set: single | complementary_pair; required lenses and common packet locator:
- activation predicate and assigned independent risk lens:
- required inspected scope and compatible stop boundary:

Replay
- committed candidate: independently compare every binding Git object and fingerprint; rerun its
  exact argv when the helper belongs to Origin, or inspect the helper diff and replay the Git facts
  without executing candidate-controlled code when the helper itself is under review:
- local candidate: independently hash the supplied complete diff and untracked manifest bytes and
  compare the named Origin and clean review-worktree fingerprint without executing candidate code:
- required independent terminal evidence: each causal claim to resolve, its exact command or bytes,
  expected evidence shape, and the representative refutation that closes it:
- main/CI-owned corroboration, not an evaluator prerequisite:
- optional supporting claims, unchecked unless one is the only oracle for this lens:
- concurrently pending evidence and locator:
- unavailable or unchecked evidence:

Frozen Frame
- frame locator (exact complete current prose):

Admitted Plan
- plan locator (exact complete current prose):

Return
- required terminal schema: reviewer-handoff v1
- Stop:
```

The evaluator validates `Locator` and `Admission` before candidate inspection. When the host exposes
the named parent receipt route, it sends this single-line JSON immediately after that validation:

```json
{"schema":"mission-evaluator-receipt/v1","event":"admitted|unsupported","origin":"<oid>","candidate":"<oid-or-diff-sha256>","fingerprint":"<sha256>","evidence":"<admission fact or precise reason>"}
```

After admission, send a `progress` receipt through the same route only when a packet-named required
prerequisite actually completes. Use the same keys, set `event` to `progress`, and bind `evidence` to
the prerequisite plus its command status and artifact or output hash. Do not send periodic
heartbeats. Terminal return takes precedence: once the required independent evidence is resolved,
return it instead of sending another receipt or starting corroborative or optional work. A newer
valid receipt proves evidence progress; an observed host state transition proves runtime progress;
`running` alone proves only process state. If the host cannot expose receipts, record
`receipt_route=unavailable`; do not infer evidence progress, stall, failure, or success from waits.

A final root gate is not a packet prerequisite when it consumes the same frozen candidate and does
not feed the audit question. Start it concurrently, mark it `pending concurrent fan-in`, and fan in
once. Keep work sequential only when one result is an admitted input to the other. Candidate changes
invalidate only affected evidence and the whole-candidate locator; never rerun unchanged gates.

Launch a complementary pair concurrently after the shared binding and packet core freeze. Neither
lens receives, waits for, or cites its sibling's output. Fan in once, then reject any return whose
audit-set identity, common packet locator, candidate, or complete Frame and Plan prose no longer
matches the current audit set. Classify audit
evidence before routing: a demonstrated implementation defect is `candidate_finding`; contradictory
or stale governing prose is `frame_plan_drift`; a malformed or mismatched packet is
`packet_admission_defect`; missing probative material is `unsupported_evidence`. The main agent alone
classifies a return from an older set as `stale_packet` and an observed host-level terminal transport
or capability failure as `terminal_transport_failure` or `capability_failure`.

## Audit and return

Independently inspect the complete changed surface, affected consumer closure, and governing Origin
controls, then run only the required terminal evidence. Causal coverage requires a representative
refutation for every distinct candidate mechanism, relevant terminal path, and fail-close guard in
the one lens; corpus size does not make evidence required. Do not repeat the main agent's broad
matrix or raw corpus unless it is the only oracle for a required claim. Use supplied commands or
bytes first, and read other content or history only when a required claim makes it probative. Treat
success labels and caller rationale as claims; actively refute them through callers, guards,
validation, and consumer effects. Ignore lexical, speculative, duplicate, pre-existing, or
context-refuted claims. Do not stop at the first material finding: continue through the admitted
causal sibling closure and return every distinct material root in the lens. Return the terminal
immediately when the complete scope and required causal claims are resolved; do not extend into
main-owned corroboration or optional supporting claims.

Return exactly:

```text
review_status: completed | partial | unsupported
result_class: no_finding | candidate_finding | frame_plan_drift | packet_admission_defect |
  capability_failure | unsupported_evidence
frame_locator:
plan_locator:
audit_set:
common_packet_locator:
activation_predicate:
assigned_risk_lens:
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

`completed` requires the complete changed surface and affected consumer closure plus every required
independent item resolved as pass or fail; it means the audit ran, not that the candidate passed.
Use `partial` when an admitted audit leaves a required item unverified, and `unsupported` when the
binding, independence, or capability cannot admit the audit. Match `result_class` to direct evidence;
unsupported evidence is not a candidate finding. Identify each unverified item and its boundary
precisely. Neither status is acceptance evidence. Missing evidence is an `unverified` result or
limit, not a finding. Report one finding per root cause and assign severity only from its demonstrated
acceptance impact.

Classify a finding at the highest material boundary. It is not candidate-local when correction needs
a new owner, path, responsibility boundary, acceptance proxy, branch, exception, adapter, fallback,
parallel path, or affected boundary. An omitted or faulty implementation of structure already frozen
in the Plan remains candidate-local. Under architecture or revision pressure, compare the cumulative
candidate with Origin and the narrowest admitted alternative.

After return, the main agent recomputes every fingerprint, verifies the complete Frame and Plan
binding, reopens decisive evidence, reproduces material findings, and routes the coherent set by its
highest boundary. Consume the returns as competing evidence: deduplicate shared roots and resolve
conflicts by current authority, provenance, and consumer impact, never agent count. A stale return
cannot defeat a current clean result, but acceptance remains fail-closed until every required current
lens is valid. Do not send builder advocacy, hidden reasoning, unrelated files, secrets, a suggested
Mission route, or a Finalize decision.
