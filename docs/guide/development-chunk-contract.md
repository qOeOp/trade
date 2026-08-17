# Development Chunk Contract

This page is the reusable planning envelope for one agent development loop. It translates the global
architecture into a bounded implementation target without freezing classes, storage, protocols, deployment
topology, or internal types.

## Selection rule

Select one canonical relation or one authority-local invariant with one observable consumer. Authority-local
includes a business Owner or an explicitly modeled non-business boundary custodian. A chunk is never
“implement an Owner,” “migrate a crate,” or “complete a scenario.” Current code paths are discovered and bound
during planning; this target documentation does not claim current implementation parity.
Use the [Agent Implementation Guide](../agent-implementation/) to verify current engine APIs, toolchain guidance,
and legacy developer references only after the canonical chunk is selected.

## Copyable planning envelope

```text
Chunk identity
Selection mode RELATION or AUTHORITY_LOCAL_INVARIANT
Consumer and scenario
No-change harm and bounded outcome
relation-source-role and sender boundary
relation-action-kind
request-or-object-producer-authority
carried-object-authority
business-outcome-owner-or-none-with-basis
Canonical owner object relation-or-invariant and docs-route IDs
Prerequisites and unavailable-evidence Stop
Allowed inbound dependencies and prohibited writes
Accepted rejected unknown and replay behavior
Accepted oracle Given When Then
Rejected oracle Given When Then
Unknown oracle Given When Then
Replay oracle Given When Then
Implementation latitude
Focused Owner test
Boundary consumer test
Adversarial negative test
Replay restart and concurrency test when applicable
Repository root gate
Evidence receipt
  exact candidateRevision
  non-empty per-locator implementationReferenceBindings
Docs and Flow disposition
Authority-local invariant binding or not applicable with basis
Owner migration binding or not applicable with basis
Replan authority and external-effect escalation
```

This list is a planning aid, not validator input. Persist the chunk as JSON using the exact hyphenated field names
and nested shape in the canonical example below. `selection-mode` is the required discriminant. A relation record
sets `relationId` and uses JSON `null` for `invariantId`; an authority-local invariant does the inverse. Invariant
bindings also preserve `migrationSurfaceId` as either its exact string or JSON `null`. Omitted keys, JavaScript
`undefined`, extra fields, prose envelopes, and partial shapes are invalid after JSON round-trip.

## Canonical lookup and Origin-only shape fixture

Select a directed Owner handoff in the homepage Flow. Its detail capsule exposes the canonical relation,
object, and documentation-route IDs; the visible endpoints identify producer and consumer.
The owning page supplies the authority and invariants. Do not invent an ID when the handoff or object is absent:
stop and return to architecture planning instead.

The homepage lookup can be checked independently with this existing locator tuple:

```text
Selection mode RELATION
Canonical owner IDs product-edge and rd
Canonical object ID rd-request
Canonical relation ID product-rd
Canonical docs route architecture/product-edge
```

The four semantic fields contain the complete effective branch bodies, not opaque values such as
`relation-id#accepted`. The validator resolves the selected relation or invariant against the canonical contract
and accepts the record only when every branch body matches that authority exactly.

This exact JSON is a non-executable `ORIGIN_SHAPE_FIXTURE_NOT_CURRENT_CANDIDATE_EVIDENCE` for the existing
`portfolio-risk` relation. Its `30d7c…` revision demonstrates the record shape only; it is not the current
Candidate and must never be copied as current evidence. Main must materialize the actual candidate tree and
verification-context receipt for every candidate. When Candidate differs from Origin, an Origin-bound record is
`INVALID`. Transport, storage, framework, and internal types remain implementation choices.

