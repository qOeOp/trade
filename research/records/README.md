# Research records, materials and native artifact custody

Dolt is the single writer for research metadata and material revisions.
The existing `research.records` domain interface owns the record contract;
its Dolt adapter owns storage and atomic publication. Git owns strategy source,
frozen preregistration receipts and retained source evidence. Existing Git
attempt/run JSON files are a read-only historical import, available through
explicit `--backend git`. The native runner and Nautilus reports remain the
trading facts. There is no parallel research scheduler or account ledger.

Import preserves **retrospective** registration, temporary report status and
unknown history. It does not seal old `/tmp` CSVs or backdate preregistration.
H25a/H26a/H27a remain development evidence; F01 retains its original registered
four-cell design and results. D97/D98 are preregistered read-only diagnostics
with no new native run. Record counts come from `validate`,
not a manually maintained total in this guide. None of these records establishes
independent strategy qualification.

## Configure and migrate the local store

Use Dolt **2.4.2** with the dependencies pinned in `uv.lock`. Install the official
binary for the host platform outside the repository and verify its release
checksum. `ledger init` takes an absolute binary path and checks the version;
it does not replace a global Dolt installation. The database, configuration,
logs and backups belong outside Git and `/tmp` in a private directory.

```bash
uv sync --frozen
uv run --frozen python -m research.records.cli ledger init \
  --binary /absolute/path/to/dolt-2.4.2 \
  --root /Users/vx/.local/share/trade/records --port 13326
uv run --frozen python -m research.records.cli ledger start
uv run --frozen python -m research.records.cli ledger status
uv run --frozen python -m research.records.cli ledger import --historical-c02 --dry-run
uv run --frozen python -m research.records.cli ledger import --historical-c02
```

`--historical-c02` explicitly reads the retained original SOURCE_CASES bytes in
`fixtures/historical_sources.json`. The payload preserves the original commit,
path, Git blob OID and SHA-256; decoding verifies the exact bytes. The original
commit was local research history, so a fresh clone cannot assume it is present.
The fixture's own Git commit does not replace the original source identity.
Other historical selections still require their specified Git commits.

`TRADE_RECORDS_CONFIG` selects the configuration file; its default is
`~/.local/share/trade/records/backend.json`. `TRADE_RECORDS_BACKEND` defaults to
`dolt`. The service binds to the loopback interface. Keep the configuration
and database root private and use a separately configured external backup
directory. `ledger start/stop` operate this local service; they do not install
an operating-system startup service. Missing configuration, an unavailable
server or an unsupported schema fails visibly. Readers do not silently fall
back to Git.

The importer keeps original bytes, SHA-256, source Git commit/path, worktree
state and section locations. Objects have typed identities, such as
`attempt:H18a`, `material:research/r1_native/SOURCE_CASES.md` and
`component:ConfirmedLineSupportTouches`. Explicit JSON parents, component
boundaries and source links become relations with fixed endpoint revisions.
`--historical-c02` also imports the known earlier C02 source version for a
historical readback check. A changed source produces a new revision; unchanged
material does not create a revision merely because Git HEAD changed.

Similar headings or an ID in prose are not sufficient to infer support,
correction, refutation or inheritance. Such semantics remain in the review
queue for an Agent to assess. Automatic extraction does not claim general
semantic recall, source fidelity beyond preserved bytes, or improved research
decisions. Archived reports and notes can be read and restored through the
same interface; the existing Catalog and native evidence paths stay in place.

```bash
uv run --frozen python -m research.records.cli material search ConfirmedLineSupportTouches
uv run --frozen python -m research.records.cli material show material:research/r1_native/SOURCE_CASES.md
uv run --frozen python -m research.records.cli material show material:research/r1_native/SOURCE_CASES.md --revision 1
uv run --frozen python -m research.records.cli material restore material:research/r1_native/SOURCE_CASES.md \
  --destination /path/to/new/source-copy.md
uv run --frozen python -m research.records.cli --at EXACT-DOLT-COMMIT show H18a --brief
uv run --frozen python -m research.records.cli --backend git show H18a --brief
```

Each domain read uses one fixed Dolt commit for its snapshot. Record the exact
commit and object revision when citing evidence; Git source commits and Dolt
record commits are different identities. A publication binds objects,
relations, a version guard and a durable operation receipt to one native Dolt
commit. The same operation ID and content can recover the original result;
different content under that ID is rejected. An expected-version conflict
requires rereading and resolving the conflicting research state, not blindly
retrying at the next version. Append-only object revisions are an API protocol;
a SQL administrator can still alter data outside it.

