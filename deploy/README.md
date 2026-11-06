# deploy

`compose.yaml` is the whole deployment, the same on a workstation and a server with a native
linux/arm64 or linux/amd64 Docker engine. `.github/workflows/ide-image.yml` builds and exercises
all three images on each native CPU, then publishes a shared platform manifest. The Dockerfile selects
the checksum-pinned Dolt 2.4.2 binary for that architecture; no CPU emulation is used.
Five services on one Docker engine:

- **ide**: the trade IDE page and its chat service ([`ide/`](../ide/README.md)). Image `ghcr.io/qoeop/trade-ide`. It reads ledger with the
  reader account only, and the market directory through a read-only mount: its profiles (compose configs, `kind` null) name the reader-only
  `service.json` ledger writes into the `trade-ledger-readers` volume, never ledger's own, so it holds
  no root password, writer account or DoltHub key. The chat service's agents and threads stay in the
  `trade-ide-agent` volume. It mounts the `trade-market-import` volume read-only for market-import's
  status file, which its status bar shows. Published on 127.0.0.1:8765.
- **ledger**: the Dolt service of the research ledger, run by `ledger service run`. Image
  `ghcr.io/qoeop/trade-service`. Published on 127.0.0.1:13330, where the host's command line reaches it.
  On first start, with empty directories, it bootstraps the ledger from its public copy and needs the
  DoltHub key (`TRADE_DOLTHUB`, default `$TRADE_DATA/dolthub`: a `dolt login` `~/.dolt`). Every start
  also writes a reader-only `service.json` (the port and the reader accounts, no root password or
  writer) into the `trade-ledger-readers` volume, for a container that only reads. Its memory is capped at
  `TRADE_LEDGER_MEMORY` (default `40g`).
- **market-import**: the unattended import of Binance data (`market follow`; `market/README.md`,
  "Unattended upkeep"): the bars of `--bar-symbols` daily, open interest and long/short ratios daily
  and quotes and aggTrades monthly for the contracts its `--symbols` name, each from its own first month or day; the
  range is this service's command line and the directory does not record it. Same image. It is the only
  writer of the market directory `$TRADE_DATA/market`, mounted read-write. Its market profile is the
  compose config `market-import`. It reaches `data.binance.vision` and `fapi.binance.com` for bars. Its archive cache
  (kept, about 3 GB of aggTrades a month) and status file stay in the `trade-market-import` volume.
  `docker compose ps market-import` shows unhealthy while anything is stopped or lagging, and
  `docker compose logs market-import` gives each round; restarting it retries what stopped.
- **paper**: the paper daemon behind the Paper panel. Same image; reached only by ide. Its market profile
  is the compose config `market`: membership, stored bars and a reconciliation's replay inputs from
  the market directory, mounted read-only.
- **docker-api**: the only way to Docker, for paper. It allows exactly the calls paper makes, and of containers
  only those `runtime/container.py` builds ([`docker-api/`](docker-api/), image `ghcr.io/qoeop/trade-docker-api`).

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
(`$TRADE_DATA/ledgers/market.json`) names it as `root` and nothing else, so the host never fetches. Market
writes run in market-import (`docker compose exec market-import python -m cli.main market
... --market /run/trade/market-import.json`): the import lock excludes only processes that share the Docker
VM's kernel.

```json
{"name": "market", "kind": "market", "role": "active", "root": "/Users/me/.local/share/trade/market"}
```

On a new machine the ledger starts first: its bootstrap refuses a profile directory that already holds a
profile, so `market.json` is written after ledger is healthy.

The market directory is plain files with no copy. If it is lost, start market-import: it recomputes bars, funding,
members, metrics, aggTrades and quotes from the Binance archives over its configured range, about 100 GB of downloads
and some days of work (estimated, never run whole), and observes terms anew. Sealed runs stay readable,
reproducible and comparable: the observation time is not part of the input identity, and a contract with bars at an
older commit trades there on its earliest stored terms.

The import does not bring back one lost file while its month's `bar/` file stands, because it goes by the bars' months.
Above all a lost `funding/` file: `market follow` does not notice it and `MONTH_EXISTS` refuses the month, and a replay
then settles nothing for it. Recompute into a new directory and copy the file over, and check that every `bar/` month
has its `funding/` file.

The ledger service, the paper daemon and the market import restart with Docker. A service whose
`service.json` has no socket is run this way: host commands reach it over TCP, and `ledger service stop`
refuses it (`docker compose stop ledger`).

## Updating

All three images move with every merge into `main`, and `docker compose up -d` recreates each service whose
image moved, ledger included. Update only the services a change reaches, by name:

```bash
docker compose -f deploy/compose.yaml pull ide paper
docker compose -f deploy/compose.yaml up -d --no-deps --wait ide paper
```

A service needs it when the commits since its image's revision change code it runs or its entry here
(`docker-api/` for docker-api). The revision is the image label
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
- **market-import**: an import under way stops; the next round imports it again, since a file takes its place only
  once it is whole, and an abandoned temporary file is removed at the next import.
- **ide**: the page reconnects by itself; a chat answer being written is cut off.
