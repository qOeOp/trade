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
| `schema.sql` | schema-v2 for new research ledgers, applied on `main` by `ledger init` (field review: `docs/plans/ws2-ledger-field-review.zh.md`) |
| `ledger.py` | profiles, the Dolt service lifecycle, rounds, status, backup, Parquet export, read-only SQL, temporary ledgers |
| `db.py` | one connection per command, the single write transaction |
| `hypotheses.py`, `comparison.py` | immutable evidence registration, atomic grid custody, candidate forest and read-only paired development comparison |
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
one; the full trial history exposes selection pressure; no attempt counter terminates continuous research. Commit tests (`dolt_tests`, group
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

## Continuous candidate entry

Complete strategy revisions remain candidates irrespective of economics, significance or recommendation.
`hypothesis register` uses immutable evidence; `artifacts run --hypothesis` consumes a registered cell
atomically with its trial. `candidate list` reads source lineage and replay evidence; `hypothesis compare`
provides descriptive effect/interval/p evidence after identity/integrity checks. Invalid runs provide
no economic feedback. Agent priorities, recommendations and review cadence use existing append-only
notes. No product adoption state, scheduler or fixed-count stopping rule is added.

Schema-v2 is for newly initialized isolated ledgers. This branch does not migrate active/old ledgers;
legacy goal/run/freeze/confirmation reads remain. The legacy target freeze/confirmation checks are
unchanged as independent interfaces and do not gate candidate development. A test-branch runtime
cannot meet their main-image requirement.

Market inputs come from a fixed WS8b Dolt market commit through the reader account. `--market-profile`
selects an explicit market profile JSON independently of research `TRADE_LEDGER_HOME`. The actual
minute contract and registration/run/compare examples are in the skill's [runs.md](../../.agents/skills/research-round/references/runs.md).

## Current economic availability and original execution custody

The shared `availability` view is distinct from immutable `run.status` and the original G account
verdict. Report, candidate list, comparison, round counts and native-analysis tables apply it:
real fills need matching orders, position cycles, audited economics and account records. Zero-fill
runs remain diagnostic attempts with null economics and no comparison inference. No positive fee,
funding amount, frequency, sample-size, return or significance cutoff is introduced. Retained
identity-bound Agent source failures are disclosed separately from account audit; losses and
non-significance never prevent descendants. An unusable parent may be repaired with no comparison
control. Legacy missing original logs remain missing, with explicit applicability/reader identity.

Current `r1-native-v7` adds fail-closed source callback/constructor exception capture while keeping
one-minute native execution. Published sources receive an exact-source native engineering precheck
and separately attributed Agent source/API/causal/activity/readiness review before registration.
Only a predeclared exact precheck is exempt from source exposure; generic exploration is not.
See the research-round authoring and hypothesis references for the CLI and JSON contract.

Original runner/auditor stdout/stderr, source bytes, phase exits and structured exceptions are
append-only product-owned evidence bundles tied to the original trial. Captured-empty, missing and
not-started are distinct. The start receipt shares the atomic trial transaction. Normal failure or
interruption captures in `finally`; hard process kill cannot promise final capture and preserves a
missing final receipt and original working-directory location. Later probes do not replace original
stderr. Existing schema-v2 tables suffice; no new columns or log service are added (review:
[storage decision](../../docs/plans/p010-p013-storage-review.zh.md)).

Every fresh market export includes read-only fixed-commit coverage facts for raw LAST/MARK minutes,
alignment, zero volume, funding times and member months. First/last observations are data proxies,
not authoritative listing/delisting dates. Actual indicator readiness remains source/Agent evidence;
coverage does not synthesize data, choose windows or declare full-pool acceptance.
