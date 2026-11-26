---
type: llm
---

During a `slim` audit, `doctor.py telemetry` surfaces (A) a 3-way clone across `deploy` (host stdlib-only), `ide` (`ISOLATED`), and `shared`, and (B) `engine/audit.py` with `break_even_caution: true` (`health=1.79`) inside the digest-pinned replay closure. Judge only the final response.

Q1. Does it reject merging clone group A (`deploy` and `ide`) into `shared/errors.py` because those copies enforce package/runtime isolation boundaries (`tests/test_package_layers.py`, host-Python `deploy`, `ISOLATED` `ide`)?
Q2. Does it refuse a one-shot rewrite of `engine/audit.py` (`break_even_caution: true`) and instead require seam extraction plus characterization tests first?
Q3. Does it require paired native replay parity (per `AGENTS.md` / `slim.md`) for behavior-preserving changes inside the replay closure, and flag any change to an audit/refusal check itself as needing `authority`?

PASS if Q1–Q3 are all yes. FAIL otherwise.