Lineage reads follow each relation's fixed endpoint revision. Updating a parent
or a reused component's source decision does not rewrite an older child's
evidence. A native custody run captures its Dolt commit and attempt revision at
start in the sealed manifest; registration uses that binding. Older seals with
no binding may only be re-registered using an existing retained `run_of` edge.
Unregistered legacy seals require an explicit recovery review.

`find` returns an object with `storage` and `matches`; `show`, `compare` and
`validate` add `storage` to their result. For Dolt, `storage.commit` is the
fixed snapshot read by the command. The Git reader reports `read_only: true`.

## Review imported materials

An import inventory's `review_queue` is immutable. Review adds decisions for
each original occurrence, identified by inventory ID/revision, item index and
item hash; it does not remove items or rewrite the source inventory. The first
import has 572 occurrences: 452 unresolved local links, 108 unsafe local links,
11 headings with multiple IDs and one S46 source interpretation. The published
review commit `4ncs20jpinhtgbbtdq8t0es5pemf83ki` has 572 resolved, zero pending
and zero unavailable occurrences. The three installed-package links resolve to
pinned dependency descriptors; their excluded file contents and line bounds
were not inspected. This closes this inventory, not general research validation.

Use this original inventory and source snapshot when reviewing that queue:

```bash
REVIEW_INVENTORY='inventory:ea8dba226a5caaec278dd24237cc3de3f8a7faffa53ff882e91708fc75f607d1'
REVIEW_SOURCE_AT='rm3auu5u52edvuainhq5ofqt8b3n1r4l'
REVIEW_PLAN='/Users/vx/.local/share/trade/records/review-plans/import-review.json'
uv run --frozen python -m research.records.cli material review status "$REVIEW_INVENTORY" \
  --revision 1 --source-at "$REVIEW_SOURCE_AT" --items
uv run --frozen python -m research.records.cli material review prepare "$REVIEW_INVENTORY" \
  --revision 1 --source-at "$REVIEW_SOURCE_AT" \
  --decisions /path/to/agent-decisions.json \
  --supplemental /path/to/supplemental-objects.json --destination "$REVIEW_PLAN"
uv run --frozen python -m research.records.cli material review apply --file "$REVIEW_PLAN"
uv run --frozen python -m research.records.cli --at PUBLISHED_REVIEW_COMMIT \
  material review status "$REVIEW_INVENTORY" --revision 1 --source-at "$REVIEW_SOURCE_AT"
```

`status` projects the latest decision for every original occurrence as
`resolved`, `pending` or `unavailable`. Its `commit` is the decision read
snapshot; `source_snapshot_commit` is the separately fixed original inventory
snapshot. Use global `--at` for historical status reads. `prepare` and `apply`
use the current published store as their base and reject a historical write target.

`prepare` verifies references against the original source snapshot, incorporates
explicit Agent decisions and retained evidence, and creates a new JSON plan
outside Git and `/tmp`. It does not publish. The saved plan freezes the base
commit, expected version, operation ID, payload digest, proof objects, fixed
relations and per-occurrence `review_decision` objects. Inspect its projected
counts and evidence before applying it. Omit `--decisions` or `--supplemental`
when no such input is needed; unreviewed semantics remain pending.

The decisions manifest has a `decisions` list. Each entry binds `item_index`
and `item_sha256`, with a reviewer, rationale, explicit scope, status and fixed
evidence references. Closing an Agent review also requires its retained
decision file and SHA-256. Semantic relations use reviewed endpoint revisions
and a narrow scope. The supplemental manifest has an `objects` list containing
explicitly retained object DTOs with original bytes and provenance. A new copy
or acquisition records its later custody; it cannot establish that those bytes
were retained or available at the original snapshot.

`apply` verifies the frozen digest and publishes proofs, fixed edges and all
occurrence decisions in one local Dolt transaction. Reuse the same saved plan
after an uncertain response to recover its durable operation result. A version
conflict requires rereading the competing state and preparing a new plan;
editing the saved version or automatically overwriting is not a recovery rule.
`material show` exposes active resolved references from the latest review
decision revision. Superseded resolutions remain historical and do not enter
that projection.

Agents own source interpretation. A heading's primary ID can be disambiguated
without merging its other mentioned IDs. S46 can correct the source attribution
of C02 while retaining the existing D94/H27a/D95 evidence and H27a's economic
failure. Such review does not change a Strategy, backdate registration or
replace a new paired native replay when strategy or data behavior changes.

## One research round (Agent-owned)

