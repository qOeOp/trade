# deploy

`compose.yaml` is the whole deployment, the same on a workstation and a server, provided the
Docker engine is linux/arm64: `.github/workflows/ide-image.yml` builds both images for that platform
only, and the Dockerfile downloads only the arm64 Dolt tarball and fails on any other architecture.
Five services on one Docker engine:

- **ide**: the trade IDE page and its chat service ([`ide/`](../ide/README.md)). Image `ghcr.io/qoeop/trade-ide`. It reads ledger with the
  two reader accounts only: its profiles (compose configs, `kind` null) name the reader-only
  `service.json` ledger writes into the `trade-ledger-readers` volume, never ledger's own, so it holds
  no root password, writer account or DoltHub key. The chat service's agents and threads stay in the
  `trade-ide-agent` volume. Published on 127.0.0.1:8765. An IDE from before 2026-10-30 kept its own
  database copy and the agents in `trade-ide-data`; switching copies that volume's `agent/` into
  `trade-ide-agent` once, and compose no longer mounts or removes the old volume.
- **ledger**: the Dolt service of the research ledger and the market database, run by `ledger service
  run`. Image `ghcr.io/qoeop/trade-service`. Published on 127.0.0.1:13330, where the host's command
  line reaches it. On first start, with empty directories, it bootstraps from the public copies
  (about 17 GB) and needs the DoltHub key (`TRADE_DOLTHUB`, default `$TRADE_DATA/dolthub`: a
  `dolt login` `~/.dolt`). Every start also writes a reader-only `service.json` (the port and the two
  reader accounts, no root password or writer) into the `trade-ledger-readers` volume, for a container
  that only reads.
- **market-supply**: replay inputs over HTTP (`python -m market.remote`; `market/README.md`, "Remote
  supply for replay inputs"). Same image. It reads the market through ledger and serves only the native
  files of a pinned commit, its contracts and window. Published on 127.0.0.1:8210
  (`TRADE_MARKET_SUPPLY_PORT`); it has no authentication, so it is never published beyond loopback. Its
  exports stay in the `trade-market-exports` volume until an operator removes them.
- **paper**: the paper daemon behind the Paper panel. Same image; reached only by ide. Its market profile
  is the compose config `paper-market`: membership and stored bars from ledger, a reconciliation's replay
  inputs from market-supply, cached under `$TRADE_DATA/paper-tmp/market-client-cache`.
- **docker-api**: the only way to Docker, for paper. It allows exactly the calls paper makes
  (`docker-api.cfg`).

The design is in [`docs/plans/paper-compose-deployment.zh.md`](../docs/plans/paper-compose-deployment.zh.md)
and [`docs/plans/ledger-compose-service.zh.md`](../docs/plans/ledger-compose-service.zh.md). The
host directories are mounted at their own paths. `.env` beside the compose file names them and the
user the services run as:

```bash
printf 'TRADE_UID=%s\nTRADE_GID=%s\nTRADE_DATA=%s\n' "$(id -u)" "$(id -g)" "$HOME/.local/share/trade" > deploy/.env
docker compose -f deploy/compose.yaml up -d   # then open http://127.0.0.1:8765/
docker compose -f deploy/compose.yaml pull && docker compose -f deploy/compose.yaml up -d
```

The host's command line takes its replay inputs from market-supply once the active market profile
(`$TRADE_DATA/ledgers/market.json`) also names the supply and a cache; market administration and
imports keep using its `service`, and removing the two fields returns replays to the local reader:

```json
"remote_url": "http://127.0.0.1:8210",
"cache_root": "/Users/me/.local/share/trade/market-client-cache"
```

The ledger service and the paper daemon restart with Docker. A service whose `service.json` has no
socket is run this way: host commands reach it over TCP, and `ledger service stop` refuses it
(`docker compose stop ledger`).
