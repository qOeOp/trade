# Revision-pressure Replan

Use this method when another revision would reach the frozen boundary, a material finding recurs, or
the next correction appears additive on one responsibility surface. A revision count starts
diagnosis; it does not justify refactoring.

## Reconstruct the pressure

Read the implementation and cumulative diff rather than revision summaries. Recover:

- the code before the relevant revision chain and the current cumulative candidate;
- for every revision, its observed failure, intended correction, diff, and acceptance result;
- the production owner and consumer, invariants, and affected direct producers, consumers,
  restatements, and enforcers;
- the evidence-backed compatible boundary where each path stops, and the exercises every affected
  surface must survive.

Reuse conversation artifacts, bounded repository history, and tests; create no ledger. Keep scope to
the smallest owner chain that explains the pressure. Do not infer closure from the current diff,
filename similarity, or the caller's file list. If a material semantic edge remains unresolved, the
replacement scope is not ready.

Redesign only when evidence identifies a shared structural cause: a finding returns, acceptance stops
improving, responsibility spreads, or protective exceptions, branches, adapters, fallbacks, or
indirection accumulate. If corrections are independent and the surface is stable or shrinking, return
to lifecycle routing without refactoring. If required authority or evidence is unavailable, route to
`blocked`.

## Replan and compare

Keep the mission origin unchanged. Freeze the cumulative candidate and contract as the incumbent.
Preserve required corrected behavior; treat past failures as regression cases expecting that
correction. Keep pre-chain code only as evidence of growth.

Return to lifecycle Plan with the demonstrated structural cause and affected owner chain. Reapply its
reuse-before-build research and boundary closure before admitting a replacement; this method does not
authorize Build by itself.

1. When the structural cause, incumbent, owner chain, and acceptance signals are stable, a fresh
   read-only planner may propose at most one materially different alternative or simplification
   during the Plan wave. The main agent admits at most one replacement design.
2. After admission, build that replacement in isolation as the smallest coherent answer to the
   structural cause. Do not add another patch to the incumbent or create multiple writable winners.
3. Do not invent a challenger when no credible alternative remains. An existing repository-native
   implementation or deterministic transformation may be a candidate when it actually covers the
   change; do not install infrastructure merely to run this comparison.

Run the same consumer and regression exercises against the incumbent and every proposal. When
robustness is material, add one probe that varies incidental details while preserving the governing
invariant.

## Promote or stop

Promote exactly one candidate only when it:

- preserves required behavior and satisfies every material acceptance signal;
- removes the shared cause rather than encoding the observed cases as new exceptions;
- is strictly simpler on at least one relevant surface—owners, paths, branches, state, adapters,
  exceptions, or indirection—without an unjustified regression elsewhere;
- leaves one production owner and deletes its superseded path.

Line count, architecture-sensor scores, and reviewer preference are supporting evidence, never the
decision rule. If neither proposal strictly improves on the incumbent, retain the incumbent and
route to `replan` or `blocked`; do not force a refactor or extend the revision budget.
