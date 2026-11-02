# deploy

`compose.yaml` is the whole deployment, the same on a workstation and a server, provided the
Docker engine is linux/arm64: `.github/workflows/ide-image.yml` builds both images for that platform
only, and the Dockerfile downloads only the arm64 Dolt tarball and fails on any other architecture.
Six services on one Docker engine:

- **ide**: the trade IDE page and its chat service ([`ide/`](../ide/README.md)). Image `ghcr.io/qoeop/trade-ide`. It reads ledger with the
  reader account only, and the market directory through a read-only mount: its profiles (compose configs, `kind` null) name the reader-only
  `service.json` ledger writes into the `trade-ledger-readers` volume, never ledger's own, so it holds
  no root password, writer account or DoltHub key. The chat service's agents and threads stay in the
  `trade-ide-agent` volume. It mounts the `trade-market-import` volume read-only for market-import's
  status file, which its status bar shows. Published on 127.0.0.1:8765. An IDE from before 2026-10-30 kept its own
  database copy and the agents in `trade-ide-data`; switching copies that volume's `agent/` into
  `trade-ide-agent` once, and compose no longer mounts or removes the old volume.
- **ledger**: the Dolt service of the research ledger, run by `ledger service run`. Image
  `ghcr.io/qoeop/trade-service`. Published on 127.0.0.1:13330, where the host's command line reaches it.
  On first start, with empty directories, it bootstraps the ledger from its public copy and needs the
  DoltHub key (`TRADE_DOLTHUB`, default `$TRADE_DATA/dolthub`: a `dolt login` `~/.dolt`). Every start
  also writes a reader-only `service.json` (the port and the reader accounts, no root password or
  writer) into the `trade-ledger-readers` volume, for a container that only reads. A service that held
  the Dolt market before 2026-11-03 keeps it, unread. Its memory is capped at `TRADE_LEDGER_MEMORY`
  (default `40g`; `docs/plans/market-dolt-memory.zh.md`).
- **market-import**: the unattended import of Binance data (`market follow`; `market/README.md`,
  "Unattended upkeep"): bars of the market's own scope daily, open interest and long/short ratios daily
  and quotes and aggTrades monthly for the contracts its `--symbols` name. Same image. It is the only
  writer of the market directory `$TRADE_DATA/market`, mounted read-write. Its market profile is the
  compose config `market-import`: role `active`, the public R2 copy as `origin` (`TRADE_MARKET_ORIGIN`)
  and the R2 write key as `upload`, after each write publishing the market there. The key file
  (`TRADE_MARKET_KEY`, default `~/.config/trade/r2-market.json`: `{endpoint, bucket, access_key_id,
  secret_access_key}`, mode 600) is mounted into this service only. It reaches `data.binance.vision`,
  `fapi.binance.com` for bars, and the R2 endpoint. Its archive cache
  (kept, about 3 GB of aggTrades a month) and status file stay in the `trade-market-import` volume.
  `docker compose ps market-import` shows unhealthy while anything is stopped or lagging, and
  `docker compose logs market-import` gives each round; restarting it retries what stopped.
- **market-record**: Binance's and Bybit's liquidation pushes, written down as they arrive (`market
  record-liquidations`; [`docs/plans/liquidation-recording.zh.md`](../docs/plans/liquidation-recording.zh.md)).
  Same image. It holds no database account: every frame, with the wall and monotonic clocks of its arrival, goes to
  a spool of one file per venue and UTC day in the `trade-market-record` volume, the source of the market's
  liquidation import; nothing is deleted from it. It reaches `fstream.binance.com`, `stream.bybit.com` and
  `api.bybit.com`. `docker compose ps market-record` shows unhealthy while a venue's spool has taken no line for
  2 minutes; each failed connection is in `docker compose logs market-record`.
- **paper**: the paper daemon behind the Paper panel. Same image; reached only by ide. Its market profile
  is the compose config `paper-market`: membership, stored bars and a reconciliation's replay inputs from
  the market directory, mounted read-only.
- **docker-api**: the only way to Docker, for paper. It allows exactly the calls paper makes
  (`docker-api.cfg`).

The design is in [`docs/plans/paper-compose-deployment.zh.md`](../docs/plans/paper-compose-deployment.zh.md),
[`docs/plans/ledger-compose-service.zh.md`](../docs/plans/ledger-compose-service.zh.md) and
[`docs/plans/daily-metrics-import.zh.md`](../docs/plans/daily-metrics-import.zh.md) with
[`docs/plans/monthly-market-import.zh.md`](../docs/plans/monthly-market-import.zh.md). The
host directories are mounted at their own paths. `.env` beside the compose file names them and the
user the services run as:

```bash
printf 'TRADE_UID=%s\nTRADE_GID=%s\nTRADE_DATA=%s\n' "$(id -u)" "$(id -g)" "$HOME/.local/share/trade" > deploy/.env
docker compose -f deploy/compose.yaml up -d   # then open http://127.0.0.1:8765/
```

The host's command line reads the same market directory: the active market profile
(`$TRADE_DATA/ledgers/market.json`) names it as `root` and nothing else, so the host never fetches or
publishes. Market writes run in market-import (`docker compose exec market-import python -m cli.main market
... --market /run/trade/market-import.json`): the import lock excludes only processes that share the Docker
VM's kernel.

```json
{"name": "market", "kind": "market", "role": "active", "root": "/Users/me/.local/share/trade/market"}
```

The ledger service, the paper daemon and the metrics import restart with Docker. A service whose
`service.json` has no socket is run this way: host commands reach it over TCP, and `ledger service stop`
refuses it (`docker compose stop ledger`).

## Updating

Both images move with every merge into `main`, and `docker compose up -d` recreates each service whose
image moved, ledger included. Update only the services a change reaches, by name:

```bash
docker compose -f deploy/compose.yaml pull ide paper
docker compose -f deploy/compose.yaml up -d --no-deps --wait ide paper
```

A service needs it when the commits since its image's revision change code it runs or its entry here
(`docker-api.cfg` for docker-api). The revision is the image label
`org.opencontainers.image.revision`:

```bash
docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "$(docker inspect -f '{{.Image}}' trade-ide-paper-1)"
```

Each restart takes seconds; what it interrupts decides when to make it:

- **ledger**: a command line write under way fails and is rerun as it is: writes are idempotent by
  operation. A replay holds no connection while its containers run, so only one that opens or seals its
  trial within the restart's seconds fails; `docker ps --filter network=none` lists running replay
  stages.
- **paper**: its runs are containers of their own and keep running; a reconciliation runs inside the
  daemon and is lost. `docker top trade-ide-paper-1` shows a running `paper reconcile`.
- **docker-api**: a reconciliation's replay attaches through it for up to an hour; the same check.
- **market-import**: an import under way stops; the next round imports it again, since a version is
  written only once its files are.
- **ide**: the page reconnects by itself; a chat answer being written is cut off.
