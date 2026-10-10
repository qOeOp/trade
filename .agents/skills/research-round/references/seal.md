# Seal, register and read a native run

A run that a decision cites goes through `artifacts run`, `verify`, `backup` and `register`.
`ARTIFACT_ROOT` is a private directory outside Git and `/tmp`, owned by you with mode `0700`, for
example `$HOME/.local/share/trade/research-artifacts`. Use one persistent root for every run you may
compare or cite: `show`, `compare` and `validate` resolve `artifact://` runs against the single
`TRADE_RESEARCH_ARTIFACT_ROOT`, so a control sealed elsewhere cannot be read beside its candidate.
Publish the pending attempt first ([publish.md](publish.md)): `run` binds its initial registration
at start, and a seal without that binding can never be registered.

## Identities

- **Source.** `--strategy-id`, `--strategy-revision` and `--source-at` must equal `strategy_id`,
  `revision` and `commit` in the attempt's `strategy_binding`; anything else is refused.
- **Runtime.** A JSON file with exactly `image_ref` (registry path plus `@sha256:` manifest digest),
  the matching `image_digest`, `platform` (`linux/arm64` or `linux/amd64`) and a `runtime_contract`
  equal to the strategy's. A tag or Docker configuration ID is not an identity. `docker pull` that
  exact reference first; `run` refuses an absent or mismatched image. A candidate and its control
  need the same image.
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
  --runtime /retained/runtime-identity.json --input-identity /retained/input-identity.json -- \
  --catalog-root MINUTE-CATALOG --daily-root DAILY-CATALOG --quantity-csv QUANTITIES.csv \
  --coins COIN [COIN ...] --start START --trade-start TRADE-START --end END \
  --signal-variant SIGNAL --exit-variant EXIT [--risk-budget-bps BPS] \
  [--coin-notional-cap-pct PCT] [--daily-warmup]
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
- Any other statistic follows the `nautilus-report-analysis` skill.
- `restore` recovers reports only, not the image or inputs.
- Record commands resolve `artifact://` references through `TRADE_RESEARCH_ARTIFACT_ROOT`.
