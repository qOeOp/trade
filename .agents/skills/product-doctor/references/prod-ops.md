# Production Operations Auditing (`prod-snapshot`, `--prod-state`, and 200U -> `tests/soak/`)

Logs alone (`--prod-logs`) only catch explicit crashes (`OOMKilled`, `exit 137`, `Traceback`,
`ERROR`, `PAPER_RECOVERY_UNAVAILABLE`, repeated `Paper checkpoint deferred:`, or 0-line empty logs).
Silent production failures emit zero error lines while stalling market ingestion, freezing Paper
checkpoints, leaving unsealed orphan directories, drifting replay vs execution, dropping daily
monitoring summaries, or letting backups and mirrors fall behind.

## Nine silent production invariants (`--prod-state`)

`doctor.py friction --prod-state <state.json...>` and `doctor.py advise --prod-state <state.json...>`
evaluate nine deterministic invariants (implemented in pure stdlib in `assets/prod_invariants.py` and
`assets/ops_invariants.py`):

| Invariant | Trigger condition | Owning object | Why `--prod-logs` alone misses it |
|---|---|---|---|
| `market_head_staleness` | Active USDT perpetuals `latest_day` / `head` lags `as_of` UTC date by `> 2` days (configurable) while `halted` is not `true` | `market` | A delisted or wedged contract can freeze global head progression with clean `INFO` logs |
| `paper_checkpoint_stall` | Active Paper run alive `> 7200s` (`2h`) without checkpoint advance (`checkpoint_age_s > 7200`), or `state == "WARMING"` with `warming_age_s > warmup_budget_s` (default `900s`) | `paper` | Subscription or timer starvation stalls checkpoints silently without raising an exception |
| `orphan_unsealed_age` | Unsealed orphan run directory with `age_s > 600s` not yet sealed by daemon | `paper` / `live` | Daemon dispatch bugs leave ended runs unsealed with no crash trace |
| `compare_unexplained_drift` | Read-only `paper compare` / `live compare` reports `unexplained_count > 0` (or non-empty `unexplained`) or `orders_differ` / `positions_differ` | `paper` / `live` / `engine` | Silent order drops, liquidation accounting mismatch, or funding/price distortion emit no error |
| `notify_heartbeat_missing` | Active Live or Paper monitor has `last_daily_summary_age_h > 26.0` (including 0-trade quiet days) or missing summary | `live` / `paper` | Type mismatch or swallowed exception silences daily Telegram summaries without crashing |
| `ledger_backup_or_mirror_drift` | `dolt_backup` behind (`backup_behind_commits > 0` and `backup_lag_s > 3600`), or `mirror_diverged == true`, or `mirror_lag_s > 3600` | `ledger` | Failed cron pushes or diverged mirror refs leave research backups silently stale |
| `market_archive_integrity` | 0-byte, 0-row, or corrupt Parquet files (pure-stdlib `PAR1` + Thrift footer check), non-monotonic/duplicate month partitions, `active_symbols_drop_pct > 20%`, `delisted_blocking_head > 0`, or `schema_drift_count > 0` | `market` | Truncated archive downloads, empty Parquet writes, or upstream schema drift leave corrupted data on disk with zero crash trace |
| `ledger_public_hygiene` | Private Paper/Live/execution tables (`paper_runs`, `live_runs`), `private_root` markers, or credential/token patterns in a public ledger export; `last_restore_drill_age_days > 30` or `last_restore_ok == false`; or backup divergence/checksum mismatch | `ledger` | Unverified backups decay silently and private execution data or credentials can leak into public exports without runtime errors |
| `ops_disk_and_deploy_health` | Disk utilization `disk_used_pct >= 85.0` or `free_gib < 10.0`, `unpruned_images_count > max_retained` or `ghcr_cleanup_overdue_days > 35`, container `restart_count_24h >= 5`, or `deploy_non_stdlib_imports > 0` (AST over `deploy/*.py`) | `deploy` | Filling disks, unpruned images, flapping containers, or non-stdlib host imports accumulate quietly until an outage hits |