```json
{
  "chunk-identity": "chunk:portfolio-risk:paper:v1",
  "selection-mode": "RELATION",
  "consumer-and-scenario": { "consumerId": "risk", "scenarioId": "paper" },
  "no-change-harm-and-bounded-outcome": {
    "noChangeHarm": "Risk could admit new exposure from incomplete or mixed Portfolio evidence",
    "boundedOutcome": "Validate and consume exactly one coherent Portfolio Risk Evidence Bundle"
  },
  "request-or-object-producer-authority": "portfolio",
  "business-outcome-owner-or-none-with-basis": { "ownerId": "risk", "noneBasis": null },
  "canonical-owner-object-relation-or-invariant-and-doc-route-ids": {
    "ownerId": "portfolio",
    "objectId": "portfolio-risk-evidence-bundle",
    "relationId": "portfolio-risk",
    "invariantId": null,
    "docsRoute": "owners/risk"
  },
  "carried-object-authority": "portfolio",
  "relation-source-role": "portfolio",
  "relation-action-kind": "fact",
  "prerequisites-and-unavailable-evidence-stop": {
    "prerequisites": ["complete Portfolio projection cut", "fresh shared Time Evidence"],
    "stopWhenUnavailable": ["bundle missing stale mixed-cut or cross-scope"]
  },
  "allowed-inbound-dependencies-and-prohibited-writes": {
    "allowedInbound": ["Portfolio Risk Evidence Bundle"],
    "prohibitedWrites": ["Portfolio facts", "Execution effects"]
  },
  "accepted-rejected-unknown-and-replay-semantics": {
    "accepted": "Risk binds one AVAILABLE Portfolio Risk Evidence Bundle whose candidate-neutral gross Capacity View projected exposure open-order membership settlement lineage valuation time evidence and Portfolio projection cut all match the Trade Intent Capacity Scope",
    "rejected": "Missing partial unavailable expired cross-scope mixed-cut duplicate-lineage methodology assumption valuation time or source-binding mismatch receives terminal REJECT and creates no add-risk Reservation",
    "unknown": "Unknown effect exposure open order settlement lineage liquidity clock or capacity fails closed and never implies remaining capacity",
    "replay": "The same bundle identity and projection cut remain bound to the frontier transition that consumed them"
  },
  "implementation-latitude": ["storage layout", "internal types", "process topology"],
  "focused-owner-test": "Risk admits a coherent fresh same-scope bundle",
  "boundary-consumer-test": "Portfolio output is consumed without acquiring Risk authority",
  "adversarial-negative-test": "Cross-scope or mixed-cut evidence returns terminal reject",
  "replay-restart-and-concurrency-test-when-applicable": "Duplicate bundle identity joins one frontier transition",
  "repository-root-gate": "make docs-site-check",
  "evidence-receipt": {
    "candidateRevision": "git-tree:30d7c401118dbe474e6d620d75a73b20c1d69543",
    "focusedTestResult": "PASS: focused owner test",
    "rootGateResult": "PASS: make docs-site-check",
    "implementationReferenceBindings": [
      {
        "candidateRevision": "git-tree:30d7c401118dbe474e6d620d75a73b20c1d69543",
        "locator": "docs/developer_guide/testing.md",
        "classification": "CURRENT_IMPLEMENTATION_REFERENCE",
        "verificationResult": "VERIFIED_AT_CANDIDATE_REVISION",
        "verificationReceipt": {
          "resolvedCandidateRevision": "git-tree:30d7c401118dbe474e6d620d75a73b20c1d69543",
          "resolvedLocatorIdentity": "tree-path:docs/developer_guide/testing.md@git-blob:180114fedbd11a05bbdba84a08e4eb27cb352ce7@content-sha256:1d36eea08dc2c525a92b2b531168c212d23c0ad02ecf474b8766578a37c2b820",
          "contentSha256": "sha256:1d36eea08dc2c525a92b2b531168c212d23c0ad02ecf474b8766578a37c2b820",
          "checkResults": [
            { "kind": "PATHS", "outcome": "PASS", "evidence": "The referenced repository path resolved at the frozen candidate revision", "basis": null },
            { "kind": "SYMBOLS", "outcome": "NOT_APPLICABLE_WITH_BASIS", "evidence": null, "basis": "This guide declares no exact implementation symbol dependency" },
            { "kind": "COMMANDS", "outcome": "PASS", "evidence": "The documented focused and root test commands were checked at the frozen candidate revision", "basis": null },
            { "kind": "PREREQUISITES", "outcome": "PASS", "evidence": "The documented toolchain and fixture prerequisites were checked at the frozen candidate revision", "basis": null }
          ],
          "verificationContextDigest": "sha256:b7c9923d0f25d2b32788cb433c4300a0002507cf7c42eb6026a4ec195988f354"
        },
        "mismatchDisposition": null
      }
    ]
  },
  "docs-and-flow-disposition": {
    "docs": "UNCHANGED_IF_CONTRACT_PRESERVED",
    "flow": "UNCHANGED_IF_TOPOLOGY_PRESERVED"
  },
  "authority-local-invariant-binding-or-not-applicable-with-basis": {
    "applicable": false,
    "basis": "The example selects a canonical relation rather than an authority-local invariant"
  },
  "owner-migration-binding-or-not-applicable-with-basis": {
    "applicable": false,
    "basis": "No authority or predecessor writer migration"
  },
  "replan-authority-and-external-effect-escalation": { "replanOwner": "Main", "externalEffectAuthority": "User" }
}
```

