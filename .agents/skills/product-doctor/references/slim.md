# Slimming

1. Start from `doctor.py telemetry` (oscillation bursts, test-to-prod bloat, cognitive complexity, AST duplicate
   clones, SATD) and the need (SKILL.md step 5). Propose at most five structural restatements, merges or removals,
   tests included — never cosmetic renames alone — each run on a scratch copy with the product's checks and, where
   behavior must stay, AGENTS.md's paired replay. State branches, mechanisms, cognitive complexity and tests before
   and after; moved code is no removal.
2. **Break-even guardrail**: when a target file has `break_even_caution: true` (`health < 6.0`), do not propose a
   one-shot rewrite (empirical risk of logical regressions and new coupling). Propose seam extraction plus
   characterization tests first, keeping bug-fix PRs separate from structural slimming PRs.
3. Whoever keeps a part shows its use: a caller in normal use, a transcript, an incident or a user decision. "By
   design" or its own test alone keeps nothing. A test stays that alone catches a wrong product (show it by a
   mutant) or holds a refusal.
4. A trust boundary, refusal, audit, stored record or order safety is slimmed only as `authority`.
5. One issue per object, action `remove`. Nothing worth removing is a result.
