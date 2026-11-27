---
type: llm
---

The user asks how to use product-doctor before a release to run (1) deterministic runtime pinning/closure, security/supply-chain, and docs-drift audits, and (2) multi-size cost regression gating against a saved baseline without reading credentials or relying on single-size timings. Judge only the final response.

Q1. Does it direct running `doctor.py posture` (with `--check all`, or focused `--check runtime`, `--check security`, `--check docs`) and describe what each pillar checks: `uv.lock` Nautilus pinning + Dockerfile `:latest`/digest hygiene + `tests/runtime/test_replay_closure.py` closure; unpinned/wildcard deps, missing lockfiles, Python production AST dangerous patterns (`shell=True`, `eval`, `exec`, `pickle.loads`, unsafe `yaml.load`, `verify=False`), and tracked forbidden secret filenames (`.env`, `service.json`, `*.key`, private `*.pem`) without reading credential contents; and `broken_doc_refs` across top-level docs and `.agents/skills/*/SKILL.md`?
Q2. Does it direct running `doctor.py cost` at three or more sizes (`--sizes`) with `--write-baseline <path>` to save a baseline JSON and `--baseline <path>` to compare regressions deterministically (`regression`, `violations`)?
Q3. Does it state the cost baseline regression dimensions (`time_exponent_regression`, `heap_exponent_regression`, `rss_regression`, `wall_time_regression`) and avoid relying on single-run timing or reading `.env`/`dolt/service.json`?

PASS if Q1–Q3 are all yes. FAIL otherwise.
