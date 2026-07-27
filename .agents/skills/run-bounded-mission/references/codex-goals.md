# Codex goal binding

Load this reference only when the user explicitly requests a goal-backed
mission or explicitly resumes one. A Codex goal preserves the user-visible
objective across turns; it does not replace the mission contract, working plan,
Git/provider evidence, or ordered terminal predicates.

## Bind one goal

1. Inspect the current goal before execution.
2. If no unfinished goal exists, create one whose objective names the mission's
   real terminal and cleanup. Do not add a token budget unless the user
   explicitly supplied one.
3. If an unfinished goal already represents the requested objective, bind the
   mission to it. An explicit resume of a blocked goal starts a fresh blocked
   audit; the goal may continue to display `blocked` because there is no
   separate resume mutation.
4. If an unfinished goal represents a different objective, do not create a
   parallel goal or silently replace it. Apply the mission terminal rules and
   request external direction when the conflict cannot be resolved read-only.

The goal objective, mission outcome, consumer, terminal effect, and cleanup
must agree. Neither goal creation nor resume expands effect authority, weakens
acceptance, creates a lifecycle writer, or resets a budget. Keep counters in the
working plan; never add a goal ledger, repository state file, comment registry,
daemon, or second orchestrator.

## Stop without inventing `blocked`

Each admitted implementation slice has at most three revisions. After the
third non-accepting revision:

- do not attempt a fourth revision;
- stop that slice and apply the mission's replan and ordered terminal rules;
- permit a new slice only for a different consumer checkpoint or a materially
  changed design for the new counterexample, within the original cumulative
  budget;
- never reset the slice by renaming it, resuming the goal, changing context, or
  calling the work read-only.

Slice exhaustion, two non-progress cycles, or cumulative
`budget_exhausted` does not by itself satisfy the Codex platform's `blocked`
predicate. Call `update_goal(blocked)` only when the same required external
fact, permission, authority, or external-state change has remained unavailable
for at least three consecutive goal turns in the current blocked audit. A
resumed previously blocked goal starts that audit again. Before the third
matching turn, report the mission disposition without fabricating goal state.

Call `update_goal(complete)` only after the entire objective—including its
named provider terminal, verification, restoration, and cleanup—has actually
completed. Never mark complete because a slice, patch, commit, PR, review, or
intermediate check succeeded.

## Required controls

Use these controls when evaluating this behavior:

- failing scenario: an exhausted slice is renamed or resumed under the same
  objective; it remains exhausted and no fourth revision is permitted;
- valid control: two changes close different named consumer checkpoints; they
  consume two admitted slices and retain independent three-revision limits;
- different task shape: an independent read-only task with a different outcome
  is a new mission with new counters, but it cannot inherit the prior goal's
  authority or terminal claim.
