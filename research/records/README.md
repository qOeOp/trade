# Research records, materials and native artifact custody

Dolt is the only persistent owner of research registrations, decisions,
material revisions and relationships. The existing `research.records` domain
interface owns the contract; its adapter owns storage and atomic publication.
Git keeps maintained strategy/tool source and retained source evidence. There
are no experiment JSON receipts in the product tree and no Git metadata backend.
The native runner and Nautilus reports remain the trading facts; the records
API does not schedule research or create a second account ledger.

The v2 attempt contract replaces the pilot Git-registration contract. Existing
trial records are migrated as retrospective observations, preserving their
questions, decisions and fixed historical evidence. This migration does not
create a pre-result registration or strategy qualification. Unsupported old
attempt snapshots fail validation rather than entering a compatibility path.
`history.json` still locates historical source bytes for evidence retrieval.

Maintained contract tests and regression fixtures live in `tests/records/`.
Their synthetic repositories and reports use temporary directories and are
cleaned up after each test; they are not research records. Run the suite with:

```bash
uv run --frozen python -m unittest discover -s tests/records -t . -p 'test_*.py'
```

`RESEARCH_DOLT_TEST_CONFIG` enables the real Dolt integration tests. They create
and drop separate `records_test_*` databases; CI supplies the pinned local Dolt
service. Production indexing accepts explicitly retained source payloads and
does not load test manifests or import fixtures by default.

## Configure the local store

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
uv run --frozen python -m research.records.cli ledger import --paths docs/plans/SELECTED-SOURCE.md --dry-run
uv run --frozen python -m research.records.cli ledger import --paths docs/plans/SELECTED-SOURCE.md
```

`TRADE_RECORDS_CONFIG` selects the configuration file; its default is
`~/.local/share/trade/records/backend.json`. The service binds to the loopback interface. Keep the configuration
and database root private and use a separately configured external backup
directory. `ledger start/stop` operate this local service; they do not install
an operating-system startup service. Missing configuration, an unavailable
server or an unsupported schema fails visibly. Readers do not silently fall
back to Git.

The importer keeps original bytes, SHA-256, source Git commit/path, worktree
state and section locations. It archives material; even an `attempt.json` or
`run.json` is source material, never a registration. Only the record API writes
attempt/run identities and their research relations. Explicit source links can
produce references for Agent review. A changed source produces a new revision;
unchanged material does not create a revision merely because Git HEAD changed.

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
start in the sealed manifest; result registration uses that exact initial
registration binding. A seal without a valid start-time binding is rejected;
existing trial runs cannot supply a missing registration after the fact.

`find` returns an object with `storage` and `matches`; `show`, `compare` and
`validate` add `storage` to their result. For Dolt, `storage.commit` is the
fixed snapshot read by the command. New preregistered attempts also expose their
initial `registration_receipt`; a full `show` includes the registered contract
separately from the current decision.

## Knowledge admission and default retrieval

`material search QUERY` reads compact research decisions and explicitly admitted
knowledge at one Dolt commit. It matches independent research IDs and readable
fields; hashes/base64 and publication/reference receipts are not search text.
Use `--include-archive` to inspect unadmitted historical source and operational
metadata. Import completion and the 572 reference resolutions do not admit
knowledge. Corrected source revisions and explicitly affected historical source
rationales carry their fixed correction endpoints and narrow scope; a correction
does not invalidate an unrelated economic failure.

New archive imports require `ledger import --paths path/to/source.md --dry-run`
and then the same explicit selection without `--dry-run`. Import cannot create
attempt/run records or bypass the registration API.

The Agent can publish a retention decision from a reviewed external JSON file:

```bash
uv run --frozen python -m research.records.cli material admit \
  --file /path/to/admission.json --expected-version CURRENT-VERSION \
  --operation-id UNIQUE-ADMISSION-ID
```

The v1 body contains `schema_version: 1`, a fixed `target: {id, revision}`,
`disposition: knowledge|archive`, `reviewer`, `purpose`, `value_basis`, a compact
`claim: {statement, scope, decision_impact, limitations}`, fixed `evidence`
object references, and `retention: {mode, reason}`. Mode is `minimal_record`,
`irreplaceable` or `rebuildable`. The last mode also requires hash-verified
external `recipe_ref` and `verification_ref` files (`{path, sha256}`), outside
Git and `/tmp`. Knowledge admission reviews the current target revision; raw
payloads and operational receipts cannot themselves be admitted as knowledge.
Changing the target requires a new review. An archive decision removes the
claim from the default knowledge view without deleting historical evidence.

The API checks identities, compactness, accessible proofs and transaction
retries. It does not prove the Agent's substantive value judgement, the recipe's
scientific validity or strategy qualification. Measure usefulness with real
research tasks: correct prior conclusions, recognised withdrawals, repeated
experiments avoided and reading cost. Object counts are not learning quality.

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

Before inspecting a **new** result, publish an attempt directly to Dolt from a
temporary JSON/API payload. Use `schema_version: 2`,
`registration: {"status": "preregistered"}`, and a
`contract: {"scope": "...", "plan": "..."}` with the original boundaries and
method. The initial decision is `pending/pending`. The Agent must answer these
questions in concrete terms:

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

Publish the pending payload once; no Git receipt or second self-reference
commit is required:

```bash
uv run --frozen python -m research.records.cli ledger status
uv run --frozen python -m research.records.cli publish attempt \
  --file /tmp/MY-ATTEMPT-ID.json \
  --expected-version CURRENT-VERSION --operation-id MY-PREREGISTRATION-OPERATION-ID
