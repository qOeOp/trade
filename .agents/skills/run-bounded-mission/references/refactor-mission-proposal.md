# Refactor Mission Proposals

Use this method only after two or more Missions have reached `accept` and read-only evidence may show
that their integrated results created a separate structural outcome gap. The investigation belongs
to the follow-up proposal consumer after Finalize. It is not a Finalize route, a continuation of an
accepted Mission, or a way to move its `revise` or `replan` work elsewhere.

`revise` remains a candidate-local correction while the admitted owner, path, boundary,
responsibility shape, and oracle hold. `replan` remains the replacement of a failed owner, path,
boundary, shape, or verification design inside the same frozen Frame. If either route could still
close the unresolved current outcome, do not propose a Refactor Mission.

## Investigate from immutable evidence

Freeze an explicit full commit `base` and `head`, plus the full canonical source ref whose current
tip represents integration. `base` must bound the earliest relevant integrated Mission evidence.
`head` must contain all relevant accepted Mission results, be reachable from a repository ref, and
equal the observed tip of the declared source ref. Never infer this range or ref from the working
tree, changed filenames, conversation recency, or a guessed feature boundary.

Derive the canonical owner roots from the repository authority at `base` and `head`, then pass their
union to the skill helper. The Agent owns that project-specific mapping; the helper only consumes
repository-relative roots and Git identities:

```text
bun .agents/skills/run-bounded-mission/scripts/mission-impact-evidence.ts \
  --base <full-commit> --head <full-commit> --source-ref <full-ref> \
  --owner-root <repository-relative-owner> [--owner-root <repository-relative-owner> ...]
```

The helper maps changed paths only against those caller-supplied roots, reports unassigned paths, and
expands evidenced direct dependents from static production imports. Its `facts` and `reasons` explain
the inspected range; they do not decide whether refactoring is required. Preserve the invocation,
exit status, complete JSON, revisions, roots, and listed coverage limits.

If a relevant result exists only as staged, unstaged, or untracked material, `head` is not reachable,
or the declared source ref no longer resolves to the observed tip equal to `head`, retain at most one
`deferred` proposal. Name the exact missing integration fact and do not call a task tool. Refresh the
evidence after a current reachable revision integrates every relevant Mission; that revision becomes
the proposed Mission's Origin.

## Decide whether a proposal is justified

Reconstruct the accepted Mission evidence needed to test one concrete structural cause. Examples
include duplicated responsibility across canonical owners, an owner boundary contradicted by a
direct production consumer, or repeated accepted-Mission corrections that spread one responsibility
across owners or protective paths. Bind the cause to the helper's paths and owner/dependent facts;
do not promote an aggregate observation into a cause.

Churn, co-change frequency, file count, line count, age, or an architecture/complexity score alone
cannot justify a proposal. Neither can a helper reason, an unassigned path, or a static dependency
alone. Return with no proposal unless all of the following can be stated without inventing future
structure:

- one specific cross-Mission structural cause and the accepted evidence that demonstrates it;
- one real production consumer or entry point affected by that cause;
- behavior that the refactor must preserve, expressed as falsifiable consumer acceptance;
- one bounded outcome independent from every accepted Mission;
- an authority envelope and non-goals that add no automatic external effect.

Do not preselect internal structure, split owners speculatively, or use the proposal to encode a
preferred cleanup.

## Add Refactor-specific evidence to one proposal

When the conditions above pass, add the following to one packet:

- Origin set to the reachable integrated `head`;
- a raw evidence summary with the helper invocation, exact `base`/`head`, declared source ref and
  observed tip, owner/dependent facts, concrete structural cause, and limits;
- Acceptance that preserves the bound consumer behavior.

The child prompt must require fresh planning. It may use the accepted results as regression evidence,
but must not inherit their candidates, Plans, Stops, or rejected alternatives.

Load [task dispatch](task-dispatch.md) for the stable session label, two-layer display, complete
editable child prompt, `ready | deferred` status, exact prerequisites, pre-dispatch revalidation,
consent, and native creation. Refactor is a user-readable description only; it does not select a
different Mission type, lifecycle, route, template, or dispatch policy.
