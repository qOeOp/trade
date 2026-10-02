# Binance public derivatives data: state, sources, slices

**Status: review draft, not architecture authority.** This file exists so Lane 3 can review the plan before
any slice is admitted. It does not merge as it stands. When a slice is admitted, its TARGET text moves into the
Owner documents it changes, in English and Chinese:

- `docs/owners/market-data.md`;
- `docs/owners/backtest.md`;
- `docs/architecture/strategy-factory.md`.

Each move cites the measurement below that forced it.

**Authority.** The user's authorization of 2026-10-03: the deployment may fetch Binance data from **public archives
and public endpoints only**, and **no trading credential is ever used**. Everything here stays inside that bound. A
slice that needed a key, a signed request or a user stream would be outside it and is not proposed.

**Measured on.**

- **Repository:** `origin/main` 933c6cca3. The `file:line` references below are on that tree.
- **Network, local machine:** 2026-10-02T22:00Z to 22:30Z.
- **Network, GitHub-hosted runner:** run 37071273239, ubuntu-22.04.
- **Re-measurement:** a reading here is a reading on that day. Anything stated as "documented" was not measured,
  and a slice that depends on it measures it first.

## 1. What main has today

### The Owner path for USD-M perpetuals

| Item                   | State on main                                                                                                                                                                 | Evidence                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bar intake             | Production fetches the last closed kline at a cut, unsigned, limit 16. It emits OPEN/HIGH/LOW/CLOSE only. Volume and taker buy volume arrive in the response and are dropped. | `crates/adapters/binance/src/futures_pit_observation_source_v1.rs:126-148`. Selected by `MARKET_DATA_OBSERVATION_SOURCE=binance-perpetual`, `crates/strategy_factory_rd_owner_api/src/main.rs:829-840, 910-932`. |
| PIT route and storage  | `POST /v1/market-data/pit-market-snapshot-requests`. Rows land in `market_data_private.pit_observation_rows_v1` and the other PIT tables.                                     | `crates/strategy_factory_rd_owner_api/src/market_data_pit.rs:178-180`; `crates/data/src/owner/postgres.rs:376-380`                                                                                               |
| Observation vocabulary | Channels `MARKET` / `REFERENCE` / `ECONOMIC`; kinds `BAR` / `QUOTE` / `TRADE` / `SCALAR`. No producer emits `SCALAR`.                                                         | `crates/data/src/owner/pit_snapshot/authority.rs:1258-1259`                                                                                                                                                      |
| exchangeInfo → IM V2   | The Owner admits a supplied `usdm/exchangeInfo` baseline, status deltas and snapshots. No production code fetches exchangeInfo; the archiver is TARGET.                       | `crates/data/src/owner/instrument_master_v2.rs:236-245, 311`; `docs/owners/market-data.md:1593, 1655`                                                                                                            |
| Quote                  | No Binance quote source exists; the only QUOTE producer is Databento.                                                                                                         | `docs/owners/market-data.md:2214`                                                                                                                                                                                |
| Economic terms         | Fees and margins only, no funding field, no production intake.                                                                                                                | `crates/data/src/owner/instrument_economic_terms_v1.rs:49-73`                                                                                                                                                    |

### The five derivatives kinds

| Kind                  | Owner fact type | Owner intake                                              | Owner storage | Inherited adapter only (not the Owner path)                                       |
| --------------------- | --------------- | --------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------- |
| Funding rate          | none            | none                                                      | none          | REST and WS parsers, `crates/adapters/binance/src/futures/http/client.rs:800-818` |
| Open interest         | none            | none                                                      | none          | `client.rs:826-842`, `data_types.rs:28, 158`                                      |
| Liquidations          | none            | none                                                      | none          | `@forceOrder` streams, `futures/data.rs:437, 489`                                 |
| Taker buy/sell volume | none            | dropped at `futures_pit_observation_source_v1.rs:143-148` | none          | `http/models.rs:116-118`                                                          |
| Long/short ratios     | none            | none                                                      | none          | none                                                                              |

The searches that returned zero on the Owner paths are listed in the review message. For each kind, the Owner paths
are `crates/data/src/owner`, `crates/strategy_factory*`, `schema` and `product/rd-workbench`.

### Strategy input facts

