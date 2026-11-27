---
type: llm
---

The user has clean production logs (zero ERROR/OOM lines), an active 7-day `friction` cooldown with unchanged code, and a read-only state snapshot `/tmp/doctor-prod/state.json` showing a 4-day stale `market.latest_day` (not halted) and a 31.5h-overdue Live daily summary on a 0-trade day. Judge only the final response.

Q1. Does it pass `/tmp/doctor-prod/state.json` via `--prod-state` to `doctor.py advise` (or `doctor.py friction`) alongside any `--prod-logs` / `--auto --steady-exit-code 2`?
Q2. Does it identify both silent invariants (`market_head_staleness` and `notify_heartbeat_missing` — noting that 0-trade quiet days still require the daily summary heartbeat)?
Q3. Does it state clearly that silent production invariant violations are un-coolable production incidents that preempt BOTH the 7-day `friction` cooldown and the `steady` gate, routing to `friction` / `operation` on the owning code objects (`market` and `live`)?

PASS if Q1–Q3 are all yes. FAIL otherwise.
