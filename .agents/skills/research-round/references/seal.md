# Seal, register and read a native run

Every native replay goes through `artifacts run`: `--explore` for a draft (below), a seal for a run
that a decision cites, followed by `verify`, `backup` and `register`. Each run reports one trial
(strategy source hash, window, coins, image digest, mode); selection pressure is counted from them.
Never start a replay or a probe with `docker run` or a direct runner command.
`ARTIFACT_ROOT` is a private directory outside Git and `/tmp`, owned by you with mode `0700`, for
example `$HOME/.local/share/trade/research-artifacts`. Use one persistent root for every run you may
compare or cite: `show`, `compare` and `validate` resolve `artifact://` runs against the single
`TRADE_RESEARCH_ARTIFACT_ROOT`, so a control sealed elsewhere cannot be read beside its candidate.
Publish the pending attempt first ([publish.md](publish.md)): `run` binds its initial registration
at start, and a seal without that binding can never be registered.

## Identities

- **Source.** `--strategy-id`, `--strategy-revision` and `--source-at` must equal `strategy_id`,
  `revision` and `commit` in the attempt's `strategy_binding`; anything else is refused.
- **Runtime.** CI builds every image (`ghcr.io/qoeop/trade-runtime`); none is built locally. Without
  `--runtime`, `run` pulls the current main image (tag `main`) and records its manifest digest.
  `--runtime` takes another CI reference, such as a pull request's `pr-N` tag or a digest from a
  seal, for exploration or engineering. The image's contract label must equal the strategy's
  `runtime_contract`. A candidate and its control need the same digest. `register` accepts only an
  image whose `org.opencontainers.image.revision` is on origin/main and whose observed runtime code
  equals that commit's: merge a missing product capability first, then rerun on the main image.
- **Inputs.** For new input data, hash the prepared Catalogs and keep the JSON with its canonical
  input contract; the inputs stay in their Catalogs:

```bash
uv run --frozen python -m research.records.artifacts input-identity \
  --catalog-root MINUTE-CATALOG --daily-root DAILY-CATALOG --quantity-csv QUANTITIES.csv \
  --coins COIN [COIN ...] --output /retained/input-identity.json
```

## Run

```bash
uv run --frozen python -m research.records.artifacts run \
  --root "$ARTIFACT_ROOT" --run-id RUN-ID --attempt-id ATTEMPT-ID \
  --strategy-id STRATEGY-ID --strategy-revision REVISION --source-at BINDING-COMMIT \
  --input-identity /retained/input-identity.json -- \
  --catalog-root MINUTE-CATALOG --daily-root DAILY-CATALOG --quantity-csv QUANTITIES.csv \
  --coins COIN [COIN ...] --start START --trade-start TRADE-START --end END \
  --signal-variant SIGNAL --exit-variant EXIT [--daily-warmup]
```

- Arguments after `--` go to the replay runner. `run` supplies the strategy file, class, hash,
  bindings and output itself and refuses those flags. Run IDs use letters, digits and hyphens and
  are never reused or overwritten.
- Times carry `Z` or an explicit UTC offset, at most six fractional digits, and fall on five-minute
  UTC boundaries with `start <= trade-start < end`; `start` to `trade-start` is warmup.
- Replay and native audit run in the pinned image without network, with read-only source and inputs
  whose trees are hashed before and after.
- A failed execution seals a `failed` manifest: keep it as a diagnostic, with no invented account
  results. `passed` means custody and native integrity checks passed, not that the strategy meets a
  goal. The audit checks report identities, links, end-of-run protection and reported economics
  ([strategy-authoring.md](strategy-authoring.md)). It does not prove a signal clock, staged-exit
  races or source-specific risk rules; add native checks before claiming them.

## Explore a draft

```bash
uv run --frozen python -m research.records.artifacts run --explore \
  --strategy-file /tmp/RUNDIR/strategy.py --strategy-class ENTRY-CLASS --output /tmp/RUNDIR/pilot -- \
  --catalog-root MINUTE-CATALOG --daily-root DAILY-CATALOG --quantity-csv QUANTITIES.csv \
  --coins COIN [COIN ...] --start START --trade-start TRADE-START --end END \
  --signal-variant SIGNAL --exit-variant EXIT [--daily-warmup]
```

- The same image, sandbox, runner and native audit as a seal; nothing is sealed or registered and
  no Dolt is read. `--output` must be a new directory under `/tmp`; it receives `reports/`, the
  logs, `runtime-inspection.json` and `trial.json`.
- The trial counts toward selection pressure like a sealed run.
- For a Nautilus behavior probe, run a script from `/tmp` on the host with
  `uv run --frozen --project REPO python /tmp/RUNDIR/probe.py`; it imports `backtest` and `research`
  without `PYTHONPATH`.

## Verify, back up and register

```bash
uv run --frozen python -m research.records.artifacts verify --root "$ARTIFACT_ROOT" --run-id RUN-ID
uv run --frozen python -m research.records.artifacts backup --root "$ARTIFACT_ROOT" --run-id RUN-ID \
  --backup-root BACKUP-ROOT
uv run --frozen python -m research.records.artifacts register --root "$ARTIFACT_ROOT" --run-id RUN-ID \
  --role candidate --control-run-id CONTROL-RUN-ID --cost-model 'COST-MODEL' --dry-run
```

Then run `register` again without `--dry-run`.

- `--role` is `candidate`, `control` or `diagnostic`. Register a control before its candidate. A
  failed seal registers as `diagnostic` without a native summary.
- `--cost-model`: read the control's recorded `cost_model`, confirm both seals used the same native
  fees and funding, and reuse its exact text; `compare` refuses any textual difference.
- `--dry-run` writes nothing and, for a candidate with a control, adds `pair_preflight` (the record
  checks `compare` applies). It only reports: fix an `incomparable` finding before the real write.
- `--evidence-grade` defaults to `development_exposed`. `independent` is accepted only for a passed
  seal that runs the exact `strategy_binding` of the attempt's first registration and whose trade
  window starts after that registration's Dolt commit time ([confirmation.md](confirmation.md)).
- `register` binds the manifest SHA-256 and the source and runtime identities in Dolt. Rerunning the
  same registration recovers the original publication.

## Read a seal

```bash
uv run --frozen python -m research.records.artifacts report --root "$ARTIFACT_ROOT" --run-id RUN-ID
uv run --frozen python -m research.records.artifacts restore --root "$ARTIFACT_ROOT" --run-id RUN-ID \
  --destination NEW-PATH
```

`restore` refuses a destination that already exists.

- `report` verifies the seal and prints the closed-position PnL split (fill price, commissions,
  funding), open positions and unrealized residual only when they reconcile to the audited native
  economics. It reads no Dolt; a failed seal reports null economics.
- Its `plans` (`closed`, `wins`, `win_rate`, `open`) is the goal's plan win rate
  ([feasibility.md](feasibility.md)). It is null, with the reason in `limitations`, when an order
  lacks a plan tag or carries two, plans on one instrument overlap, or a position and a plan do
  not map one to one ([strategy-authoring.md](strategy-authoring.md)).
- Any other statistic follows the `nautilus-report-analysis` skill, which loads the seal with
  `research.records.analysis.tables()`.
- `restore` recovers reports only, not the image or inputs.
- Record commands resolve `artifact://` references through `TRADE_RESEARCH_ARTIFACT_ROOT`.
