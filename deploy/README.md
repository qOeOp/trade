# deploy

`compose.yaml` is the base deployment, the same on a workstation and a server with a native
linux/arm64 or linux/amd64 Docker engine. `.github/workflows/ide-image.yml` builds and exercises
all three images on each native CPU, then publishes a shared platform manifest. The Dockerfile selects
the checksum-pinned Dolt 2.7.2 binary for that architecture; no CPU emulation is used.
Five services on one Docker engine:

- **ide**: the trade IDE page and its chat service ([`ide/`](../ide/README.md)). Image `ghcr.io/qoeop/trade-ide`. It reads ledger with the
  reader account only, and the market directory through a read-only mount: its profiles (compose configs, `kind` null) name the reader-only
  `service.json` ledger writes into the `trade-ledger-readers` volume, never ledger's own, so it holds
  no root password, writer account or DoltHub key. The chat service's agents and threads stay in the
  `trade-ide-agent` volume. It mounts the `trade-market-import` volume read-only for market-import's
  status file, which its status bar shows. Published on 127.0.0.1:8765.
- **ledger**: the Dolt service of the research ledger, run by `ledger service run`. Image
  `ghcr.io/qoeop/trade-service`. Published on 127.0.0.1:13330, where the host's command line reaches it.
  On first start, with empty directories, it clones the ledger from a DoltHub repository, or, when that repository
  is empty, makes a new ledger and publishes it there (First start, below). Everything the ledger records, complete
  strategy source included, is public in that repository, and its history cannot be withdrawn. Every start
  also writes a reader-only `service.json` (the port and the reader accounts, no root password or
  writer) into the `trade-ledger-readers` volume, for a container that only reads, and Paper's accounts into the
  `trade-paper-controller` volume. Its memory is capped at
  `TRADE_LEDGER_MEMORY` (default `40g`).
