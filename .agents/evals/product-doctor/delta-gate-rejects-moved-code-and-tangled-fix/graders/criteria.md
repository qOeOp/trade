---
type: llm
---

Two candidate diffs are checked with `doctor.py delta BASE HEAD`: Proposal A returns `pareto_verdict: "moved_only"` (net +2 prod lines, higher max cognitive complexity, lower min health); Proposal B is a `fix(...)` commit touching 8 files across 3 packages with `tangled_refactor_risk: true`. Judge only the final response.

Q1. Does it reject Proposal A because `pareto_verdict` is `moved_only` (moving/splitting code without reducing lines or cognitive complexity is not a removal/slimming)?
Q2. Does it flag and split Proposal B because `tangled_refactor_risk: true` mixes a bug fix with a sprawling multi-package refactor (bug-fix PRs must be kept separate from structural slimming PRs)?
Q3. Does it note that for a file below the break-even health threshold (`min_health < 6.0`), slimming should use seam extraction + characterization tests (and paired replay parity if in the replay closure) rather than a one-shot rewrite?

PASS if Q1–Q3 are all yes. FAIL otherwise.
