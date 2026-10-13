# Records: rounds, freezes, confirmations and reads

Run every command from the repository root as
`uv run --frozen python -m research.records.cli [--ledger NAME] ...`. Without `--ledger` the active
ledger is used. Output is JSON; an error is JSON on stderr with `code`, `message`, `next_actions`
and `write_status` (`not_written`: this command wrote nothing). Writes are idempotent: rerunning
the same command returns the original record with `replayed: true`. `CONCURRENT_WRITE` means
another write landed first; reread, then rerun.

## Rounds

One goal is one round: the branch `round/<goal_id>`, tagged `closed/<goal_id>` read-only at the end.
Only the open round is written; there is at most one.

```bash
uv run --frozen python -m research.records.cli round open --goal /tmp/RUNDIR/goal.json
uv run --frozen python -m research.records.cli round status
uv run --frozen python -m research.records.cli round close
```

The goal file is in [feasibility.md](feasibility.md). `round status` returns the goal, trial and run
counts, every legacy target freeze, and registered valid/invalid/unfinished attempts.
The Agent records review cadence and reasons; no product stop flag is inferred.

## Strategy revisions

```bash
uv run --frozen python -m research.records.cli strategy publish --source /tmp/RUNDIR/strategy.py \
  --strategy-id ID --entry-class ENTRY-CLASS --description "Rule and non-claims." \
  [--parent ID@N --difference "What changed."]
uv run --frozen python -m research.records.cli strategy show ID@N
uv run --frozen python -m research.records.cli strategy export ID@N --destination /tmp/RUNDIR/strategy.py
```

`publish` parses the file without running it and returns `ID@N` (revisions count up per ID). The
same bytes cannot be published twice. A derivation names its parent revision and the difference;
nothing is inferred from names or code similarity.

## Freeze

Freeze one sealed run of a published revision on the goal's development window
([runs.md](runs.md)), when a target snapshot is requested ([feasibility.md](feasibility.md)); this never gates research:

```bash
uv run --frozen python -m research.records.cli freeze --run RUN-ID --source-bundle BUNDLE \
  [--failed-part gross_edge|cost|frequency|tail|integrity] --note "At most 2000 characters."
```

- The verdict is `passed`, `failed` or `invalid` (the run failed its audit). `failed` requires
  `--failed-part`, and any other verdict refuses one; a refusal returns the gates with their values,
  so run once without it to see them. The numbers live in the run's readings, not in the note.
- The freeze records `distinct_sources`: the distinct strategy source hashes of all trials
  overlapping the development window, explorations included.
- It is refused from a checkout that lacks origin/main, for a run on an image not built on main, or
  for a window other than the goal's. After it is written, its ledger commit gets an RFC 3161
  timestamp from a public authority; if that fails the freeze stays written and
  `ledger witness` retries it.

## Confirmation and corrections

```bash
uv run --frozen python -m research.records.cli confirm plan --freeze FREEZE-ID \
  --window-start START --window-end END
uv run --frozen python -m research.records.cli confirm verdict --plan PLAN-ID --run RUN-ID \
  [--failed-part PART] --note "..."
uv run --frozen python -m research.records.cli correct --freeze FREEZE-ID|--verdict VERDICT-ID \
  --result passed|failed|invalid [--failed-part PART] --note "Why the original was wrong."
```

See [confirmation.md](confirmation.md). A correction never changes the original; `freeze_latest`
and `verdict_latest` apply the newest correction.

## Evidence

```bash
uv run --frozen python -m research.records.cli evidence add --bundle BUNDLE /tmp/RUNDIR/bundle-dir
uv run --frozen python -m research.records.cli evidence export BUNDLE --destination /tmp/RUNDIR/restored
```

A bundle is insert-only; empty files and media files are refused.

## Reading the ledger

`ledger sql` runs one read-only statement as the reader account, on the open round unless `--at`
names a branch or tag such as `closed/<goal_id>`; blobs print as their length. Cite the run, freeze
or verdict ID with the ledger commit (`round status`, `ledger status`).

```bash
uv run --frozen python -m research.records.cli ledger sql "SELECT freeze_id, result, failed_part FROM freeze_latest"
uv run --frozen python -m research.records.cli ledger sql --at closed/GOAL-ID \
  "SELECT r.run_id, o.instrument_id, COUNT(*) FROM run_order o JOIN run r ON r.run_id = o.run_id GROUP BY 1, 2"
uv run --frozen python -m research.records.cli ledger sql \
  "SELECT run_id, plan_win_rate, return_drawdown, max_drawdown, plans_closed FROM run"
uv run --frozen python -m research.records.cli ledger sql \
  "SELECT to_freeze_id, diff_type, to_commit FROM dolt_diff_freeze"
uv run --frozen python -m research.records.cli ledger sql \
  "SELECT strategy_source_sha256, COUNT(*) FROM trial GROUP BY 1 ORDER BY 2 DESC"
uv run --frozen python -m research.records.cli ledger export --at closed/GOAL-ID --output /tmp/RUNDIR/parquet
```

`AS OF '<tag or commit>'` reads a table as it was then; `dolt_diff_<table>` shows when each row was
added (a modified or removed row is a finding). `ledger export` writes every table at one ref as
Parquet. `ledger audit` checks a whole round (commit tests, append-only history, stored readings
against a recomputation, freeze verdicts and trial counts, timestamps).

## Continuous candidate operations

Use [hypotheses.md](hypotheses.md) for the locked JSON and [runs.md](runs.md) for register/run/compare.
`candidate list [--at REF]` returns complete source lineage, registered attempts and validity;
`hypothesis compare --id BUNDLE --run RUN-ID [--at REF]` is read-only evidence, without adoption.
Append its output and Agent diagnostic/recommendation/priority notes using existing `evidence add`.
New ledgers use schema-v2; old schema-v1 records are read without migration. Research commands refuse
schema-v1 rather than silently modifying its structure. Use a new isolated database for fixtures.