Any violated invariant (`prod_invariant:*`) or unreadable/corrupt snapshot (`prod_state:prod_state_unreadable`)
is treated as an **un-coolable production incident** (`PROD_INCIDENT_PREFIXES` in `assets/scheduler.py`):
it preempts `slim`, `find`, 7-day `friction` cooldown, and the `steady` gate (including in `--auto` mode),
routing directly to `friction` / `operation` on the real owning code object (`market`, `paper`, `live`,
`ledger`, `engine`, `deploy`).

## Strictly read-only collector (`doctor.py prod-snapshot`) and unattended cron pipeline

Build the redacted snapshot with `doctor.py prod-snapshot` (strictly read-only on all input paths;
refuses `.env`, `dolt/service.json`, `telegram.json`, `*secret*`, `*credential*`, `*token*`, `*key*`,
and `*.pem`/`*.p12`/`*.pfx`; uses bounded/streaming reads and redacts all summaries):

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="/tmp/doctor-prod-${TS}"
mkdir -p "${OUT}"

# 1. Assemble redacted, credential-free state.json (read-only)
uv run --frozen python .agents/skills/product-doctor/assets/doctor.py prod-snapshot \
  --market-dir "${MARKET_DIR}" \
  --paper-root "${PAPER_ROOT}" \
  --live-root "${LIVE_ROOT}" \
  --compare-json "${OUT}/paper-compare.json" "${OUT}/live-compare.json" \
  --notify-log "${OUT}/live-notify.log" \
  --ledger-status-json "${OUT}/ledger-status.json" \
  --ledger-export-dir "${OUT}/ledger-export" \
  --ops-status-json "${OUT}/ops-status.json" \
  --repo-root "${REPO_ROOT}" \
  --out "${OUT}/state.json"

# 2. Gate with 0-token steady exit code (2 = steady, 0 = actionable incident/audit)
uv run --frozen python .agents/skills/product-doctor/assets/doctor.py advise \
  --tree origin/main --auto --steady-exit-code 2 \
  --issues-json "${OUT}/issues.json" \
  --ci-json "${OUT}/ci.json" \
  --prod-logs "${OUT}/paper.log" "${OUT}/live.log" \
  --prod-state "${OUT}/state.json"
```

- Exit code `2`: steady state holds (zero actionable harm, zero active prod logs/invariants, zero slim
  triggers, zero SLA breaches, saturated yield). The cron wrapper exits cleanly with zero LLM tokens.
- Exit code `0`: an actionable harm finding, silent prod invariant violation, explicit prod log incident,
  or scheduled audit requires diagnosis; wake the diagnosis agent with `${OUT}`.

## 200U bounded live regression -> redacted `tests/soak/` feedback loop

Trading on the primary real account is always outside every audit (`AGENTS.md`). The dedicated 200 USDT
test account is used only for bounded Live regression smoke checks **after** multi-contract offline soak
checks pass (`SKILL.md` Step 4).

Whenever a 200U bounded smoke check, `--prod-logs`, or `--prod-state` uncovers a new real Binance edge
case (non-standard exchange payload, out-of-order WebSocket/REST event, delisting rollover, partial fill
or liquidation state-machine corner, or silent notify/checkpoint stall):

1. **Extract & redact the minimal failing payload**: strip every API key, signature, listen key, order
   client token, account balance secret, and host path. Keep only the minimal deterministic event/state
   sequence that reproduces the defect.
2. **Promote into offline soak fixtures (`tests/soak/`)**: add a deterministic offline case under
   `tests/soak/` (and its paired unit/probe assertion) that fails before the fix and passes after it.
   No live credential or network access is ever required to run `tests/soak/`.
3. **Verify before re-testing on 200U**: run `tests/soak/` and the full test suite locally so future PRs
   and `doctor.py recheck` catch the regression in seconds offline instead of rediscovering it on live funds.
