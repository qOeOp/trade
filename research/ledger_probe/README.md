# Versioned database validation probe

`fixture.json` and `contract.json` freeze the same small real-record sample for
Dolt and TerminusDB. This directory is a temporary validation tool, not a new
product ledger or research service. Existing files remain authoritative.

The fixture preserves fixed Git commit/path/blob SHA-256/locator, object
revision and typed relation endpoints. The historical C02 revision comes from
`2dd821cb206ee79975be5943bb3aa6f9c5bfe617`; the remaining frozen evidence comes
from `1b32849ca7ec6efd609b0a3bbbbd26bcd854103d`. The exact old SOURCE_CASES
blob is retained in `research/records/fixtures/historical_sources.json` with
its original commit/path, blob OID and byte hash; the fixture builder explicitly
verifies and reads those bytes without requiring an unpublished Git object.
This does not replace the original commit with the fixture's commit.
Import and simulated database
commits are **current validation transcriptions**, not original or prospective
research registration. C02 correction changes source interpretation while
preserving H27a's registered proxy and failed native result.

Run from the repository root:

```sh
uv run --frozen python research/ledger_probe/build_fixture.py --check
```

The command checks Git blob hashes, fixed relation references, the real S15
duplicate and H13b negative gate, and the frozen fixture/contract bytes. To
deliberately regenerate after reviewing a source change, edit the pinned
source constants and run the same command without `--check`; that creates a
new validation input and invalidates old backend results.

The seven acceptance classes require actual readback of scope, correction
impact, duplicate identity, transactional rollback, delayed concurrent
expected-version writes, lost-response idempotency, and complete native
history/branch/native-state recovery into a new empty directory. Current-state
JSON export does not satisfy the last class. Contract revision 3 retains the A7 calibration
before the A7 runs, requires creating and restoring a pending real-record copy
when the backend has a native uncommitted working set. A backend whose native
API commits every write reports `working_set_recovery=not_applicable`; all
commit history, branches and native storage still require complete recovery.
This condition cannot hide an existing unbacked working set. These cases do
not establish production suitability, broad semantic search or performance
at 10k objects. Before the formal A5 runs, revision 3 also makes writer a copy
H13b into revision 2 and writer b copy H13 into revision 2. Their object IDs and
operation IDs differ; only the expected global publication version is shared.
An expected-version/native transaction version conflict must reject one write;
a duplicate-key or duplicate-document conflict does not establish CAS safety.


## 2026-10-09 accepted evidence

Same contract v3 / 13 object revisions / 13 typed relations; actual versions:
**Dolt 2.4.2**, **TerminusDB 12.0.7** (`linux/arm64`). Frozen readbacks:
[dolt_result.json](dolt_result.json),
[terminus_result.json](terminus_result.json).

| Candidate / path | Result |
| --- | --- |
| Dolt A1–A7 | Passed; A5 three trials per ordinary / delayed-after-read mode, different real H13b@2 / H13@2 keys, one native version conflict each. |
| Dolt counter-only control | Unsafe: both writes succeeded at the same expected version. Unique per-operation token on the guarded row is required; this diagnostic is not a CAS acceptance pass. |
| TerminusDB A1–A4, A6–A7 | Passed. |
| TerminusDB A5 native header | Failed: both disjoint writes succeeded in both modes after native automatic retry; serial stale-header HTTP 400 is a separate passing control. |
| TerminusDB A5 WOQL condition | Both modes passed: one success / one empty binding→adapter conflict; no external lock. Native-header failure remains. |

Dolt requires the conditional version **and unique token**, objects / fixed
relations, operation fingerprint and `DOLT_COMMIT` in one native transaction.
TerminusDB's alternative re-evaluates the publication-version guard inside the
native WOQL transaction; HTTP 200 with empty bindings is a domain conflict.
A6 reads a persistent operation and native commit log through a fresh connection
to recover the original result / version / commit. It simulates discarding a
completed response, not actual TCP loss. A7 restored all Dolt branch histories
and a real pending working-set copy into a new empty MySQL instance. TerminusDB
restored the stopped server's full native storage volume into a new empty
container, matching old/current hashes, typed relations and three branch heads;
API-each-write commit makes working-set recovery inapplicable under v3.

Dolt's seven-class execution used accepted script SHA-256
`84bc94e60a6c6b2d9b039a305ff3ffd226cd5c0bb855626c332b3e94b8e9489c`
(649 lines). Current SHA-256
`4c3e61d68ae5a2900ed93e68c7361055ae4c44397a01f89f9c9d6c684bdc0b73`
(681 lines) adds the independently executed optional no-token route; the normal
path is unchanged. The saved acceptance does not claim byte-for-byte execution
of the later script. TerminusDB's executed/frozen script SHA-256 is
`db2a5ac56223164f067c86aacf6c177713ec6776b86f04654a51fc5a9b7415da`.
Results preserve the contract / fixture digests, API/SQL log and backup paths.

