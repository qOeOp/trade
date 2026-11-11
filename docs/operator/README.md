# Operator manual

For the person who runs this product: you install it, choose the research lines and set the targets; an Agent
does the research. Read [Start here](../../README.md#start-here) first: what you publish is public and permanent, and
Binance must answer from your host. Also: [FAQ](faq.md) and [Troubleshooting](troubleshooting.md).

## Install

You need a `git clone` of this repository, Docker with a linux/arm64 or linux/amd64 engine, Python 3.14,
[uv](https://docs.astral.sh/uv/), a DoltHub account and an empty public DoltHub repository.

1. Check that Binance answers from your host:
   `curl -sS -o /dev/null -w '%{http_code}\n' https://fapi.binance.com/fapi/v1/time` must print `200`.
2. Follow [`deploy/README.md`](../../deploy/README.md) to the `docker compose ... up -d` line: it writes `deploy/.env`,
   makes the directories under `TRADE_DATA` and names the images. On a server, follow
   [`deploy/remote/README.md`](../../deploy/remote/README.md) instead.
3. Choose the market range in `TRADE_MARKET_ARGS` before `up`: the import starts 5 minutes later. The default bars of
   three contracts are enough for a first replay; [What the market range
   costs](../../deploy/README.md#what-the-market-range-costs) gives disk, memory and time.

## First run

Open <http://127.0.0.1:8765/>. The page asks for your DoltHub repository and shows the public half of a key the
ledger service made; add that key to your DoltHub account and press **Set up public ledger**. An empty repository
starts a new ledger; one holding a ledger continues it. `up -d` finishes by itself
([First start](../../deploy/README.md#first-start)).

Then wait for the market: the status bar says **Market: caught up** when the import has the range you chose.
`docker compose -f deploy/compose.yaml ps` shows `market-import` unhealthy while it is still importing or stopped.

## Start research

Open your Agent (Claude Code or Codex) at the repository root and say "start research". It checks the checkout and
the ledger, offers the research lines that can start now and waits for your choice. Give it your two targets with the
line: maximum drawdown (a fraction, `0.2` is 20%) and minimum annual return (`0.15` is 15%). It stops and asks before
anything [`AGENTS.md`](../../AGENTS.md) reserves for you; everything else it decides.

The IDE shows what it does: versions, runs and their reports. To check the ledger yourself, from the checkout:

```bash
export TRADE_LEDGER_HOME="$TRADE_DATA/ledgers"   # the deployment's profiles; skip it if TRADE_DATA is the default
uv run --frozen python -m cli.main research status
```

## Paper

Paper trading runs a version on Binance's public live data with simulated fills; it needs no credential. It
reads the current month's contract membership and bars from your market, so keep the market import current.

- **Start**: hover a version and press **Run paper…** (or pick it in the version's menu), name the contracts and press
  **Start**. The account is the replay's: 100,000 USDT margin.
- **Watch**: the Runs page (**Toggle Runs page**, ⌥8). The status bar names running runs with missing bars or
  protection gaps.
- **Stop**: **Stop and seal**. Working orders are cancelled, open positions stay at their last price, and a sealed
  run cannot be resumed.

Each run reserves memory; when a start is refused for memory (`PAPER_MEMORY_FULL`), stop a running run first. Details: [Paper
trading](../../engine/README.md#paper-trading).

## Live

Live places real orders with real money, and you alone operate it: you save the exchange credential and start every
run. An Agent changes Live code but never starts a run, places or cancels an order, or reads a credential.
[Start here](../../README.md#start-here) says why this release does not support it: read that before connecting an
account.

Live runs only on a server with the Live control paired ([Optional Live control
pairing](../../deploy/remote/README.md#optional-live-control-pairing)). Then, in the IDE:

1. **Live settings…**: enter the API key and secret, **Save credentials**. A key that can withdraw is refused.
2. **New live run…**: choose the strategy, the account and limits, **Prepare & review**, optionally **Check account**,
   then **Start live trading**.
3. **Request stop** to stop. Closing the page does not stop a run, and a stop request alone does not prove the
   account is flat: check the account.

Back up the Live root after each run ([Backing up the Live root](../../deploy/remote/README.md#backing-up-the-live-root)).

## Backups

| What | Where it lives | Copy |
|---|---|---|
| Ledger | the `trade-ide_trade-dolt-data` volume | DoltHub, after every change (retried every 5 minutes); a local backup when you run `ledger export --kind backup` |
| Market directory | `$TRADE_DATA/market` | none: market-import recomputes it from Binance's archives |
| Agent settings and API keys, chat threads | the `trade-ide_trade-ide-agent` volume | none |
| Paper run directories | `$TRADE_DATA/dolt/paper` | sealed runs are in the ledger |
| Live root (server) | outside `TRADE_DATA` | yours to make |

After a research session, refresh the local backup and check the ledger against it. Both read the backup with Dolt,
which the ledger container has and the host need not:

```bash
docker compose -f deploy/compose.yaml exec -T ledger python -m cli.main ledger export --kind backup
docker compose -f deploy/compose.yaml exec -T ledger python -m cli.main ledger review   # HISTORY_UNCHECKED: no backup yet
```

With [Dolt 2.7.2](https://github.com/dolthub/dolt/releases/tag/v2.7.2) on the host (`RESEARCH_DOLT_BINARY`),
`ledger export --kind reproduce --output <new directory>` writes a complete copy outside the deployment.

There is no restore command. A new host with empty directories, given the same DoltHub repository on its first
start, clones the ledger from it; writes not yet published are lost. Keep `deploy/.env` (it names the images and
directories) and the DoltHub key directory `$TRADE_DATA/dolthub`.

## Update and roll back

[Updating](../../deploy/README.md#updating) moves the images to the last admitted build and restarts only the services
it changes; [Image versions](../../deploy/README.md#image-versions) goes back to an earlier one. On a server, releases
are automatic: [Rolling back](../../deploy/remote/README.md#rolling-back).
