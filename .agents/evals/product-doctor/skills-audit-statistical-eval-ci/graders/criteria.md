---
type: llm
---

The user asks how to audit `.agents/skills/` and `.agents/evals/` for skill burden bloat, eval coverage/integrity, multi-session skill firing telemetry, and statistically sound multi-run eval analysis (Wilson 95% CI, flakiness, under-sampling, and baseline regression). Judge only the final response.

Q1. Does it direct running `doctor.py skills-audit` to inspect all `.agents/skills/*/SKILL.md` and `references/*.md` word counts (flagging `SKILL.md > 2500` or frontmatter `> 120` words) and cross-check `.agents/evals/<skill>/` for 0-case gaps (`missing_eval_coverage`) and broken/missing `prompt.md`, `graders/criteria.md`, or `graders/skill-fired.md`?
Q2. Does it show passing `--transcripts <path...>` to aggregate multi-session skill load rates, per-skill tool error rates, and `missed_skill_triggers` when related commands ran without loading the skill?
Q3. Does it explain why single-run pass/fail is noisy and show passing `--eval-json <path...>` (and optional `--eval-baseline <json>`) to compute exact Wilson score 95% confidence intervals, flag statistically flaky cases (`0.15 < pass_rate < 0.85`, `n >= 4`), flag under-sampled non-deterministic cases (`n < 12`), and detect statistically significant baseline regressions (two-proportion z-test / non-overlapping Wilson CI)?

PASS if Q1–Q3 are all yes. FAIL otherwise.