Binary / environment, data, logs and backups remain outside Git and `/tmp` at
`/Users/vx/.local/share/trade/ledger-probe/dolt-20261009` and
`/Users/vx/.local/share/trade/ledger-probe/terminus-20261009`; primary and restored
servers / containers are stopped. This is a test harness, including lifecycle,
assertions and evidence output. Line counts do not measure production
maintenance cost; Dolt's 2.43s excludes download, SDK install, fixture curation
and harness development. Neither probe establishes automatic Markdown
extraction, broad semantic recall, 10k capacity / latency, production permissions,
independent-host disaster recovery, strategy economics or qualification.
Append-only revisions remain a domain protocol / permission responsibility;
both backends permit later native updates. Existing `research.records` stays
the formal authority; no production ledger, strategy, blueprint or replay changed.

## Reproduce in fresh isolated environments

From the repository root, first run the fixture `--check` command above.
These commands target macOS arm64 with `uv`, Docker and free local ports
13316/13317 (Dolt), 16373/16374 (TerminusDB). Fresh external roots and result
filenames preserve frozen evidence; no global installation or project dependency
changes. Dolt bootstrap must precede its probe:

```sh
ledgerProbeStamp=$(date +%Y%m%dT%H%M%S)
doltProbeRoot="/Users/vx/.local/share/trade/ledger-probe/dolt-rerun-$ledgerProbeStamp"
mkdir -p "$doltProbeRoot/downloads" "$doltProbeRoot/bin"
curl -fLsS https://github.com/dolthub/dolt/releases/download/v2.4.2/dolt-darwin-arm64.tar.gz -o "$doltProbeRoot/downloads/dolt-darwin-arm64.tar.gz"
printf '%s  %s\n' edd31e01c59b0cbd5178fa4d6dbf5526d48e5654e41049ff6f4281e3ad366a7b "$doltProbeRoot/downloads/dolt-darwin-arm64.tar.gz" | shasum -a 256 -c -
tar -xzf "$doltProbeRoot/downloads/dolt-darwin-arm64.tar.gz" -C "$doltProbeRoot/bin"
uv venv "$doltProbeRoot/venv"
uv pip install --python "$doltProbeRoot/venv/bin/python" PyMySQL==1.1.2
"$doltProbeRoot/venv/bin/python" research/ledger_probe/dolt_probe.py --artifact-root "$doltProbeRoot" --port 13316 --cas-trials 3 --result "$doltProbeRoot/dolt_result.json"
# Optional standalone unsafe-control run, separate from A1–A7:
"$doltProbeRoot/venv/bin/python" research/ledger_probe/dolt_probe.py --artifact-root "$doltProbeRoot" --port 13316 --no-token-control --result "$doltProbeRoot/dolt_no_token_control.json"
```

Each Dolt invocation creates a unique `run-*` data/log/backup directory and stops
both servers. TerminusDB only accepts `--artifact-root` / `--result`; its primary
container name and ports are fixed. If the saved original owns the name, confirm
it is stopped and rename that disposable probe container to retain its original
volume / metadata. Omit `inspect` / `rename` when the name is already free;
use no prune or system cleanup. Start a new primary before the script:

```sh
ledgerProbeStamp=$(date +%Y%m%dT%H%M%S)
terminusProbeRoot="/Users/vx/.local/share/trade/ledger-probe/terminus-rerun-$ledgerProbeStamp"
mkdir -p "$terminusProbeRoot/storage" "$terminusProbeRoot/logs"
# Rename only after State.Running is false:
docker inspect --format '{{.State.Running}}' ledgerprobe-terminus-20261009
docker rename ledgerprobe-terminus-20261009 "ledgerprobe-terminus-preserved-$ledgerProbeStamp"
docker pull terminusdb/terminusdb-server:v12.0.7
docker run -d --platform linux/arm64 --name ledgerprobe-terminus-20261009 -p 127.0.0.1:16373:6363 -v "$terminusProbeRoot/storage:/app/terminusdb/storage" -e TERMINUSDB_ADMIN_PASS=ledgerprobe-isolated-validation-20261009 terminusdb/terminusdb-server:v12.0.7
uv run --frozen python research/ledger_probe/terminus_probe.py --artifact-root "$terminusProbeRoot" --result "$terminusProbeRoot/terminus_result.json"
```

The accepted image digest is
`sha256:385faf298ad77aaf2d4d6df5e84a4cbe3596d01dab2e3b991af905639ae56388`;
check the pulled image against it and record differences as new provenance.
The script waits for the primary, checks `/api/info`, starts its restored
container, then stops both and retains archives/logs/data. Read class statuses
and transcript, not process exit alone: native A5 intentionally remains failed.
Reusing an old root overwrites fixed HTTP log filenames; archive its result/logs
with a timestamp first. A fresh root avoids that overwrite.
