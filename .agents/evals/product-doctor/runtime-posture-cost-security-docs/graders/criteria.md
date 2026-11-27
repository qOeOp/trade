---
type: llm
---

The user asks how to use product-doctor before a release to run (1) deterministic Dockerfile digest pinning and Python security AST / tracked-secret audits, and (2) multi-size cost regression gating against a saved baseline without reading credentials or relying on single-size timings. Judge only the final response.

Q1. Does it direct running `doctor.py posture` (with `--check all`, or focused `--check runtime` / `--check security`, plus optional `--tree`) and describe what each pillar checks: Dockerfile `:latest` / `@sha256:` digest pinning across Dockerfiles; Python production AST dangerous patterns (`shell=True`, `eval`, `exec`, `pickle.loads`, unsafe `yaml.load`, `verify=False`, with `engine/load.py` allowlist), and tracked forbidden secret filenames (`.env`, `service.json`, `*.key`, private `*.pem`, allowing public cert bundles like `ledger/tsa-roots.pem`) without reading credential contents?
Q2. Does it direct running `doctor.py cost` at three or more sizes (`--sizes`) with `--write-baseline <path>` to save a baseline JSON and `--baseline <path>` to compare regressions deterministically (`regression`, `violations`)?
Q3. Does it state the cost baseline regression dimensions (`time_exponent_regression`, `heap_exponent_regression`, `rss_regression`, `wall_time_regression`) and avoid relying on single-run timing or reading `.env`/`dolt/service.json`?

PASS if Q1–Q3 are all yes. FAIL otherwise.