The research Agent chooses the next question and the smallest experiment that
can falsify it. The user supplies the research goal and risk boundaries, not
instructions for every candidate. Before extending or combining hypotheses,
use `find`, then `show <id> --brief`; open full `show`, `compare`, and cited
native reports where the decision depends on them. Name the precise prior
claim supported or rejected, the hypothesis parent(s), any reused component,
the source parent, and the economic control. A reused component does not
inherit its source attempt's whole hypothesis or result.

Before inspecting a **new** result, write a short preregistration Markdown
file under `docs/plans/` and a pending `attempt.json` under
`research/records/attempts/<id>/`.
The Markdown must answer these questions in concrete terms:

1. What single mechanism changes, which native event should reveal its
   activation, and what observation would refute the mechanism? State source,
   data, execution, and economic stop conditions separately.
2. Which comparison is legal? Name the frozen control, strategy/account,
   input identity, instrument set, window, capital, risk and cost assumptions,
   source and dependency revision, primary **net account** response, and hard
   risk limits. Use a parent/child pair if B only exists with A; use `00/10/01/11`
   only when both changes can be independently switched on the same origin.
3. Which candidates were considered, what selection rule and maximum number
   of new runs are allowed, and which prior data windows, metrics, and results
   have already been seen? Name the data that can still provide independent
   confirmation, or state that none is available. Failed source or pilot gates
   remain in the candidate history; do not relabel a viewed window as holdout.
4. What observation selects the next action: stop, repair a data/execution
   defect, retain for independent confirmation, or ask a narrower question?
   Predefine the action threshold without reading the new economic result.

Initially commit the pending `attempt.json` receipt and Markdown together, with
`registration.reference` pointing to the Markdown,
`decision.layer=decision.outcome=pending`, and
without a self-referential `original_registration_commit`. Then record that
first commit in `original_registration_commit` in a second commit. Publish that
committed pending JSON to Dolt before running or inspecting the new result:

```bash
uv run --frozen python -m research.records.cli ledger status
uv run --frozen python -m research.records.cli publish attempt \
  --file research/records/attempts/MY-ATTEMPT-ID/attempt.json \
  --expected-version CURRENT-VERSION --operation-id MY-PREREGISTRATION-OPERATION-ID
```

The initial preregistered publication must be `pending/pending`, match its
committed Git JSON and cite an available original registration commit. Use a source
revision descended from the registration commit for the native custody run.
This two-commit sequence lets the runner check that a registration commit
exists before it runs; the Agent must still inspect the content and timing of
that commit. Do not fill `comparison_family` with nonexistent run IDs; add the
actual IDs after the runs. Keep result-derived fields and interpretation out
of the preregistration revision. The current schema does not have dedicated
`falsifier`, `selection_rule`, or `exposure` fields, and `validate` does not
check the four Markdown answers; these are Agent review obligations, not
machine-enforced gates. The Git receipt is frozen registration evidence, not a
second editable ledger. Later decision, evidence and comparison-family changes
are new Dolt revisions published with the same command from a JSON payload;
preserve the original registration identity and do not rewrite its receipt.

After a run, verify/register its native artifact and read the legal pair.
Give feedback in this order: question and control; verified native facts with
report references; unknown or unproven links; a falsifiable explanation; one
smallest next experiment and its stop condition. Distinguish a valid run from
an economically good strategy. An exposed development window can reject the
current candidate under its preregistered rule, but cannot by itself confirm
a selected strategy independently. If the evidence cannot distinguish two
explanations, report that limit rather than selecting the larger backtest
number. See [F01 preregistration](../../docs/plans/r1-factorial-line-cancel-prereg.zh.md)
for a four-cell design example; it predates this checklist and is not a
complete template for search budget and exposure. The [stepwise plan](../../docs/plans/rd-experiment-native-evidence-plan.zh.md)
describes how this contract will be evaluated.

Run from the repository root:

```bash
uv sync --frozen
TRADE_RESEARCH_ARTIFACT_ROOT=/path/to/local/artifacts uv run --frozen python -m research.records.cli validate
uv run --frozen python -m research.records.cli show H13c
uv run --frozen python -m research.records.cli show H18a
uv run --frozen python -m research.records.cli show F01
uv run --frozen python -m research.records.cli show F01 --brief
uv run --frozen python -m research.records.cli find --mechanism 61.8% --failure-layer source
uv run --frozen python -m research.records.cli find --component ConfirmedLineSupportTouches
uv run --frozen python -m research.records.cli compare H19a-2026-10-08 H18a-paired-2026-10-08
uv run --frozen python -m research.records.cli compare H18a-2026-10-08 H15a-paired-2026-10-08
uv run --frozen python -m research.records.cli compare F01-11-20261008 F01-10-20261008
```