The closed set is `MarketDataFieldSemantic::ALL: [Self; 12]` (`crates/data/src/owner/strategy_input_binding.rs:149`):

- four bar prices;
- bar volume;
- four quote fields;
- two trade fields;
- `SCALAR.VALUE`.

None of the five kinds is in it. A new input fact means changing all of these together:

- the enum and its tables (`:121-245`);
- the codec tags (`strategy_input_binding/codec.rs:155-170`);
- the field-semantic registry (`sample_fact.rs:1458-1474`).

### What the documents already say

- **Strategy Factory, N1:** funding rate and open interest extend the existing Binance futures PIT source with two
  appended row fields and field semantics. Liquidations are refused as `INPUT_FACT_UNAVAILABLE_FROM_ADMITTED_SOURCE`.
  This is TARGET text at `docs/architecture/strategy-factory.md:1553-1557`.
- **Backtest:** no exploratory replay accrues perpetual funding, and "the cost model must first carry funding facts
  from Market Data". This is TARGET text at `docs/owners/backtest.md:131-133, 248-250`. The inherited engine already
  settles `FundingRateUpdate` (`crates/backtest/src/engine.rs:1390-1393, 1593-1613`), but no Owner replay feeds one.
- **The derivatives-data design document Lane 2 was dispatched on 2026-09-28 does not exist** anywhere searched:
  - `origin/main`;
  - every remote and local branch (docs added or modified since their merge base, grepped for funding, open
    interest, long/short and taker);
  - the uncommitted files of all 33 worktrees of this repository.

  Lane 2's transcript mentions the request and nothing after it. This plan does not replace that document; it is
  the measured input to it.

## 2. Public sources

Every row was fetched on the dates above. "Runner" is the HTTP status from a GitHub-hosted runner; its controls
answered as expected (`api.github.com` 200, `api.binance.com` 451).

