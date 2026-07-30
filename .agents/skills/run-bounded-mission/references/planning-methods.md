# Planning Methods

These are optional aids, not lifecycle stages or gates. Use only the method that changes a material
decision. Skip them for mechanical edits.

## Acquire decision-relevant prior art

State the decision the research must inform, then inspect the repository's owners, dependencies, and
similar paths before external search. Search current official sources and GitHub with capability,
ecosystem, and failure-mode terms; broaden for candidates, then narrow to verify fit. For
version-sensitive behavior, identify the installed and target versions before trusting upstream
guidance.

For each credible candidate, retain its source and revision, maintained behavior, license, relevant
documentation, implementation and tests or evaluations, relevant release and issue history, reuse
surface, and decisive rejection or adoption reason. Stars, summaries, and caller claims are leads,
not evidence. When sources conflict, reproduce the relevant behavior at the pinned version and treat
documentation or issues as claims until reconciled with source, tests, or consumer evidence. Stop
when the decision is supported by verified evidence, including the strongest materially different
alternative only when one remains credible, or further distinct queries no longer change the
decision. Failure to find a candidate does not prove none exists.

Return a compact decision brief: question, repository evidence, candidates, evidence for and against
the recommendation, unresolved facts, and locators. Keep a lookup in the main context when one source
or one short verification chain can resolve it. When multiple candidate repositories or source volume
would materially displace the contract and candidate context, use one fresh-context, read-only
researcher by default. Dispatch genuinely disjoint, decision-changing questions with separate evidence
paths concurrently when they qualify under the skill's critical-path rule. Start them as soon as their
inputs are stable, inside the Stop and available host capacity; the main agent continues
non-overlapping work, verifies decisive sources, and chooses. Two or more qualifying read-only
questions are concurrent by default; serialize them only with the concrete override evidence required
by the skill. Give each researcher only the non-obvious context needed to bound its question,
evidence path, and return barrier; the skill's Host Boundary owns the actual handoff. Omit context
already established by the frozen contract. Use host-native web, GitHub, code-search, or isolated
research tools; require no particular tool.

## Resolve consequential ambiguity

Use this when an unresolved fact could change the candidate, consumer behavior, authority,
acceptance, or a hard-to-reverse choice.

- Inspect repository evidence before asking.
- Investigate factual gaps; ask only for user-owned preferences or authority.
- Express each credible interpretation as an assumption, its consumer consequence, and an observation
  that would disprove it.
- Present the current understanding and recommendation, then ask one smallest question that separates
  the interpretations. If no material ambiguity remains, ask nothing.

## Compare viable alternatives

Compare only materially different paths that remain credible; do not invent competitors to a
dominant repository-native path. Evaluate outcome and consumer fit, existing ownership, added
responsibility, assumptions, reversibility, and verification cost. Recommend the path with the best
decisive tradeoff and state why the strongest runner-up loses.

## Form independently falsifiable slices

Make each slice rejectable without rejecting its neighbors. Record:

- its observable result and inspected consumer or owner path;
- dependencies and the later consumer;
- the cheapest decisive check and expected evidence;
- the first result that forces `replan`.

Put first the slice that reaches a real consumer while exposing the highest-risk assumption. Fold
setup, configuration, documentation, and cleanup into the slice that consumes them. Do not turn
diagnosis or mechanical work into feature stories, phases, or test-first steps.

For a failing check or CI job: reproduce its exact command and relevant environment, preserve the
failure, localize the responsible path, make one bounded correction, then rerun the exact failure
and the smallest relevant regression.
