# Research records, evidence and native artifact custody

Dolt is the only persistent owner of complete strategy source revisions,
research registrations, decisions, evidence originals and relationships. The existing `research.records` domain
interface owns the contract; its adapter owns storage and atomic publication.
Git keeps maintained shared tools, runtime image build inputs, tests and
retained historical source evidence. Strategy drafts stay outside product Git. There
are no experiment JSON receipts in the product tree and no Git metadata backend.
The native runner and Nautilus reports remain the trading facts; the records
API does not schedule research or create a second account ledger.

Agent procedures live in the `research-round` skill: complete strategy source in
[strategy-authoring.md](../../.agents/skills/research-round/references/strategy-authoring.md),
records, decisions, evidence and `compare` in
[publish.md](../../.agents/skills/research-round/references/publish.md), and native runs in
[seal.md](../../.agents/skills/research-round/references/seal.md). This guide covers the store's
configuration and protocol, tests, access, retention and recovery.

Maintained contract tests and regression fixtures live in `tests/records/`.
Their synthetic repositories and reports use temporary directories and are
cleaned up after each test; they are not research records. Run the suite with:

```bash
uv run --frozen python -m unittest discover -s tests/records -t . -p 'test_*.py'
```

`RESEARCH_DOLT_TEST_CONFIG` enables the real Dolt integration tests. They create
and drop separate `records_test_*` databases; CI supplies the pinned local Dolt
service.

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
  --root "$HOME/.local/share/trade/records" --port 13326
uv run --frozen python -m research.records.cli ledger start
uv run --frozen python -m research.records.cli ledger status
```

`TRADE_RECORDS_CONFIG` selects the configuration file; its default is
`~/.local/share/trade/records/backend.json`. The service binds to the loopback interface. Keep the configuration
and database root private and use a separately configured external backup
directory. `ledger start/stop` operate this local service; they do not install
an operating-system startup service. Missing configuration, an unavailable
server or an unsupported schema fails visibly. Readers do not silently fall
back to Git.

The local service and artifact custody currently depend on POSIX process,
socket, user ownership and permission APIs on macOS/Linux hosts. Native Windows
host support is not implemented; a Windows dependency wheel alone is not proof
that this custody path works there. The execution image separately supports
`linux/arm64` and `linux/amd64`. Configure the installed Dolt binary, private
storage directories and `TRADE_RECORDS_CONFIG` for each host; an old machine's
absolute configuration paths are not portable defaults.

## Store protocol

Attempts, runs and strategies are written only through `publish attempt`,
`artifacts register` and `strategy publish`; evidence originals only through
`material retain`. The store adapter refuses a write from a caller that does
not name its publication API, and every publication refuses a Dolt working set
with uncommitted SQL changes.

Each domain read uses one fixed Dolt commit; Git source commits and Dolt record
commits are different identities. A publication binds objects, relations, a
version guard and a durable operation receipt to one native Dolt commit. Lineage
reads follow each relation's fixed endpoint revision, so a later parent revision
never rewrites an older child's evidence.

These are tamper-evident identities and refusals against mistakes on the normal
API path, not a barrier. A SQL administrator or any process running as the same
user can still alter data outside the API, and nothing proves that an Agent never
saw a result through another route; detecting that is the job of separate audits
(see `docs/plans/skill-product-form-audit.zh.md`). The checks do not
authenticate reviewer identity or judge scientific value. A new runtime contract
must reach supported readers before shared publication; tests and demonstrations
use isolated databases.

## Access, retention, and disaster recovery

The configured artifact root and backup root must be owned by the account
running custody and have mode `0700`. New sealed and restored directories use
`0700`; files use `0600`. The command rejects a permissive root instead of
silently changing a shared directory when creating a run or backup. On an existing root, restrict the root,
all run directories, and files before the next write, then run `verify` again.
Do not put exchange credentials in the artifact root.
Persistent database, configuration, artifact and backup paths
must be outside both `/tmp` and the platform's current temporary directory
(including a custom `TMPDIR`), after resolving symlinks. Temporary research
drafts and diagnostic outputs may still use those directories.

New exploration defaults to temporary scripts and outputs under `/tmp`. A
formal experiment retains a compact preregistration/exposure/decision record,
including useful negative results; execution logs are not automatically useful
knowledge. Git keeps shared tooling, image build inputs, tests and retained
historical evidence. Dolt keeps complete strategy bytes, research metadata and
decision evidence originals; Catalog holds exact reusable inputs once. One-off
code necessary to reconstruct a retained conclusion belongs in a frozen external
recipe, not the product tree; retain the recipe and its verification output with
`material retain` and cite them from the decision.

Before retaining full results, decide whether exact source, locked environment,
accessible input bytes, parameters and a command can reconstruct them. A hash
without accessible bytes is insufficient. Verified rebuildable output is a
cache, not a mandatory permanent record. Retain irrecoverable source/evidence
or costly results only with an explicit value and recovery reason. A compact
observation/stop decision is kept even when its detailed report can be generated.

Existing sealed runs and immutable historical evidence are not rewritten by
this policy. A cited seal cannot be pruned merely because it looks reproducible:
first verify a replacement/reconstruction contract, record that decision and its
evidence in the attempt's decision, and preserve the run's historical
availability status.
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
copied by this command and need their own recovery plan. Image bytes are also
not copied: retain a digest-addressable registry backup or image archive and
verify it on restoration. Report restoration alone is not replay recovery.

Video source media live under the artifact root at `source_media/sha256/<sha256>.<ext>`, with
their evidence bundles in `source_media/bundles/` (the `video-evidence` skill with
`VIDEO_EVIDENCE_ROOT=$TRADE_RESEARCH_ARTIFACT_ROOT/source_media`); directories are `0700` and files
`0600`. The name cannot collide with a run directory because run IDs contain no `_`. An attempt
cites each media file by content address as a top-level `{"kind": "source_gate", "path":
"artifact://source_media/sha256/<sha256>.<ext>", "sha256": ...}` ref, which `show` and `validate`
re-hash (a mismatch fails) and the publish preflight reports when unavailable or mismatched (`compare`
reads run audit refs only); the hash reads the whole file into memory. Small cited bundle files go
through `material retain`. `artifacts backup` and `restore` copy runs only, so `source_media` needs its own copy:
`rsync -a --ignore-existing` of `sha256/` and `rsync -a` of `bundles/` into the backup root's
`source_media/`, then a hash loop over both copies (the skill's `custody.md`). Restore copies the
files back the same way and checks each file's SHA-256 against its name.

Schema v1 seals froze a Git commit's `strategies/r1/` source and ran it on the
host; that execution mode is retired. `verify`, `report`, `backup` and `restore`
still read v1 seals under their original source/hash contract. `register`
requires the start-time `record_binding`, which no retained v1 seal has, so v1
seals are not registered after the fact. There is no Git metadata backend or
implicit source fallback.

The trial ledger was backed up locally and reset on 2026-10-09. Dolt IDs and
commits in plans written before the reset refer to that archive; read them in a
separately recovered ledger (see the next section). The archive also holds
material imports, import reviews and knowledge admissions, which current code
no longer reads or writes; run the records CLI from Git commit `9794ed307` against
the recovered archive to read them. External recipes that import the removed
`backtest/r1/checks/compare_paired_returns.py` run from a checkout of commit
`3b3b4876b` with `PYTHONPATH` set to it; all eight reproduced their retained
outputs there on 2026-10-10.

```bash
uv run --frozen python -m research.records.artifacts verify --root "$ARTIFACT_ROOT" --run-id RUN-ID
uv run --frozen python -m research.records.artifacts backup --root "$ARTIFACT_ROOT" --run-id RUN-ID \
  --backup-root /path/to/second/directory