After replacing every Origin fixture receipt with Main-observed evidence for the actual candidate, save the record
and validate it from the site package. The placeholders below are required inputs, not literal values:

```bash
cd docs-site
npm run validate:development-chunk -- \
  --candidate-tree <ACTUAL_CANDIDATE_TREE> \
  --repo .. \
  --verification-context /absolute/path/to/main-verification-context.json \
  /absolute/path/to/chunk.json
```

The Main-supplied context is separate from the record and has this exact shape:

```json
{
  "candidateTree": "<ACTUAL_CANDIDATE_TREE>",
  "verificationContextDigests": {
    "docs/developer_guide/testing.md": "sha256:b7c9923d0f25d2b32788cb433c4300a0002507cf7c42eb6026a4ec195988f354"
  }
}
```

The command also accepts record JSON on standard input when the same required flags are present. Exit zero with
`{"outcome":"VALID","reasons":[]}` is the only
valid result; malformed JSON, unknown fields, missing keys, selector disagreement, or changed canonical semantics
returns `INVALID` and a nonzero exit.

The chunk must state one consumer-visible outcome, the relation `sourceRole` and exact action kind that send the handoff, the authority
that produces the request or object, the authority that owns the carried object, and the Owner of the observable
business outcome. These roles are separate fields and may differ. R&D is the single Owner for its internal Research
and Develop capabilities, while Backtest is a separate service Owner that consumes the R&D-owned Strategy Artifact.
A boundary may produce a typed request object, but only a business Owner may commit the correlated
receipt or transition. An Owner-produced read model keeps that Owner even when its consumer is a boundary.
Boundary-only presentation or delivery work may declare no business fact only with an explicit basis and remains
prohibited from committing any business transition; its declared business-write set is empty and
`business-transition` is listed as prohibited. Owner-local work names the same business Owner in both roles.
Inputs may be read only from declared inbound dependencies. Prohibited writes include every fact owned by another
Owner, treating transport or stage custody as carried-object authority, direct storage bypasses,
notification-as-proof, and any external or live effect without explicit authority.

Each accepted rejected unknown and replay oracle uses `Given / When / Then` and names a committed observation,
not a method call, log line, or prose-only expectation. Concurrency requirements specify durable atomic
serialization and the winning observable state without prescribing a storage primitive, database, queue,
or any other internal mechanism.

Every chunk declares whether it changes one of the migration surfaces in the Owner Migration Envelope. A
non-migration chunk gives a concrete not-applicable basis. A migration chunk binds the exact slice and surface,
current and next adjacent stage, predecessor and successor revisions, common evidence cut, rollback or fenced
forward-recovery disposition, incident authority, and kill observations. Evidence bindings, rollback disposition,
kill observations, and the common-cut domain must match the selected migration surface; the cut identity is
namespaced by that domain. Evidence from another surface is invalid.
Missing, foreign, or non-adjacent migration context stops planning.

The `agent-shell-cutover` boundary invariant binds the Agent Shell Deployment Binding, authoritative history head,
the shared mutating Owner request gate, all three outbound request objects, and their three receiving-Owner receipts. Its proof preserves the effective principal, scope,
capability, and audit-policy versions. It allows a fail-closed zero-`ACTIVE` interval, requires the exact predecessor
to commit irreversible `SUPERSEDED` before the policy-equivalent successor commits `ACTIVE`, rejects dual writers,
requires every mutating request admission to bind the exact head whose unique `ACTIVE` member is selected, and
resolves every already admitted in-flight request under its original request and binding identities. A business outcome exists only when the matching Research, Governance, or
Qualification Owner receipt is independently committed. It has no business Owner and cannot commit a business transition.
Its chunk also declares the canonical `accepted`, `rejected`, `unknown`, and `replay` branches in full; a missing,
partial, or changed branch stops planning.