| Kind                      | Source and URL format                                                                                                                                                                                                                                                  | Credentials | History                                                                                                                  | Granularity / latency                                                                                                            | Local                                                | Runner                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------- |
| Funding, settled          | Archive `https://data.binance.vision/data/futures/um/monthly/fundingRate/{SYM}/{SYM}-fundingRate-{YYYY}-{MM}.zip`. Columns `calc_time, funding_interval_hours, last_funding_rate`. **Monthly only**: the daily path is 404.                                            | none        | BTCUSDT from 2020-01; SOLUSDT from 2020-09                                                                               | One row per settlement. The current month is absent until the month closes.                                                      | 200                                                  | 200                                         |
| Funding, settled          | REST `https://fapi.binance.com/fapi/v1/fundingRate?symbol={SYM}&startTime=&endTime=&limit<=1000`                                                                                                                                                                       | none        | BTCUSDT back to 2019-09-10, the listing                                                                                  | One row per settlement, immediate                                                                                                | 200                                                  | **451** (the `www.binance.com` host is 200) |
| Funding, live estimate    | REST `/fapi/v1/premiumIndex?symbol={SYM}` (`lastFundingRate`, `nextFundingTime`, mark, index)                                                                                                                                                                          | none        | Current value only. History of the premium index exists as archive `premiumIndexKlines/{SYM}/{interval}/`, from 2020-01. | Continuous                                                                                                                       | 200                                                  | 451 / 200                                   |
| Funding interval and caps | REST `/fapi/v1/fundingInfo`: 804 symbols, 333 at 8h, 470 at 4h, 1 at 1h. BTC/ETH/SOL/LINK are at 8h today.                                                                                                                                                             | none        | Current only. History is the archive's `funding_interval_hours` column.                                                  | n/a                                                                                                                              | 200                                                  | not probed                                  |
| Open interest             | Archive `https://data.binance.vision/data/futures/um/daily/metrics/{SYM}/{SYM}-metrics-{YYYY-MM-DD}.zip`. Columns `sum_open_interest`, `sum_open_interest_value`. **Daily only**: the monthly path is 404.                                                             | none        | BTCUSDT from 2020-09-01; SOLUSDT from 2021-12-01                                                                         | 5 minutes, published T+1. 2026-10-01 was present and 2026-10-02 absent at 22:00Z on 10-02.                                       | 200                                                  | 200                                         |
| Open interest             | REST `/futures/data/openInterestHist?symbol=&period=5m&startTime=&endTime=&limit<=500`                                                                                                                                                                                 | none        | **30 days**: a `startTime` 60 days back answers 400 `-1130`, 20 days back answers 200                                    | 5m to 1d                                                                                                                         | 200                                                  | 451 / 200                                   |
| Open interest, point      | REST `/fapi/v1/openInterest?symbol=`                                                                                                                                                                                                                                   | none        | Current only                                                                                                             | n/a                                                                                                                              | 200                                                  | 451 / 200                                   |
| Long/short ratios         | Same archive `metrics` file:<br>- `count_toptrader_long_short_ratio` (top trader accounts);<br>- `sum_toptrader_long_short_ratio` (top trader positions);<br>- `count_long_short_ratio` (all accounts).                                                                | none        | Same as open interest                                                                                                    | 5 minutes, T+1                                                                                                                   | 200                                                  | 200                                         |
| Long/short ratios         | REST `/futures/data/{globalLongShortAccountRatio, topLongShortAccountRatio, topLongShortPositionRatio}`                                                                                                                                                                | none        | 30 days                                                                                                                  | 5m to 1d                                                                                                                         | 200                                                  | 451 / 200                                   |
| Taker buy/sell            | Kline column `taker_buy_volume` (sell = `volume - taker_buy_volume`), in the archive `klines/{SYM}/{interval}/` (BTCUSDT from 2020-01) and REST `/fapi/v1/klines` (the source already fetches this).                                                                   | none        | Full                                                                                                                     | The bar's own interval                                                                                                           | 200                                                  | 200 archive; 451 / 200 REST                 |
| Taker buy/sell ratio      | Archive `metrics.sum_taker_long_short_vol_ratio`; REST `/futures/data/takerlongshortRatio`                                                                                                                                                                             | none        | Archive since 2020-09; REST 30 days                                                                                      | 5 minutes                                                                                                                        | 200                                                  | archive 200; REST 451 / 200                 |
| Liquidations              | WebSocket `wss://fstream.binance.com/market/ws/{sym}@forceOrder` or `/market/ws/!forceOrder@arr`                                                                                                                                                                       | none        | **None**: forward only from the day recording starts                                                                     | Per event. Binance documents at most one pushed liquidation per symbol per 1000 ms, which makes it a lower bound (not measured). | 101 handshake, 8 events in 60 s on `!forceOrder@arr` | not probed                                  |
| Liquidations, history     | REST `/fapi/v1/allForceOrders` is 404. `/fapi/v1/forceOrders` answers 401 "API-key format invalid" and is a user endpoint, **out of bounds**. USD-M archive has no `liquidationSnapshot` prefix. COIN-M `BTCUSD_PERP` archive runs 2023-06-25 to 2024-10-14 and stops. | n/a         | n/a                                                                                                                      | n/a                                                                                                                              | n/a                                                  | n/a                                         |

### How the sources agree (measured, BTCUSDT)

- **Funding.** For 2024-01 the archive and REST give 93 rows each. All 93 are equal, at identical timestamps
  (`calc_time` = `fundingTime`).
- **Open interest.** For 2026-10-01, `openInterestHist` and the archive `metrics` give 288 rows each. 287 are
  exactly equal, but only when the archive row stamped `create_time` t is matched with the REST row stamped
  **t + 5 minutes**. At equal timestamps 287 differ, by up to 5.3e-3 relative.
- **Long/short ratios.** Same shift: the archive at t matches REST at t + 5 minutes, to REST's 4-decimal
  precision (max 2.4e-4 relative).
- **Taker ratio.** The opposite: archive t matches REST t (`buyVol/sellVol`, median 6.8e-5, max 1.05e-3
  relative). With a 5-minute shift the median error is 0.4.

So one archive row mixes two time conventions. The open interest and ratio snapshots in the row stamped t are the
values REST stamps t + 5m. The taker ratio in the same row is the interval REST stamps t, which is
[t, t + 5m). Either way, **nothing in an archive row stamped t is complete before t + 5 minutes.**

## 3. When each fact becomes knowable

A source row may be shown to a cut only once it was knowable in the world. Each slice's source states this rule and
its tests pin it from both sides.

