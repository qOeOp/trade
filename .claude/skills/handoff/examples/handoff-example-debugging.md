# Handoff — intermittent 500 on /reports export (debugging)

> Generated: 2026-05-30T15-30-00-000Z · Continues from: none
> Variant of the general template, tuned for an in-progress investigation. Read top-to-bottom.

## Metadata
- Project: ./acme-api
- Git branch: fix/reports-500 · HEAD: 2b7de04 · Tree: clean
- Agent / model: Claude Code (opus)

## Current State (read this first)
`GET /reports/:id/export` returns 500 roughly 1 in 5 calls under concurrency; single calls always
succeed. The error is a connection-pool timeout, not the report logic. Leading suspect is a pool
exhaustion caused by a query that holds a connection across an `await` to S3.
- Blocking right now: nothing blocking; next probe is identified.

## Symptom (verbatim)
- Repro: `for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/reports/42/export & done; wait`
- Observed: `TimeoutError: timeout exceeded when trying to connect` from `pg-pool`, ~4/20 calls
- Expected: 20/20 return 200 with the CSV body
- First seen / frequency: after the export-to-S3 change in `8c10f2e`; ~20% under 20-way concurrency

## Hypotheses
- [ ] pool too small (default 10) — status: open; weak, raising it only masks a leak
- [x] connection held across the S3 upload `await` — status: SUPPORTED; pool drains as concurrency rises
- [ ] S3 client itself slow — status: ruled out; S3 PUT p99 is 40ms in logs

## What is RULED OUT — DO NOT REDO
- [x] report SQL is correct and fast (12ms) — confirmed via `EXPLAIN ANALYZE`, not the cause
- [x] not an auth/middleware issue — failures occur after the handler starts (trace shows handler entry)

## Evidence gathered
- `src/reports/export.ts:61` acquires a client with `pool.connect()`, then at line 74 `await
  s3.putObject(...)` runs BEFORE `client.release()` at line 81 — connection is pinned for the whole
  upload.
- Pool metric `pg_pool_waiting` spikes to 9 during the repro (logged via `src/db/metrics.ts`).

## Leading suspect
The client acquired at `src/reports/export.ts:61` is released only after the S3 upload completes
(`:81`). Under concurrency the pool is exhausted while uploads are in flight → connect timeout.

## Immediate Next Step
Move `client.release()` to immediately after the DB read finishes (`src/reports/export.ts:72`,
before the S3 `await`), so the connection is returned before the upload. Then re-run the repro
loop above and watch `pg_pool_waiting`.

## Files / Areas Touched
<read-files>
src/reports/export.ts
src/db/pool.ts
src/db/metrics.ts
</read-files>
<modified-files>
</modified-files>

## Gotchas / Landmines
- The repro is concurrency-dependent — a single curl will NOT reproduce it; always run the 20-way loop.
- `pool.connect()` and a transaction (`BEGIN`) are different release paths; export uses a plain
  read, so a simple early `release()` is safe here (no open transaction).

## Verification (copy-paste, exact)
```bash
for i in $(seq 1 20); do curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/reports/42/export & done; wait
npm test -- src/reports/export.test.ts
```
Expected once fixed: 20/20 return 200; `pg_pool_waiting` stays ≤1; export test green.

## Open Questions (preserve verbatim)
- None outstanding from the user.

## Handoff Chain
- Continues from: none
- This doc: handoffs/handoff-2026-05-30T15-30-00-000Z.md