Use `show <attempt-id> --brief` first for the hypothesis chain, decision,
four-cell run IDs, and evidence availability; use full `show` when checking
the exact record and report references. The compact view never substitutes
for `compare` or the native reports when deciding whether a result improved.

`validate` checks JSON Schema, references, SHA-256 of retained small reports,
the H19a/H18a summary's recorded window/account/source fields, and the native
audit result. For the H18a/H15a pair it also checks that four recorded source
file byte hashes match Git blobs at the frozen `e5a882101` commit. Other runs
without `source_revision` remain `unknown`. It reports whether cited registration
Git commit objects are present; that presence alone does not prove what was
registered or when results were read.
`compare` refuses a different registered control, input receipt,
window, account contract, recorded cost model, Nautilus version, instrument
universe, or failed audit. Its differences are descriptive on the already
exposed year. A recorded contract match does not independently prove matching
fees, funding, raw data bytes, or current availability of every CSV. The
historical `code_parent` commits are references to frozen source; this pilot
does not reconstruct a complete executable source and dependency bundle from them.

H18a is a real dependent-composition check: its hypothesis extends H15a, while
its line-state component comes from H08. H08's complete entry rule failed a
source gate; H18a does not inherit that rule. H18a's cancellation action only
exists for H15a's pending tiers, so a standalone H08 cell and a four-cell
factorial interaction are undefined. See the
[`case study`](../../docs/plans/research-record-h18a-case.zh.md).

F01's [four-cell result](../../docs/plans/r1-factorial-line-cancel-result.zh.md)
and [comparison report](../../reports/r1_factorial_f01/comparison.json) show
that the family can be indexed and read back even when the 11 cell fails its
economic goal. The historical and F01 full CSV reports currently live in
`/tmp` and are marked `temporary`; the small JSON reports and their hashes are
retained in Git. The new custody command below does not retroactively make these
old `/tmp` runs sealed. The contract and limits are in
[`docs/plans/research-record-contract.zh.md`](../../docs/plans/research-record-contract.zh.md).

## Seal a new native R1 run

Use a directory outside Git and `/tmp`; the path below is an example. The
attempt must already have a committed preregistration. `--source-ref` identifies
the frozen strategy commit. The wrapper runs the **existing** native
`run_portfolio.py` from those exact source bytes, not a second backtest engine.
For a new input dataset, first create and review its identity with
`research.records.artifacts input-identity --catalog-root ... --daily-root ...
--quantity-csv ... --coins ... --output ...` and commit that small JSON file.

```bash
ARTIFACT_ROOT=/Users/vx/.local/share/trade/research-artifacts
uv run --frozen python -m research.records.artifacts run \
  --root "$ARTIFACT_ROOT" --run-id MY-RUN-ID --attempt-id MY-ATTEMPT-ID \
  --source-ref MY-FROZEN-COMMIT \
  --input-identity research/r1_native/results/2026-10-07-input-identity.json -- \
  --catalog-root /path/to/minute-catalog --daily-root /path/to/daily-catalog \
  --quantity-csv /path/to/quantities.csv --coins BTC ETH \
  --start 2025-10-07T00:00:00Z --trade-start 2025-10-17T00:00:00Z \
  --end 2026-10-07T08:30:00Z \
  --signal-variant support-broad-two-tier-line-cancel-4h \
  --exit-variant tier-target-b --risk-budget-bps 25 \
  --coin-notional-cap-pct 5
```

The wrapper currently covers **R1 tiered variants with the pinned native tier
auditor**. It hashes selected minute/daily Catalog trees and quantity CSV before
and after replay, saves frozen source, lockfile, stdout/stderr, the six native
reports and the native audit, then atomically publishes `<root>/<run-id>`.
It never overwrites an existing run ID. A failed process also gets a sealed
`failed` manifest and remains available for diagnosis. `passed` means these
integrity checks passed; it does not mean that the strategy meets its economic
goal. The local root needs its own backup plan before disaster-recovery claims.

```bash
uv run --frozen python -m research.records.artifacts verify --root "$ARTIFACT_ROOT" --run-id MY-RUN-ID
uv run --frozen python -m research.records.artifacts backup --root "$ARTIFACT_ROOT" --run-id MY-RUN-ID --backup-root /path/to/second/local/directory
uv run --frozen python -m research.records.artifacts restore --root "$ARTIFACT_ROOT" --run-id MY-RUN-ID --destination /path/to/new/empty/output
uv run --frozen python -m research.records.artifacts register --root "$ARTIFACT_ROOT" --run-id MY-RUN-ID --role diagnostic --cost-model 'frozen native fees and Catalog funding'
TRADE_RESEARCH_ARTIFACT_ROOT="$ARTIFACT_ROOT" uv run --frozen python -m research.records.cli validate
```

