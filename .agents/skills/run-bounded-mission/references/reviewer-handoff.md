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
only one risk exists, use one evaluator. Ordinary non-judge work may require no evaluator. `audit_set`
is only the human-readable `single | complementary_pair` mode. The immutable, content-addressed
`common_packet_locator` is the set identity. For a committed candidate, use the packet helper below;
never serialize the shared core, lens manifest, hashes, or dispatch frames by hand. It hashes the exact
shared-core JSON-LF bytes containing the candidate locator, complete current Frame and Plan prose,
mode, ordered required lens names and delta manifest, control-plane/binding identity, and packet-helper
identity. A replan, reframe, or lens-delta correction invalidates every outstanding packet and return
in that set even when candidate bytes do not change; rerun the helper from complete replacement
semantic input after candidate freeze.

Choose one binding route from the frozen candidate form:

- For an exact committed candidate, immediately before dispatch run the repository-owned packet
  helper with the clean Origin control plane as its working directory and a fresh canonical absolute
  output directory. It invokes the Origin binding helper, embeds that exact
  `mission-evaluator-binding/v1` line, and materializes one content-addressed read-only artifact per
  lens. Use the packet helper from Origin when Origin contains the exact bytes. Only when the candidate
  introduces or changes it may the main agent invoke that exact candidate script path from the clean
  Origin working directory. The helper binds its commit, fixed path, Git blob, runtime bytes, and
  actual invocation argv. An evaluator may execute only the helper bound to its immutable instruction
  Origin. For a helper under review, inspect its complete diff and disposable behavior without
  executing it as independent policy; a fresh-context candidate-helper run is only non-authorizing
  pre-merge consumer evidence. Supply the repository identity, Origin, candidate, enforcement mode,
  and each relevant control file as a repeated `--required-file`:

```text
bun <packet-helper-script> materialize \
  --output-directory <fresh-canonical-absolute-directory> \
  --repository <owner/name> \
  --origin <origin> \
  --candidate <candidate> \
  --enforcement <sandbox-enforced|integrity-checked> \
  --required-file <repo-relative-path> [...] < canonical-packet-input.json
```

- Require exit zero and parse stdout as the single canonical `mission-evaluator-artifact-set/v1`
  locator frame below. The nested binding still derives the complete commits, trees, actual parent set and Origin
  relationship, binary diff, changed paths, required blob hashes, clean tracked and non-ignored
  untracked candidate material, replay argv, and one binding fingerprint. Gitignored dependency or
  build material remains outside this attestation. Any nonzero exit or `status=rejected` freezes
  launch; do not repair its facts or bytes in prose or treat the binding as a full-filesystem or
  sandbox claim.
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

## Materialize and admit exact artifacts

Send the helper one canonical JSON UTF-8 LF input frame with this exact field order and no unknown
fields. Supply the complete current Frame and Plan prose, not transcript excerpts. The main agent
chooses every semantic value; the helper only validates and serializes it.

```json
{"schema":"mission-evaluator-packet-input/v1","frame":"<exact complete Frame projection>","plan":"<exact complete Plan projection>","audit_set":"single|complementary_pair","admission":{"planned_launch_context":"<dedicated evaluator or fresh generic fallback>","instruction_origin":"<immutable source>","automatic_discovery_boundary":"<exact boundary>","parent_receipt_route":"<exact route or unavailable>"},"replay":{"main_ci_corroboration":"<not an evaluator prerequisite>","optional_supporting_claims":"<separately named optional claims or none>","concurrently_pending":"<evidence and locator or none>","unavailable_evidence":"<exact unavailable or unchecked evidence>"},"lenses":[{"name":"authority_representation|consumer_fail_close_closure","activation_predicate":"<exact predicate>","required_inspected_scope":"<exact scope>","required_terminal_evidence":"<claims, commands or bytes, and expected evidence>","representative_refutation":"<exact refutation>","stop":"<compatible Stop>"}]}
```

`single` contains exactly one named lens. `complementary_pair` contains
`authority_representation`, then `consumer_fail_close_closure`. Duplicate, unknown, missing, or
reordered lenses reject. The helper also rejects noncanonical input JSON, invalid UTF-8, unpaired
surrogates, unknown or missing fields, duplicate CLI facts, stale candidate/binding facts, unsupported
modes, dirty control planes, and runtime helper/blob drift. It preserves semantic strings exactly.