- **market-import**: the unattended import of Binance data (`market follow`; `market/README.md`,
  "Unattended upkeep"): the bars of every eligible contract (or only those `--bar-symbols` names) daily, open interest and long/short ratios daily
  and quotes and aggTrades monthly for the contracts its `--symbols` name, each from its own first month or day, and
  the open interest and ratios of any other contract a manual import added, from its last day (with
  `--metrics-pool`, also of each newest month's universe members, from that month). The
  range is `TRADE_MARKET_ARGS` in `.env` (below) and the directory does not record it; unset, the service refuses and
  keeps restarting, and the rest of the deployment runs. Same image. It is the only
  writer of the market directory `$TRADE_DATA/market`, mounted read-write. Its market profile is the
  compose config `market`, mounted at `/run/trade/market-import.json`. It reaches `data.binance.vision` and `fapi.binance.com` for bars. Its archive cache
  (kept, about 3 GB of aggTrades a month) and status file stay in the `trade-market-import` volume.
  `docker compose ps market-import` shows unhealthy while anything is stopped or lagging, and
  `docker compose logs market-import` gives each round; restarting it retries what stopped. Its memory is capped at
  `TRADE_MARKET_IMPORT_MEMORY` (default `3g`, sized from the code in `compose.yaml`, not measured at its peak).
- **paper**: the paper daemon behind the Paper panel. Same image; reached only by ide. It writes its runs into
  the `paper` database (`ledger/paper.sql`), which ledger makes beside the research ledger at a start that lacks
  it; that database is never published, and the research ledger holds no Paper record. It reads candidates and
  their last replays from the research ledger with the reader account. Its accounts and profiles are what ledger
  writes at every start into the `trade-paper-controller` volume (`--controllers`): the Paper database's writer
  and reader and the research reader, never the root password, the research writer or the DoltHub key. Its market profile
  is the compose config `market`: membership, stored bars and a comparison's replay inputs from
  the market directory, mounted read-only.
- **docker-api**: the only way to Docker, for paper. It allows exactly the calls paper makes, and of containers
  only those `runtime/container.py` builds ([`docker-api/`](docker-api/), image `ghcr.io/qoeop/trade-docker-api`).

The design is in [`docs/plans/paper-compose-deployment.zh.md`](../docs/plans/paper-compose-deployment.zh.md)
and [`docs/plans/ledger-compose-service.zh.md`](../docs/plans/ledger-compose-service.zh.md); the market import's
rules are in [`market/README.md`](../market/README.md) ("Unattended upkeep"). The
host directories are mounted at their own paths. `.env` beside the compose file names them and the
user the services run as:

```bash
printf 'TRADE_UID=%s\nTRADE_GID=%s\nTRADE_DATA=%s\nTRADE_MARKET_ARGS="%s"\n' "$(id -u)" "$(id -g)" \
  "$HOME/.local/share/trade" "--bars-from 2020-01" > deploy/.env
D="$HOME/.local/share/trade"; mkdir -p "$D/dolt/paper" "$D/ledgers" "$D/dolt-backups" "$D/dolthub" "$D/market" "$D/paper-tmp"
uv run --frozen python -m deploy.images --env deploy/.env   # names the images: see Image versions
docker compose -f deploy/compose.yaml up -d   # waits for the first start: open http://127.0.0.1:8765/
```

CI runs these steps from an empty host to one replay on each image build ([`.github/scripts/fresh-install.sh`](../.github/scripts/fresh-install.sh),
which says what it does differently).

### First start

`up -d` stays waiting on the ledger until its first start is done. The page at <http://127.0.0.1:8765/> asks for
the two things it lacks: a DoltHub repository (an empty one starts a new ledger, one holding a ledger continues it) and
a key on your DoltHub account. The ledger service makes that key in the empty `$D/dolthub` and shows its public half;
the private half never leaves the service. Pressing **Set up public ledger** publishes a new ledger at once. `up -d`
then finishes by itself. If you interrupted it, or it gave up after 6 hours, the services it had started keep waiting:
finish on the page, then run `up -d` again to start paper.

Each ledger schema generation has its own repository: the ledger reads `OWNER/REPOSITORY-g<N>`, N its version's
generation, for the `OWNER/REPOSITORY` the page or `.env` names (Updating, below). To skip the page, name the
repository before `up -d` with
`TRADE_RESEARCH_ORIGIN=https://doltremoteapi.dolthub.com/OWNER/REPOSITORY` in `.env`, and put a copy of a `dolt login`
`~/.dolt` at `$D/dolthub` (`TRADE_DOLTHUB` names another directory). A key directory holding anything is never written.
Later starts read neither. `docker compose -f deploy/compose.yaml logs ledger` shows each step and refusal.

The page only reports what pressing again cannot fix. Fix it, run `docker compose -f deploy/compose.yaml restart ledger`,
and reload:

- `BOOTSTRAP_REFUSED`: there is no `service.json`, yet the service, data or profile directory holds files. `TRADE_DATA`
  may name the wrong directory, or `service.json` was lost, so look before removing anything. A bootstrap killed
  midway leaves files too. When you are sure no ledger lived there (a published one stays on DoltHub), run
  `docker compose -f deploy/compose.yaml down`, empty `$D/dolt` and `$D/ledgers`, run `docker volume rm
  trade-ide_trade-dolt-data`, and make the directories again.

The other first-start refusals are in [Troubleshooting](../docs/operator/troubleshooting.md#first-start).

### What the market range costs

`TRADE_MARKET_ARGS` holds the options of `market follow`. It starts downloading 5 minutes after `up`, so change it
first if you want another range. The `.env` above imports the bars and funding of every eligible contract since
2020-01, so the monthly universe and the report's equal-weight basket hold every contract the universe rule
describes, delisted ones included. Its first import takes 10 to 15 hours. `--bar-symbols A B C` narrows the bars to a
list for a quick start, and narrows the universe and the basket with it: a list chosen today is the survivors, so
multi-year pool results and the basket then overstate.

Add `--symbols BTCUSDT --metrics-from YYYY-MM-DD --trades-from YYYY-MM --quotes-from YYYY-MM` only when a strategy needs
aggTrades, quotes or open interest. Add `--metrics-pool` for the open interest and long/short ratios of the monthly
pool: each member of the newest month is kept from that month's first day, and a contract entering the pool later
from the month it enters; no earlier day is imported (`market import-metrics` backfills by hand). Metrics are small:
the 9 contracts held on 2026-11-18 took 54 MB. Measured on one deployment of 30 bar contracts and 3 `--symbols`
contracts, 2026-11-07:

| Part | Stored | Note |
|---|---|---|
| bars and funding | 2.1 GB, up to 30 contracts since 2020-01 | the deployment's `--bar-symbols` list then |
| bars and funding, every eligible contract | about 26 GB, 680 contracts since 2020-01 (about 250 universe members a month) | estimated from the archive listing on 2026-11-21, not yet imported whole; about 45 GB of kline archive cache, kept; 10 to 15 hours from empty |
| aggTrades | 56 GB, 3 contracts since 2020-01 | 16 to 25 minutes to import a month; about 3 GB of archive cache a month, kept |
| quotes | 23 GB, the same 3 contracts | |
| ledger volume | 2.09 GB after 2,358 trials | about 0.9 MB a trial |

In memory the services used: ledger 1.4 to 1.8 GiB, ide 0.85 GiB, market-import 0.45 GiB. Paper runs share a 3.5 GiB
budget, each runner limited to 256 MiB plus 16 MiB a contract (`paper/runs.py`). No minimum machine has been tested. That whole range from empty is estimated at 81 GB stored plus 100 to 231 GB of archive cache (the
two estimates disagree) and days of importing; it has never been run whole. A pool replay needs far more memory than one over
a few contracts (214 contracts over a year exhausted 48 GB).

The import reaches `data.binance.vision` and `fapi.binance.com`, and a new market cannot start without the latter. Binance
refuses some regions and hosting providers (HTTP 451 or 403), reported as `SOURCE_UNREACHABLE`. Check first:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://fapi.binance.com/fapi/v1/time
```

### The host's command line

The host's command line reads the same market directory: the active market profile
(`$TRADE_DATA/ledgers/market.json`) names it as `root` and nothing else, so the host never fetches. Market
writes run in market-import (`docker compose exec market-import python -m cli.main market
... --market /run/trade/market-import.json`): the import lock excludes only processes that share the Docker
VM's kernel.

```json
{"name": "market", "holds": "market", "kind": "active", "root": "/Users/me/.local/share/trade/market"}
```

On a new machine the ledger starts first: its bootstrap refuses a profile directory that already holds a
profile, so write `market.json` by hand after ledger is healthy.

The market directory is plain files with no copy. If it is lost, start market-import: it recomputes bars, funding,
members, metrics, aggTrades and quotes from the Binance archives over its configured range (costs below; never run
whole), and observes terms anew. Sealed runs stay readable,
reproducible and comparable: the observation time is not part of the input identity, and a contract with bars at an
older market day trades there on its earliest stored terms.

The import does not bring back one lost file while its month's `bar/` file stands, because it goes by the bars' months.
Above all a lost `funding/` file: `market follow` does not notice it and `MONTH_EXISTS` refuses the month, and a replay
then settles nothing for it. Recompute into a new directory and copy the file over, and check that every `bar/` month
has its `funding/` file.

The ledger service, the paper daemon and the market import restart with Docker. A service whose
`service.json` has no socket is run this way: host commands reach it over TCP, and `ledger service stop`
refuses it (`docker compose stop ledger`).

## Image versions

A deployment runs images by digest, so a pull cannot change what it runs. A tag only finds an image.

- **ide, ledger, paper, market-import**: `TRADE_IDE_IMAGE` and `TRADE_SERVICE_IMAGE` in `.env`, and `TRADE_RUNTIME_IMAGE`
  for paper's new runs: the execution image (`trade-runtime:exec-sha-COMMIT`, engine/README.md, Runtime image).
  Compose refuses to run without them. `deploy/images.py` writes them from a channel branch
  where CI records a commit once every check of it has passed: by default `deploy-ready`, which holds only versions
  ([`CHANGELOG.md`](../CHANGELOG.md)) and is what the author's host releases; with `--channel main`, `main-ready`,
  which holds every checked `main` build (staging). A workstation follows versions with `deploy/update.sh` (Updating). It needs
  Python 3.12 or newer (`python3 -m deploy.images` on a server, always the default channel). It reads public data
  with no credential and pulls nothing.
- **docker-api**: the digest in `compose.yaml`, moved only by a pull request (and on the release host by the release
  of the version that carries it).
- **Replays**: `trade-runtime:main` finds the current replay image, and the ledger records the digest it resolved to.

During 0.x a version reads no other version's state, so a deployment never goes back to an earlier version's
images.

Images of pull requests share the packages and are never deployed.

## Updating

A workstation follows released versions with one command, run from a checkout:

```bash
deploy/update.sh --check   # what it would do; changes nothing
deploy/update.sh           # staging: deploy/update.sh --channel main
```

It refuses while Paper is not idle (a running Paper runner container, or a `paper compare` in paper), since the
restarts below would interrupt them. Otherwise it names the newest admitted version's images in `.env`
(`deploy/images.py`) and keeps that version's own `compose.yaml` (not the checkout's, which may be ahead of the
images) with the three images it admitted at `$TRADE_DATA/deploy/<revision>/`. It prints each service's state, image
revision, the definition it was created from and whether `up -d` will recreate it, and flags a service built from a
commit the admitted version does not contain (an unreleased build, which the update moves back to the version). It then
pulls and runs `docker compose -p trade-ide up -d` from that file, which recreates exactly the services whose image or
definition changed (ledger only when its own did), docker-api included, and leaves Paper's run containers alone; it
checks that every service now runs that definition and points `$TRADE_DATA/deploy/current` at it. Last, it removes
what nothing uses: replay stage containers exited over an hour ago, dangling anonymous volumes, and images no container
runs that neither the definition, `.env` nor a tag other than `pr-N` names (this repository's, and nameless ones).
Docker still refuses to remove an image a container uses. A replay of an older trial pulls its pinned runtime digest
again when it is gone. `TRADE_ENV` names another env file; other arguments go to `deploy/update.py`. The workstation
has no Live control. The IDE's status bar says "Behind vX.Y.Z" while a newer version is released than the page's own
(read from GitHub at most hourly); `.env` and the services move only when you run the command. The release host
refuses it: its release tick moves it ([remote/README.md](remote/README.md)).

A version of another ledger schema generation ([`CHANGELOG.md`](../CHANGELOG.md) says which) starts a new data
generation, and the update does it before `up -d`
([design](../docs/plans/data-generation-in-release-20261123.zh.md)). It tells one apart by the version's own `ledger
service check`, run read-only against the running ledger (a stopped ledger is refused: start it first), which refuses
this ledger with `SCHEMA_MISMATCH`. Then the update publishes what the old ledger holds to its own repository (a
failed publish stops it before anything changes: that copy is the old generation's record), and makes sure the new generation's repository exists: `<TRADE_RESEARCH_ORIGIN>-g<N>` on DoltHub, N the version's
generation (`.env` keeps naming the base; when it names none, the old ledger's repository becomes the base, once). A
repository that does not exist is created, empty and public, with a DoltHub API token kept in the file
`TRADE_DOLTHUB_TOKEN_FILE` names (default `$TRADE_DATA/dolthub-token`), read only by that request and never printed;
without the file the update stops before it changes anything and names the repository to create on dolthub.com. It
then stops the project, archives the ledger's data into `$TRADE_DATA/archive/<UTC time>-<revision>/` (the contents of
`dolt`, `dolt/paper`, `ledgers` and `dolt-backups` by rename, the `trade-dolt-data` volume as a tgz before it removes
the volume), and starts the ledger alone: its first start makes the new ledger and publishes it there (or clones it,
when another workstation published it first). It puts `market.json` back into `ledgers`, removes every older archive
it made, and the update goes on as above. The market directory has no generation and stays.
`$TRADE_DATA/deploy/generation.json` records the step: an interrupted cutover is finished by the next update, from that
step. `--check` says whether the version starts a new generation and changes nothing. An update refuses a ledger
the version reads that publishes elsewhere than the version's repository for its generation. Every refusal comes
before the env file names the new images. The release host waits for this
publication before its own cutover ([remote/README.md](remote/README.md#a-version-that-starts-a-new-data-generation)).

Every other compose command on the workstation uses the same definition, project and env file, so no service is
created from a checkout, a worktree or a deleted directory (`--no-deps` keeps one service's recreate from recreating
ledger):

```bash
docker compose -p trade-ide --env-file deploy/.env -f "$TRADE_DATA/deploy/current/compose.yaml" up -d --no-deps paper
```

A version's images are admitted some minutes after its tag, once CI has checked it; until then the command resolves the
version before, and the status bar keeps saying behind. A service's revision is the image label
`org.opencontainers.image.revision`:

```bash
docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  "$(docker inspect -f '{{.Image}}' trade-ide-paper-1)"
```

docker-api runs the digest in `compose.yaml` (the default of `TRADE_DOCKER_API_IMAGE`, which only the release host's
release sets), and no pull moves it. A change to `docker-api/` takes two pull requests:
the change, then, after its `main` build, the digest of `ghcr.io/qoeop/trade-docker-api:sha-<commit>` in `compose.yaml`.
The next version moves it on a workstation (`deploy/update.sh`) and on the release host
([remote/README.md](remote/README.md#compose-services)).
Reverting that line goes back to the previous proxy. A `main` build warns while the source is ahead of the pin.

Each restart takes seconds; what it interrupts decides when to make it:

- **ledger**: a command line write under way fails and is rerun as it is: writes are idempotent by
  operation. A replay holds no connection while its containers run, so only one that opens or seals its
  trial within the restart's seconds fails; `docker ps --filter network=none` lists running replay
  stages.
- **paper**: its runs are containers of their own and keep running; a comparison runs inside the
  daemon and is lost. `docker top trade-ide-paper-1` shows a running `paper compare`.
- **docker-api**: a comparison's replay attaches through it for up to an hour; the same check.
- **market-import**: an import under way stops; the next round imports it again, since a file takes its place only
  once it is whole, and an abandoned temporary file is removed at the next import.
- **ide**: the page reconnects by itself; a chat answer being written is cut off.
