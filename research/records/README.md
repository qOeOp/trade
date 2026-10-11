# Research ledger

Persistent research data lives only in Dolt (and its `dolt_backup` copy): strategy source, stored
runs with their native reports, derived evidence, freezes and confirmations. Everything else is a
working copy under `/tmp`. The native runner and Nautilus reports remain the trading facts; this
package stores them and computes the product readings, it does not schedule research.

Agent procedures live in the `research-round` skill ([records.md](../../.agents/skills/research-round/references/records.md),
[runs.md](../../.agents/skills/research-round/references/runs.md)). This guide covers the service,
its accounts, the write protocol, backup, tests and what the guarantees are.

| Module | Holds |
|---|---|
| `schema.sql` | the one schema generation, applied on `main` by `ledger init` (field review: `docs/plans/ws2-ledger-field-review.zh.md`) |
| `ledger.py` | profiles, the Dolt service lifecycle, rounds, status, backup, Parquet export, read-only SQL, temporary ledgers |
| `db.py` | one connection per command, the single write transaction |
| `records.py` | goal, strategy revisions, evidence, trials, run storage, freezes, confirmations, corrections |
| `analysis.py` | product readings (reconciled economics, plan win rate, MARK drawdown; `closed_by_year` derived on read), exploration readings and `tables()` |
| `artifacts.py`, `trials.py`, `runtime.py` | every native replay, its trial row and run storage, the pinned CI image |
| `witness.py`, `tsa-roots.pem`, `audit.py` | RFC 3161 timestamps of freezes and confirmation plans, and the full round audit |

## Services, databases and profiles

One Dolt 2.4.2 `sql-server` per service directory, reachable only through its unix socket (and the
loopback port Dolt requires). A service can hold several databases: the research ledger now, the
market data database of WS8b later. A profile names one database on one service; commands select it
with `--ledger NAME` (default: the profile whose role is `active`). Profiles are JSON files in
`~/.local/share/trade/ledgers/`; `TRADE_LEDGER_HOME` points elsewhere for tests and demonstrations.

```bash
uv run --frozen python -m research.records.cli ledger init --name research --database research \
  --service-root "$HOME/.local/share/trade/dolt" --binary /absolute/path/to/dolt-2.4.2 \
  --port 13330 --role active --backup-root "$HOME/.local/share/trade/dolt-backups"
uv run --frozen python -m research.records.cli ledger status
uv run --frozen python -m research.records.cli ledger start --ledger research
uv run --frozen python -m research.records.cli ledger stop --ledger research
```

- The service directory holds `config.yaml`, `data/`, `cfg/` (privileges and branch control),
  `service.json` (socket path and account passwords, mode 0600) and `server.log`. The socket path
  must stay under 100 bytes (macOS); keep the service root short.
- `ledger init` on an existing service root adds another database with its own accounts. Branch
  writes need an explicit grant on this service, and the commit-test group `commit` applies to every
  database on it: a new database needs at least one `dolt_tests` row in that group, or every commit
  in it is refused.
- Roles: one `active` profile; `isolated` and `temporary` profiles must use a different database
  name, checked at creation and on every write. `ledger temp --name N --binary B -- CMD` starts a
  throwaway service and ledger, runs `CMD` (which names `--ledger N`) and deletes both.
- `ledger status` lists every profile, whether its service runs, the open round and its head.

## Accounts and what is guaranteed

Per database: a writer (`SELECT`, `INSERT`; `UPDATE` on `ledger_head` only; `EXECUTE` on the
procedure `dolt_commit` only, never database-wide, which would allow reset, tag deletion and amend)
and a reader (`SELECT`). Branch control grants the writer the open round's branch only; `round
close` withdraws it and tags the head `closed/<goal_id>`. Round management, backup and schema work
use the service's root account.

The guarantee is **changes leave traces, not changes are impossible**. Whoever runs as the same
system user can read `service.json` and act as root, or edit the data directory. What remains:
insert-only accounts on the normal path; `created_at` set by triggers to server time (commit dates
can be forged with `--date`); every row's insertion visible in `dolt_diff_<table>` and every
modification or removal reported by `ledger audit`; every freeze and confirmation-plan commit
timestamped under RFC 3161 by a public authority (DigiCert, else Sectigo; only the commit hash leaves
the machine), the token stored in the `witness` table and verified offline against the roots in
`tsa-roots.pem` as of its own time. A timestamp shows that a record existed by then, not that it was
the only one: a root user could register several plans on other branches and show the favourable
one; the trial counts and stop rules, not the timestamp, bound that. Commit tests (`dolt_tests`, group
`commit`) catch mistakes on the normal path and can be skipped with `--skip-verification`; they are
not a trust boundary.

## Write protocol

Each write is one transaction on one connection on the open round's branch:

1. refuse a dirty working set (another session's uncommitted SQL would otherwise be committed with
   this write);
2. return the original record when the operation ID already exists (idempotent retries);
3. insert, then set `ledger_head` to `seq + 1` and this write's operation ID, then `dolt_commit`.

Two concurrent writers both change the `ledger_head` row to different values, so Dolt refuses the
later commit with error 1213 (`CONCURRENT_WRITE`) instead of merging them. Comparing branch heads is
not enough (rows changed in different places merge), and two writes that set the row to the same
value would also merge, which is why the operation ID is written there. Reads never revalidate the
ledger; `ledger audit` does.

## Rounds and reads

`round open --goal` branches `round/<goal_id>` from `main` and records the goal; `round close` tags
it. `main` only holds the schema, so each round starts empty and old rounds keep their own schema
under their tags (`AS OF` reads the tagged tables). `ledger sql` (reader account) and
`ledger export --at REF --output DIR` (every table as Parquet, streamed) read any branch or tag.

## Backup and restore

`ledger backup` runs `dolt_backup('sync-url', ...)` into `<backup root>/<database>`: every branch,
tag and commit. Repeat it after a round's freezes; it is incremental. To restore, into a new
service directory's `data/`:

```bash
cd /new/service/data && /absolute/path/to/dolt-2.4.2 backup restore file:///path/to/backup/research research
```

Accounts and branch grants live in the service's `cfg/`, not in the database; recreate them by
running `ledger init` for a new profile or copy `cfg/` and `service.json` from the original service.

## Tests

```bash
RESEARCH_DOLT_BINARY=/absolute/path/to/dolt-2.4.2 \
  uv run --frozen python -m unittest discover -s tests -t . -p 'test_*.py'
```

Integration tests start their own Dolt service under `/tmp` with their own profile directory, stop
it and delete it; they skip without a Dolt 2.4.2 binary (`RESEARCH_DOLT_BINARY` or `dolt` on PATH)
and refuse to run when the profile directory in use holds an active ledger.

## Not here

Old ledgers, sealed artifact directories and their backups are outside this design and are deleted
in WS7. Only the `r1-native-v4` runtime layout is known; seals of earlier contracts are not read.