On success, stdout is one compact canonical artifact-set JSON-LF frame. Each ordered locator contains
only its canonical absolute artifact path, exact byte size, whole SHA-256, human-readable audit-set
mode, assigned lens and delta SHA-256, common locator, candidate locator, and admission-helper
commit/path/blob/SHA-256/size. The artifact
filename is its whole digest plus `.dispatch`; creation is exclusive and mode `0400`. The artifact is
the existing `mission-evaluator-dispatch/v1` header followed by exact ordered `binding`, `shared_core`,
and assigned `lens_delta` segments. Do not send artifact bytes or rebuilt fields to the evaluator.

The shared core is canonical `mission-evaluator-shared-core/v1` JSON LF. Its SHA-256 is the exact
`common_packet_locator`; it binds the complete Frame and Plan plus their UTF-8 sizes/digests, audit
mode, ordered lens set and manifest, candidate/control-plane/binding identity, packet-helper identity,
admission facts, and set-wide replay facts. Each lens delta is canonical
`mission-evaluator-lens-delta/v1` JSON LF and contains only its assigned name, activation predicate,
scope, terminal evidence, representative refutation, and Stop. No packet-set payload copy exists
without a consumer: a single has one dispatch; a pair repeats binding/shared-core bytes exactly once
for each independently consuming evaluator.

Send one compact locator to its assigned evaluator. Before candidate inspection, the evaluator runs
the immutable-Origin helper once with `admit` and the locator's exact facts:

```text
bun <Origin-packet-helper> admit --artifact <absolute-path> --size <bytes> --sha256 <whole> \
  --audit-set <single|complementary_pair> \
  --assigned-risk-lens <lens> --assigned-lens-delta-sha256 <digest> \
  --common-packet-locator <digest> --helper-commit <oid> --helper-path <repo-relative-path> \
  --helper-blob-oid <oid> --helper-blob-sha256 <digest> --helper-size <bytes> \
  --candidate-locator <commit:oid>
```

The helper opens without following symlinks, requires a read-only regular file and stable path/file
identity, reads exact bytes, and verifies size, content-addressed name, whole digest, canonical header,
fixed segment order and sizes, exact EOF, and every raw digest before decoding any segment. It then
requires canonical UTF-8 JSON-LF with exact fields and rebinds expected lens/delta/common locator,
admission-helper blob/runtime identity, the artifact's independently bound packet-helper blob,
candidate, control plane, binding fingerprint, Frame/Plan bytes, and lens manifest. Unknown fields,
unsupported file types, drift, truncation, corruption, appended bytes,
reordering, or any mismatch returns nonzero `status=rejected` before inspection. Only
`mission-evaluator-artifact-admission/v1 status=admitted` exposes decoded canonical data.

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

After the exact candidate is frozen, materialize and admit one helper-produced artifact set; only then
launch its complementary locators concurrently. Neither lens receives, waits for, or cites its
sibling's output. Fan in once, then reject any return whose mode,
content-addressed common packet locator, candidate, complete Frame and Plan prose, or required
member/lens set no longer matches the current audit set, or whose assigned delta digest does not
match the core manifest. Classify all audit evidence before routing: a demonstrated implementation
defect is `candidate_finding`; contradictory
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
result_classes: [no_finding] | ordered non-empty subset of [candidate_finding, frame_plan_drift,
  packet_admission_defect, capability_failure, unsupported_evidence]
frame_locator:
plan_locator:
audit_set:
common_packet_locator:
activation_predicate:
assigned_risk_lens:
assigned_lens_delta_sha256:
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
binding, independence, or capability cannot admit the audit. Return every directly evidenced class
in the fixed schema order; `[no_finding]` is valid only when no other class or material finding exists.
Unsupported evidence is not a candidate finding, but it may coexist with a finding or Frame/Plan
drift when different required items support those classes. Identify each unverified item and its
boundary precisely. Neither status is acceptance evidence. Missing evidence is an `unverified`
result or limit, not a finding. Report one finding per root cause and assign severity only from its
demonstrated acceptance impact.

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
