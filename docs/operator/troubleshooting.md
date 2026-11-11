# Troubleshooting

Every command prints one JSON result, or a refusal on standard error with exit 1: `code`, `message`, `missing`,
`write_status` (whether anything was written) and `next_actions`, the repair. Read `next_actions` first; this page
adds what a refusal cannot say. The services' own account is `docker compose -f deploy/compose.yaml logs <service>`.
Back to the [operator manual](README.md).

## Where to look

| Question | Command or place |
|---|---|
| Are the services up? | `docker compose -f deploy/compose.yaml ps` |
| What did the ledger do on start? | `docker compose -f deploy/compose.yaml logs ledger` |
| Is the market import current? | the status bar's **Market:** entry; `docker compose -f deploy/compose.yaml logs market-import` |
| Is the public copy behind? | the status bar's **Public copy** entry; Settings, **About this deployment** |
| Is the ledger whole? | `docker compose -f deploy/compose.yaml exec -T ledger python -m cli.main ledger review` |
| Which build runs? | **About this deployment**, or the image label in [Updating](../../deploy/README.md#updating) |

Host commands read the deployment's profiles in `$TRADE_DATA/ledgers`: set `TRADE_LEDGER_HOME` to it unless
`TRADE_DATA` is the default `~/.local/share/trade`. A `LEDGER_UNKNOWN` refusal usually means it is not set.
A `DOLT_BINARY` refusal on the host means the command reads a Dolt backup: run it in the ledger container
(`docker compose -f deploy/compose.yaml exec -T ledger python -m cli.main ...`), which has Dolt.

## First start

| Code | What to do |
|---|---|
| `BOOTSTRAP_REFUSED` | The ledger found files but no `service.json`. Check that `TRADE_DATA` names the right directory before removing anything; [First start](../../deploy/README.md#first-start) says how to start over. |
| `BOOTSTRAP_FAILED` | The repository could not be cloned or holds no ledger. A repository that does not exist shows as "permission denied". Fix the name on the page and press again. |
| `DOLTHUB_CREDENTIALS` | `$TRADE_DATA/dolthub` holds something other than a key, or `TRADE_UID` cannot write it. Empty it, or make it as `TRADE_UID`. |
| `up -d` never finishes | The ledger waits for the page for up to 6 hours. Finish on the page; if `up` gave up meanwhile, run it again to start paper. |

## Ledger and publishing

| Code | What to do |
|---|---|
| `LEDGER_UNAVAILABLE` | The service is down or busy. Retry after a minute; then `docker compose -f deploy/compose.yaml restart ledger` (a write under way is rolled back and rerun as it was). |
| `PUBLISH_FAILED` | The change is stored locally; only the DoltHub copy is behind. Check the network and the key; the service retries every 5 minutes, or run `ledger publish`. A key added while the service ran needs `restart ledger`. |
| `PUBLISH_REJECTED` | The DoltHub copy changed elsewhere. Nothing is forced; find out who wrote it before anything else. |
| `REMOTE_MISMATCH` | The ledger already publishes to another repository. Changing it is a decision, not a repair. |
| `SCHEMA_MISMATCH` | The code and the ledger are different schema generations. Use the checkout and images of the ledger's generation ([The ledger and the market](../../README.md#the-ledger-and-the-market)). |
| `LEDGER_KIND` on a market profile | It is in the format before 2026-11-11: replace `"kind": "market"` and `"role": R` with `"holds": "market"` and `"kind": R`. |
| `BACKUP_DIVERGED`, `LEDGER_CORRUPT` | Stop writing and keep everything as it is; the backup and the DoltHub copy are what a repair starts from. |

## Market

| Code | What to do |
|---|---|
| `SOURCE_UNREACHABLE` | Binance or its archives did not answer. HTTP 451 or 403 means Binance refuses your region or hosting provider: no retry helps; the host must change. Otherwise the next round retries; nothing was committed. |
| `MARKET_EMPTY`, `WINDOW_OUT_OF_COVERAGE`, `UNIVERSE_NOT_COVERING_WINDOW` | The market does not hold that period yet. Wait for the import, or widen `TRADE_MARKET_ARGS` and restart market-import. |
| `MONTH_EXISTS` | That month is already stored; months are never rewritten. A lost `funding/` file needs the recompute in [The host's command line](../../deploy/README.md#the-hosts-command-line). |
| `CONCURRENT_IMPORT` | Another import holds the lock. Wait. |

## Replays and images

| Code | What to do |
|---|---|
| `RUNTIME_UNAVAILABLE` | Docker could not pull or inspect the runtime image. Check `docker pull` of that image by hand; a hung credential helper (`credsStore` in `~/.docker/config.json`) is a common cause. |
| `STALE_CHECKOUT` | The checkout is behind `origin/main`: `git pull`. |
| `RUNTIME_MISMATCH` | The local image disagrees with its recorded identity. Pull it by digest again; if it still disagrees, report the image. |
| `RUNTIME_NOT_MAIN` | A validation or reproduction needs a `main` build of the runtime: merge first, then rerun on the `main` runtime. |

## Paper

| Code | What to do |
|---|---|
| `PAPER_MEMORY_FULL` | Running runs hold the 3.5 GiB memory budget. Stop one, then start again. |
| `PAPER_START_FAILED` | The containers did not start; the run is sealed with the error in its `runner.log`. Fix Docker, then start a new run. |
| `EMPTY_SYMBOLS` | No contracts given, a repeated one, or the market has no members for the current month yet. |
| "Paper daemon offline" | `docker compose -f deploy/compose.yaml restart paper`; runs keep going in their own containers meanwhile. |

## Live

Live refusals start with `LIVE_` and say what they need in their message. Two to know: `LIVE_KEY_WITHDRAWAL` (make a
key without withdrawal permission) and `LIVE_ACCOUNT_OWNED` (another run holds the account; wait for it to end).
A run whose outcome is unclear is handled as [Unresolved Live runs](../../engine/README.md#unresolved-live-runs) says:
check the exchange account itself.
