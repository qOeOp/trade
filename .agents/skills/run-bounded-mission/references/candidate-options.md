# Compare Candidate Options

Load this reference only when a reuse question or materially different credible candidate paths can
change owner, responsibility, architecture, verification, or a hard-to-reverse choice. Use its slice
method only when candidates need independently falsifiable shapes. The main agent owns selection and
Plan admission.

## Resolve reuse before building

State the responsibility and path decision the comparison informs. Inspect local evidence only until
existing owners, installed or target versions, constraints, and safe public search terms are stable;
do not design a new implementation first.

Run one ordered funnel when external prior art is decision-relevant:

1. **Local reuse.** Check repository owners and history, dependencies, configured plugins/connectors,
   and adopted upstreams. Preserve repository-specific contracts; identify commodity infrastructure
   that should not be rebuilt.
2. **Breadth-first discovery.** Search official sources, GitHub, package ecosystems, standards, and
   primary literature with outcome, capability, ecosystem, and failure-mode terms. Collect canonical
   locators and obvious fit/rejection signals without deep-diving the first result.
3. **Shortlist.** Deduplicate forks, mirrors, wrappers, and summaries. Keep candidates that could
   change `adopt`, `adapt`, `reference`, or `build`, plus the strongest materially different option.
4. **Depth-first verification.** Verify only decision-changing compatibility, maintained behavior,
   reuse surface, license, source, tests/evaluations, releases, issues, operational cost, and failure
   modes for shortlisted candidates.
5. **Decide.** Prefer `adopt`, then `adapt`, then `reference`; choose `build` only when evidence rejects
   the strongest credible reusable path.

Stars, summaries, caller claims, and generated answers are leads. Prefer repository behavior,
official docs, source, tests, releases, standards, and primary papers. Use issues and independent
evaluations to find maintenance or failure-mode evidence. When sources conflict, name the exact claim
that needs reproduction; treat prose as a claim until source, tests, or consumer behavior reconcile it.

Keep a known candidate or short verification chain in main. Use one fresh read-only researcher for
the complete breadth-to-depth funnel only when the candidate set is unknown, more than one external
evidence class is required, a source tree needs nontrivial inspection, or source volume would displace
contract/candidate context. Do not split breadth and depth across uncoordinated researchers.

A `reuse/prior_art` researcher packet uses the shared researcher packet in `decision-evidence.md`.
It additionally names the immutable Origin, the exact protocol paths required by `support-lanes.md`,
and the installed or target version.

In addition to the shared researcher return in `decision-evidence.md`, a `reuse/prior_art` brief adds
responsibility, repository constraints, breadth covered, shortlist, decision, evidence for and against,
strongest rejected alternative, and source revisions and licenses when relevant. Failure to find a
candidate does not prove absence or justify `build`. Stop when decision-changing claims have primary
evidence or are explicitly unavailable, the strongest credible alternative is covered, and another
distinct breadth query adds no decision-relevant candidate; also honor the branch's finite
time/query/tool Stop.

## Compare credible paths

Compare only materially different paths that remain credible; do not manufacture competitors to a
dominant repository-native path. Treat the requested mechanism as one candidate, not the baseline
that must win. Evaluate:

- Outcome and real-consumer fit;
- existing ownership and responsibility added, retained, or deleted;
- authority, representation, and unknown-value assumptions;
- safety and fail-close behavior;
- reversibility and verification cost;
- context, coordination, dependency, and maintenance cost.

Before selecting, state the no-change counterfactual and prove that a consumer outcome remains
unsatisfied. Prefer an answer, existing behavior, direct wiring, deletion, rollback, or a narrower
decision when it closes the Outcome.

Prefer the path with the best decisive tradeoff and state why the strongest runner-up loses. Reject a
mechanism when evidence shows consumer harm, duplicate ownership, unsafe failure, unjustified
responsibility, or more structure than the Outcome. Preserve the Outcome through the smallest
credible substitute. Repetition, urgency, sunk work, file count, or diff size is not contrary evidence.

Always resolve reuse before adding an abstraction, compatibility path, agent, script, or state. Put
only evidenced dependent boundaries into change and verification. Separate instruction, workflow,
judge, ruleset, and signing-policy changes from ordinary implementation. Use an agent lane only for a
concrete unresolved question, frozen non-overlapping build leaf, or independently useful frozen-
candidate risk lens; load [agent lane routing](support-lanes.md) first.

## Form independently falsifiable slices

Use slices only when candidate shapes or Stop evidence must be independently rejectable. For each
slice record:

- observable result and real consumer or owner path;
- dependencies and later consumer;
- cheapest decisive check and expected evidence;
- first result that invalidates Plan while Frame holds and forces `replan`;
- first result that changes a Frame field and forces `reframe`.

Put first the slice that reaches a real consumer while exposing the highest-risk assumption. Fold
setup, configuration, documentation, and cleanup into the slice that consumes them. Do not turn
diagnosis, tests, or mechanical work into feature stories, phases, or test-first ceremonies.

For a failing check or CI job, reproduce the exact command and relevant environment, preserve the
failure, localize one causal root, make the smallest coherent correction, then rerun that failure and
the narrowest relevant regression. Coherence and convergence are causal, never numeric attempt rules.