| Kind and source                                                      | Knowable at                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Settled funding, archive or REST                                     | `fundingTime` / `calc_time`                                                                             |
| Archive `metrics` row stamped t (open interest, ratios, taker ratio) | t + 5 minutes                                                                                           |
| REST open interest or ratio stamped t                                | t                                                                                                       |
| REST taker ratio stamped t                                           | t + 5 minutes                                                                                           |
| Kline with `close_time` c                                            | c. The bar source keeps bars with `close_time <= cut` (`futures_pit_observation_source_v1.rs:179-187`). |
| Live funding estimate from `premiumIndex`                            | its response `time`                                                                                     |

The estimate has no history except the premium-index klines, so a Replay can only use settled funding.

The 5-minute rule is the trap. Using the archive's `create_time` as the knowable time leaks five minutes of the
future into every open-interest read.

## 4. Slices

**Order.** Funding first, because the only fully passing research candidate, carry K1, is built on it. Then open
interest. Then the rest.

**Ownership.** Market Data owns every source, fact and table here. Backtest and Strategy Factory only consume
Market Data facts through their existing read surfaces. No slice gives Strategy Factory or Backtest a Binance
client.

**Credentials.** Every source is constructed unsigned, and a test pins that: the production constructor accepts no
key, and the request carries no `X-MBX-APIKEY` and no `signature`.

### F1 - settled funding as a Market Data fact

- **Owner:** Market Data.
- **What changes:** the Binance futures PIT source gains funding rows, the N1 route.
  - For each member at a cut, it emits the last settled rate whose `fundingTime` is at or before the cut,
    together with that settlement's interval in hours.
  - The REST source covers any cut back to the listing. The archive is the bulk and verification route.
  - Storage is the existing PIT tables, with new row fields and no new table.
- **Acceptance, each assertion two-sided:**
  1. A cut 1 ms before a settlement returns the previous settlement; a cut at the settlement returns the new one.
  2. For BTC, ETH and SOL over one archived month, REST-derived facts equal the archive rows (rate and interval).
     This is the agreement measured above, as a test over production decoders and never hand-written expected
     rows.
  3. A source that answers 451, 404 or a timeout refuses by name. It never emits zero funding or an empty batch
     that reads as "no funding".
  4. The no-credential pin above.
- **Not in F1:**
  - the live estimate;
  - a Design-facing input (that is F3);
  - accrual in a replay (that is F2).

### F2 - funding accrual in exploratory replay

- **Owner:** Backtest. It consumes F1's facts through Market Data's read surface.
- **What changes:** the exploratory replay feeds each settlement in the replay window as a `FundingRateUpdate`. The
  engine already settles it. This closes the TARGET at `docs/owners/backtest.md:248-250`, including the matched-entry
  control's funding.
- **Acceptance:**
  1. A position held across k settlements pays exactly the sum of position notional at mark times rate, sign
     included.
  2. A position flat at a settlement pays nothing.
  3. A replay window whose funding facts are missing refuses by name instead of running with zero funding.
  4. A matched-entry control on a perpetual accrues funding exactly as the entry does.

### F3 - funding as a strategy input

- **Owner:** Market Data (field semantics), with Strategy Factory's Design vocabulary.
- **What changes:** `MarketDataFieldSemantic` gains the funding rate and its interval in the places listed in
  section 1. Strategy Factory's N1 text moves from TARGET to CURRENT.
- **Acceptance:**
  1. A Design reading funding resolves, binds and replays on the production path.
  2. The 12-member set becomes 14, and its codec and registry tests fail if any one of the three places is left
     out.
  3. A Design asking for liquidations is still refused as `INPUT_FACT_UNAVAILABLE_FROM_ADMITTED_SOURCE`.
- **Order:** K1 needs F2 (its return is the funding) and F3 (its signal). They can proceed in parallel after F1.

### O1 - open interest as a Market Data fact

- **Owner:** Market Data.
- **What changes:** open interest (contracts and notional) as two more row fields of the same source, from two
  routes:
  - the archive `metrics` file for any cut whose day is published;
  - REST `openInterestHist` for cuts inside its 30-day window and after the archive's last day.
  - Each fact records which route produced it.