## Effective relation semantics

Every relation owns exactly one complete local `accepted`, `rejected`, `unknown`, and `replay` block. A missing,
empty, or partial local block is invalid, and no second semantic source is consulted.
An Owner-local invariant must state the same four observable branches directly in the chunk.
Unresolved references, opaque `relation#branch` placeholders, partial blocks, and branch bodies that differ from
the selected canonical authority are `INVALID`. The generated contract projection shows the resolved branch
bodies so an implementation agent can execute and test the selected behavior without consulting a second source.

## Required evidence

- The evidence receipt freezes one exact `candidateRevision` and a non-empty
  `implementationReferenceBindings` list. Every entry repeats that revision and has only
  `candidateRevision`, `locator`, `classification`, `verificationResult`, `verificationReceipt`, and
  `mismatchDisposition`; duplicate locators or changed fields are invalid.
- A `CURRENT_IMPLEMENTATION_REFERENCE` entry is valid only with
  `VERIFIED_AT_CANDIDATE_REVISION`, a complete typed receipt, and a null mismatch disposition. A
  `LEGACY_REFERENCE` entry is valid only with `MISMATCHED_OR_SUPERSEDED`, the same complete receipt, and
  `DO_NOT_USE_AND_REPLAN`. Missing, empty, stale, revision-mismatched, partial, or unknown bindings stop the chunk.
- The typed verification receipt has only `resolvedCandidateRevision`, `resolvedLocatorIdentity`,
  `contentSha256`, `checkResults`, and `verificationContextDigest`. It binds the exact candidate revision and
  normalized locator to an immutable Git blob plus the same SHA-256 digest repeated by both identity fields.
  The context digest covers the ordered typed receipt and must independently match Main's per-locator context.
  Free-text verification claims are invalid.
- `checkResults` contains exactly `PATHS`, `SYMBOLS`, `COMMANDS`, and `PREREQUISITES` in canonical order. Each is
  `PASS` with concrete evidence and null basis, or `NOT_APPLICABLE_WITH_BASIS` with null evidence and concrete
  basis. Missing, duplicate, extra, reordered, malformed, or mutated revision, content, locator, or check evidence
  fails closed.
- Record-plus-contract is insufficient for both CURRENT and LEGACY. The public validator requires a real immutable
  Git tree and repository object database, resolves each locator to one blob, reads its bytes, recomputes the Git
  blob ID and SHA-256, and compares the externally supplied context digest. Missing resolution, a stale or wrong
  tree, an absent path, fabricated self-consistent identities, or byte mutation is invalid. LEGACY has no
  unavailable-resolution exception and remains `DO_NOT_USE_AND_REPLAN` after successful resolution.
- One focused test proves the authoritative writer and accepted outcome.
- One boundary-consumer test proves the consumer reads the committed Owner result.
- One adversarial test proves a prohibited writer, stale or malformed input, or authority bypass is rejected.
- Replay, restart, and concurrency are tested whenever identity, external effect, reservation, cutover, or terminal
  state can be duplicated or left unknown.
- The repository's existing root gate and the exact evidence receipt are recorded. Passing tests do not
  automatically authorize another chunk; Main accepts the exact evidence first.

Event Rail or notification delivery is never business proof. Protected Qualification results cannot feed the
same R&D loop. Risk cannot issue an order, and Execution cannot write Risk or Portfolio state.

## Docs and Flow disposition

An authority, object owner, handoff, or branch-semantic change updates the canonical contract, Flow projection,
owning bilingual page, affected scenario page, and checks together. An internal implementation that preserves
those contracts declares Flow unchanged.

Only `guide`, `architecture`, `owners`, and `scenarios` are normative published roots. A chunk cannot restore,
remigrate, publish, or delete a legacy source root without new explicit scoped user authority.

## Stop and escalation

Stop and return to Main when the consumer, writer, prerequisite, oracle, canonical identity, or evidence is
unknown; when a new Owner or handoff appears necessary; when the 14-group or five-module ceiling is pressured;
or when the chunk requires an external/live effect. Do not widen the chunk to hide the missing decision.
