# Production Operations Auditing (`--prod-logs`, Silent Failure Taxonomy, and Soak Feedback Loop)

Logs alone (`--prod-logs`) only catch explicit crashes (`OOMKilled`, `exit 137`, `Traceback`,
`ERROR`, `PAPER_RECOVERY_UNAVAILABLE`, repeated `Paper checkpoint deferred:`, or 0-line empty logs).
Silent production failures emit zero error lines while stalling market ingestion, freezing Paper
checkpoints, leaving unsealed orphan directories, drifting replay vs execution, dropping daily
monitoring summaries, or letting backups and mirrors fall behind.

## Deterministic log intake (`--prod-logs`) and unattended cron gate

Feed production service logs to `doctor.py friction --prod-logs <log...>` or `doctor.py advise --prod-logs <log...>`:

```bash
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="/tmp/doctor-prod-${TS}"
mkdir -p "${OUT}"

# Gate with 0-token steady exit code (2 = steady, 0 = actionable incident/audit)
uv run --frozen python .agents/skills/product-doctor/assets/doctor.py advise \
  --tree origin/main --auto --steady-exit-code 2 \
  --issues-json "${OUT}/issues.json" \
  --ci-json "${OUT}/ci.json" \
  --prod-logs "${OUT}/paper.log" "${OUT}/live.log"
```

- Active production log incidents (`prod_oom_kill`, `prod_recovery_unavailable`, `prod_checkpoint_deferred`,
  `prod_log_empty`) are **un-coolable** (`PROD_INCIDENT_PREFIXES` in `assets/scheduler.py`): they preempt
  `slim`, `find`, 7-day `friction` cooldown, and the `steady` gate (including in `--auto` mode), routing
  directly to `friction` / `operation` on their owning service (`paper`, `live`, `ide`, `ledger`, `market`).
- Exit code `2`: steady state holds (zero actionable harm, zero active prod log incidents, zero slim triggers,
  zero SLA breaches, saturated yield). The cron wrapper exits cleanly with zero LLM tokens.
- Exit code `0`: an actionable harm finding, production log incident, or scheduled audit requires diagnosis;
  wake the diagnosis agent with `${OUT}`.

## Silent operational failure taxonomy (probe under `operation` and `lifecycle`)

Because silent failures emit no `ERROR` log line, an `operation` or `lifecycle` pass probes the real
code paths directly on isolated copies (`doctor.py probe`) against these failure classes:

| Failure class | Silent failure mode | Owning object | Why `--prod-logs` alone misses it |
|---|---|---|---|
| Market head stall | Lifecycle edge case (delisting/halt) stalls global freshness watermarks or threshold/suppression interaction renders an alert state unreachable | `market` | Clean `INFO` logs continue while market coverage silently stalls |
| Checkpoint / warmup stall | Active Paper run stalls without checkpoint advance or stays stuck in warmup | `paper` | Subscription or timer starvation stalls checkpoints with no exception |
| Unsealed orphan runs | Ended or aborted run directories remain unsealed after restart or daemon dispatch failure | `paper` / `live` | Daemon skips sealing cleanly with zero crash trace |
| Replay vs execution drift | `paper compare` / `live compare` leaves unexplained order/fill/position drift | `paper` / `live` / `engine` | Silent order drops, settlement boundary off-by-one, or fill distortion emit no error |
| Missing periodic notify heartbeat | Active monitor silently drops periodic summaries or alerts due to schema/wire-type mismatch or suppressed state | `live` / `paper` | Swallowed exceptions or consumer/producer type drift silence alerts without crashing |
| Backup, mirror & archive decay | `dolt_backup` or DoltHub mirror falls behind, Parquet writes are 0-row/corrupt, or private tables leak | `ledger` / `market` | Silent drift or truncated files accumulate until recovery fails |
| Disk, image & deploy drift | Disk fills, retained images go unpruned, containers flap, or host scripts import non-stdlib modules | `deploy` | Quiet resource exhaustion or broken upgrade path until an outage hits |

## Bounded live regression -> redacted `tests/soak/` feedback loop

Trading on the primary real account is always outside every audit (`AGENTS.md`). Any owner-authorized
bounded live regression smoke check runs only **after** multi-contract offline soak checks pass
(`SKILL.md` Step 4).

Whenever a bounded smoke check, `--prod-logs`, or an `operation` audit uncovers a new real exchange
edge case (non-standard exchange payload, out-of-order WebSocket/REST event, delisting rollover,
partial fill or liquidation state-machine corner, or silent notify/checkpoint stall):

1. **Extract & redact the minimal failing payload**: strip every API key, signature, listen key, order
   client token, account balance secret, and host path. Keep only the minimal deterministic event/state
   sequence that reproduces the defect.
2. **Promote into offline soak fixtures (`tests/soak/`)**: add a deterministic offline case under
   `tests/soak/` (and its paired unit/probe assertion) that fails before the fix and passes after it.
   No live credential or network access is ever required to run `tests/soak/`.
3. **Verify before any live re-test**: run `tests/soak/` and the full test suite locally so future PRs
   and `doctor.py recheck` catch the regression in seconds offline instead of rediscovering it on live funds.
