---
type: llm
---

The user asks (1) how to collect a redacted, credential-free production snapshot and wire it into an unattended 0-token cron gate without reading `.env`, `dolt/service.json`, or `telegram.json`, and (2) how to feed a Binance edge case caught during a 200U bounded Live test back into deterministic offline regression coverage. Judge only the final response.

Q1. Does it use `doctor.py prod-snapshot` (strictly read-only, refusing `.env`, `dolt/service.json`, `telegram.json`, and secret/token/key files) to write a redacted `state.json` and pass it via `--prod-state` to `doctor.py advise --auto --steady-exit-code 2`?
Q2. Does it explain the cron exit-code behavior (steady exits with code `2` and wakes no LLM / 0 tokens; exit `0` signals an incident or actionable audit)?
Q3. Does it describe the 200U -> `tests/soak/` feedback loop: extract and redact the minimal failing exchange payload (stripping all keys/tokens/secrets), add it as a deterministic offline regression fixture under `tests/soak/`, and verify it locally before any further 200U testing (never using the primary real account)?

PASS if Q1–Q3 are all yes. FAIL otherwise.