```

The returned `registration_receipt` identifies the initial attempt ID, revision
and actual Dolt publication commit. Retain that fixed identity when citing the
research contract. Git strategy revisions and input identities remain explicit
independent references; the native custody runner verifies them and binds the
initial Dolt registration before invoking Nautilus.

Question, mechanism, hypothesis, scope/plan, parents, code parent, component
boundaries and other intent fields cannot change under the same attempt ID.
Parent and reused-mechanism references retain their registered endpoint
revisions even when those source records later change. Create a new attempt
for different intent or research dependencies. Later revisions can only append or
change `decision`, `evidence_refs` and the realized `comparison_family`; these
must not redefine the original contract. Do not populate a comparison family
with nonexistent run IDs before the runs exist. Result-derived interpretation
stays outside the initial revision.

Publication refuses a non-pending first preregistration. Fixed-version reads,
immutable API revisions and the runner's start-time receipt prevent unnoticed
contract replacement; they do not prove that an Agent has never observed the
data or result through another route. Exposure and scientific validity remain
explicit Agent obligations. Unsupported v1/Git registration is rejected rather
than normalized by the API. Temporary publication payloads are disposable after
successful Dolt publication; later decisions also use temporary payloads.

## Seal a new native R1 run

Use a directory outside Git and `/tmp`; the path below is an example. The
attempt must already have a committed preregistration. `--source-ref` identifies
the frozen strategy commit. The wrapper runs the **existing** native R1 runner
from those exact source bytes. New frozen commits use
`python -m backtest.r1.run_portfolio`; old commits retain their original
`strategies/r1/run_portfolio.py` entry. Source capture freezes the dependency
pins from the same commit, and new summaries bind each digest to its actual
source path. Historical seals keep their original path and hash contract.
Execution uses the invoking Python environment; capturing an older lockfile
does not provision its dependencies. Before replaying a commit with different
pins, prepare an environment matching that commit.
For a new input dataset, first create and review its identity with
`research.records.artifacts input-identity --catalog-root ... --daily-root ...
--quantity-csv ... --coins ... --output ...` and commit that small JSON file.

```bash
ARTIFACT_ROOT=/Users/vx/.local/share/trade/research-artifacts
uv run --frozen python -m research.records.artifacts run \
  --root "$ARTIFACT_ROOT" --run-id MY-RUN-ID --attempt-id MY-ATTEMPT-ID \
  --source-ref MY-FROZEN-COMMIT \
  --input-identity /path/to/retained/input-identity.json -- \
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

New exploration defaults to temporary scripts and outputs under `/tmp`. A
formal experiment retains a compact preregistration/exposure/decision record,
including useful negative results; execution logs are not automatically useful
knowledge. Git keeps maintained Strategy/tooling/tests and retained source evidence.
Dolt keeps research metadata, explicit knowledge claims and source identities;
Catalog holds exact reusable inputs once. One-off code necessary to reconstruct
an admitted claim belongs in a frozen external recipe, not the product tree.

Before retaining full results, decide whether exact source, locked environment,
accessible input bytes, parameters and a command can reconstruct them. A hash
without accessible bytes is insufficient. Verified rebuildable output is a
cache, not a mandatory permanent record. Retain irrecoverable source/evidence
or costly results only with an explicit value and recovery reason. A compact
observation/stop decision is kept even when its detailed report can be generated.

Existing sealed runs and immutable historical evidence are not rewritten by
this policy. A cited seal cannot be pruned merely because it looks reproducible:
first verify a replacement/reconstruction contract, publish the reviewed
retention decision, and preserve the run's historical availability status.
Abandoned `.staging`/`.quarantine` copies can be removed after checking no live
lock or registered run depends on them. There is no automatic destructive purge.

The pre-cutover files under `research/r1_native/`, `attempts/`, `runs/`,
`research/ledger_probe/` and `reports/` are read at the exact Git commit in
`history.json`. The explicit history reader and old hashed evidence references
read those blobs without restoring them into the working tree. Missing history
fails visibly; no automatic fetch or metadata backend fallback occurs.

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