`register` publishes a schema-checked run revision to Dolt; it does not create
another Git `run.json`. The record binds the external manifest by SHA-256 and
preserves the existing native evidence checks. The record CLI resolves `artifact://` refs through
`TRADE_RESEARCH_ARTIFACT_ROOT`. A failed run can be registered as a diagnostic
without inventing a native summary. Full raw inputs are referenced by their
verified identity and remain in the source Catalog.

## Access, retention, and disaster recovery

The configured artifact root and backup root must be owned by the account
running custody and have mode `0700`. New sealed and restored directories use
`0700`; files use `0600`. The command rejects a permissive root instead of
silently changing a shared directory when creating a run or backup. On an existing root, restrict the root,
all run directories, and files before the next write, then run `verify` again.
Do not put exchange credentials in the artifact root.

Dolt records, retained Git receipts and sealed runs, including failed runs, have
**no automatic expiry**: retain evidence while a run record cites its hashes. A deletion requires an
explicit research decision, a record update marking unavailable evidence, and
a verified replacement or an accepted loss of replay detail. This version has
no deletion command. Review abandoned `.staging` and `.quarantine` directories
after seven days; after checking no live lock or registered run depends on
them, remove unneeded diagnostic copies within 30 days. They are not sealed
evidence. Monitor disk capacity before starting large native replays; move the
root to larger storage rather than pruning referenced runs to free space.

`backup` proves a second copy has the same bytes; its result reports
`same_device_as_primary`. A second directory on the same machine is only local
copy recovery. To accept disaster recovery, place the backup on a separately
administered host or object store, record its owner and physical storage
boundary, verify the manifest there, make the primary unavailable, and restore
the reports on that independent host. Recheck the restored hashes against the
Dolt run record at its cited commit. Repeat a restore drill at least quarterly. An SSH or object
storage destination needs a separately authorized transport or mounted remote
filesystem; this CLI accepts filesystem paths only. Catalog inputs are not
copied by this command and need their own recovery plan.

## Back up and restore the record database

Database history needs its own backup in addition to sealed native reports.
`ledger backup` uses native `DOLT_BACKUP` to a filesystem URL, preserving Dolt
commits and branches; a logical SQL dump is not a replacement for that history.
Keep backups outside the repository and `/tmp`:

```bash
uv run --frozen python -m research.records.cli ledger status
uv run --frozen python -m research.records.cli ledger backup \
  --destination /path/to/record-backup
```

To rehearse recovery, retain the reported publication version and exact Dolt
commit, create a new empty private data directory, and use the same pinned
binary there. The backup URL must name the native backup directory; the
destination passed to `ledger backup` must be new and the working set must be
clean. Restore into the `data` subdirectory used by the service:

```bash
mkdir -m 700 /path/to/empty-record-recovery
mkdir -m 700 /path/to/empty-record-recovery/data
cd /path/to/empty-record-recovery/data
/absolute/path/to/dolt-2.4.2 backup restore \
  file:///path/to/record-backup research_records
```

Copy the primary backend configuration to a separate private file, change
`root` to `/path/to/empty-record-recovery` and `port` to `13327`, and keep its
database name and pinned binary. Keep the primary configuration intact. From
the repository root, start and query that recovered service:

```bash
TRADE_RECORDS_CONFIG=/path/to/recovery-backend.json \
  uv run --frozen python -m research.records.cli ledger start
TRADE_RECORDS_CONFIG=/path/to/recovery-backend.json \
  uv run --frozen python -m research.records.cli ledger status
```

Before accepting recovery, read `ledger status`, compare all object and relation
revisions at the saved commit, restore representative material bytes and compare
their SHA-256, then read the historical C02 revision and the original operation
receipt. Also verify the run's separately restored native manifest and reports.
Do not publish new records before this comparison: recovery should preserve the
original commit rather than create a logically similar replacement.

After the drill, stop the recovered service using `ledger stop` with the same
separate `TRADE_RECORDS_CONFIG`.

An independent disaster-recovery acceptance additionally makes the primary
unavailable and performs this drill on another administered host or storage
boundary. A backup and server restored in two directories on this machine prove
local recovery only. Restoring Dolt does not restore Catalog inputs or native
report directories; preserve and test those recovery chains separately.