uv run --frozen python -m research.records.artifacts restore --root "$ARTIFACT_ROOT" --run-id RUN-ID \
  --destination /path/to/new/output
```

A read-only provenance audit lives outside Git with its README:
`$HOME/.local/share/trade/research-audits/provenance/run.sh`. It runs `validate` from a detached
origin/main worktree, so a relaxed local checkout cannot weaken it. It then checks that every
commit after the bootstrap commits is one API publication, history is append-only, dates are
monotonic and agree with the reflog or a saved reflog snapshot, and seal, backup and cited commits
are ancestors of HEAD. It connects as a SELECT-only Dolt user created by `create-audit-user.sh` in
the same directory. Results and reflog snapshots stay in its `results/`; keep them, because
automatic GC clears the reflog. A `dolt backup restore` does not carry `data/.doltcfg/privileges.db`;
copy it before the first start or rerun `create-audit-user.sh`.

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
database name and pinned Dolt version. On another host, set `binary` to that
host's installed absolute path and update any explicitly configured socket path.
Keep the primary configuration intact. From
the repository root, start and query that recovered service:

```bash
TRADE_RECORDS_CONFIG=/path/to/recovery-backend.json \
  uv run --frozen python -m research.records.cli ledger start
TRADE_RECORDS_CONFIG=/path/to/recovery-backend.json \
  uv run --frozen python -m research.records.cli ledger status
```

Before accepting recovery, read `ledger status`, compare all object and relation
revisions at the saved commit, restore representative material bytes and compare
their SHA-256, then read a representative attempt at its saved revision and its
original operation receipt. Also verify the run's separately restored native manifest and reports.
Do not publish new records before this comparison: recovery should preserve the
original commit rather than create a logically similar replacement.

After the drill, stop the recovered service using `ledger stop` with the same
separate `TRADE_RECORDS_CONFIG`.

An independent disaster-recovery acceptance additionally makes the primary
unavailable and performs this drill on another administered host or storage
boundary. A backup and server restored in two directories on this machine prove
local recovery only. Restoring Dolt does not restore OCI images, Catalog inputs or native report
directories. Full replay recovery verifies and exports the source at the saved
Dolt commit, restores the exact image manifest/platform and canonical inputs,
then invokes the same native runner without requiring the current product Git
checkout. Preserve and test these recovery chains separately.