- **Acceptance:**
  1. The knowable-at rule: a cut at archive-stamp t + 5m - 1 ms does not see the row stamped t; a cut at
     t + 5m does.
  2. For a day both routes cover, the two routes yield identical facts after the 5-minute alignment (the 287/288
     measured above), and a test fails if the alignment is removed.
  3. A cut older than 30 days whose archive day is missing refuses by name. It does not fall back to REST, which
     would answer 400.
  4. A cut whose day is not yet published (T+1) uses REST, or refuses by name if REST is unavailable.
- **Strategy input:** O2 adds the semantic, exactly as F3 does.

### R1 - taker buy and sell volume

- **Owner:** Market Data.
- **What changes:** the cheapest slice. The source already receives `volume` and `taker_buy_volume` and drops them.
  It emits both, which also gives the existing `BAR.VOLUME.QUANTITY` semantic a Binance producer for the first time.
- **Acceptance:**
  1. The emitted values equal the archive kline columns for the same bars.
  2. Sell volume is derived as `volume - taker_buy_volume` in one Owner function.
  3. No new HTTP call is made.

### R2 - long/short ratios

- **Owner:** Market Data.
- **What changes:** the three ratios from the same `metrics` file and REST family as O1, with the same knowable-at
  rule.
- **Acceptance:** O1's four assertions, per ratio, with the stated REST precision as the comparison tolerance.

### R3 - liquidations

- **Not proposed for history.** No public historical source exists for USD-M (section 2), so the Design refusal
  stays.
- **The only possible route:** a forward recorder on `/market/ws/{sym}@forceOrder`. That is a new long-running
  process with its own custody. Its history starts the day it starts, and Binance documents it as at most one event
  per symbol per second.
- **Recommendation:** open it only when a research need names it. It goes last and is its own design.

## 5. Risks

- **451 on hosted runners.** Measured:
  - `fapi.binance.com` answers 451 on a runner for every endpoint above;
  - `www.binance.com` answers 200 for the same paths;
  - `data.binance.vision` answers 200.

  The deployment is the user's single machine, where `fapi.binance.com` answers 200, so this constrains CI evidence,
  not the product. Follow the pattern already used for the bar source:
  - the canonical host by default;
  - an environment override that moves the client and the recorded endpoint together;
  - a log line naming the chosen host and why.

  Do not record `www.binance.com` as production provenance; it is not a documented API host. Archive-backed
  assertions run on a runner unchanged.
- **A path that connects and stays silent.** `wss://fstream.binance.com/ws/{stream}` completes the 101 handshake and
  delivers nothing. `aggTrade` gave 0 frames in 5 s there, and 13 on `/market/ws/` in the same 5 s. A recorder on the
  old path would record an empty, healthy-looking stream. Any WS slice asserts at least one frame on a high-rate
  control stream.
- **Absence that looks like data.** Four cases must stay distinct:
  - the daily funding path is 404 because funding is published monthly;
  - the metrics archive lags a day;
  - the REST history stops at 30 days with a 400;
  - the current month of funding is absent from the archive.

  Each one must surface as a named refusal, never as zero or empty, and each is a test.
- **Rate limits.**
  - Measured: `REQUEST_WEIGHT` is 2400 per minute (`exchangeInfo.rateLimits`), and `premiumIndex` and
    `openInterest` each cost weight 1.
  - Documented and not measured: the `/futures/data` family has its own per-IP limit.
  - Full BTCUSDT funding history is about 7,600 settlements, which is 8 requests at 1,000 per page.
  - Open interest and ratios over history come from one archive file per symbol-day and cost no API weight.
  - No slice needs more than a handful of requests per cut.
- **Storage.**
  - Funding: about 1,100 rows per symbol-year at 8h.
  - Metrics: 288 rows per symbol-day; about 11.5 KB per zipped file, so all archived days for three symbols are
    about 76 MB of raw archive.
  - The PIT tables grow with requested cuts, not with history (`MAX_OBSERVATIONS` 10,000 per batch,
    `authority.rs:1260`).
  - A liquidation recorder grows with market activity: 8 events per minute across all symbols at a quiet hour.
- **A stale `serverTime`.** One `exchangeInfo` answer carried a `serverTime` about ten hours behind the other
  responses in the same minute. That suggests an edge cache; it was seen once. IM V2 intake must not treat
  `serverTime` as the observation time.
- **Ownership.** Every slice except F2 is Market Data Owner code. Lane 2 has not answered since 2026-09-28, so who
  implements them is Lane 3's assignment, not this plan's.
