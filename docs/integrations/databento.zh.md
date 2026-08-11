# Databento

VibeTrader 包含适用于 [Databento](https://databento.com/) API 和
[Databento Binary Encoding（DBN）](https://databento.com/docs/standards-and-conventions/databento-binary-encoding)
数据的适配器。Databento 只提供市场数据。适配器不含执行客户端，但可与沙盒配合进行模拟执行。
也可以将 Databento 数据与 Interactive Brokers 执行匹配，或计算传统资产类别信号用于加密货币交易。

适配器支持：

- 从 DBN 文件加载历史数据，并解码为 Vibe 对象，用于回测或目录存储。
- 请求解码为 Vibe 对象的历史数据，用于实盘交易和回测。
- 订阅解码为 Vibe 对象的实时数据馈送，用于实盘交易和沙盒环境。

:::tip
[Databento](https://databento.com/signup) 为新注册用户提供 125 美元免费数据额度。目前可以将该额度用于
历史数据或订阅计划的首月费用。

谨慎控制请求即可覆盖测试与评估。请求数据前请检查
[/metadata.get_cost](https://databento.com/docs/api-reference-historical/metadata/metadata-get-cost)端点。
:::

## 概览

适配器使用 [databento-rs](https://crates.io/crates/databento) crate，即 Databento 官方 Rust 客户端库。

:::info
无需单独安装 `databento`。适配器会编译为静态库，并在构建期间自动链接。
:::

可用的适配器类如下：

- `DatabentoDataLoader`：从文件加载 DBN 数据。
- `DatabentoInstrumentProvider`：通过 Databento HTTP API 获取最新或历史金融工具定义。
- `DatabentoHistoricalClient`：通过 Databento HTTP API 获取历史市场数据。
- `DatabentoLiveClient`：通过 Databento 原始 TCP API 订阅实时数据馈送。
- `DatabentoDataClient`：用于实盘交易节点的 `LiveMarketDataClient` 实现。

:::info
大多数用户会配置实盘交易节点（见下文），无需直接操作这些组件。
:::

## 示例

- [Python 示例](https://github.com/qOeOp/trade/tree/main/examples/live/databento/)

Rust 示例位于
[`crates/adapters/databento/examples/`](https://github.com/qOeOp/trade/tree/main/crates/adapters/databento/examples/)。
数据测试器运行时会订阅已配置金融工具的实时报价和成交：

```bash
cargo run --example databento-data-tester --package vibe-databento
```

## Databento 文档

请参阅 [Databento 新用户指南](https://databento.com/docs/quickstart/new-user-guides)，并结合本集成指南阅读。

## Databento Binary Encoding（DBN）

Databento Binary Encoding（DBN）是一种适用于标准化市场数据的快速消息编码和存储格式。
[DBN 规范](https://databento.com/docs/standards-and-conventions/databento-binary-encoding)包含自描述元数据头
和一组固定结构体定义，用于标准化市场数据的规范化方式。

适配器将 DBN 数据解码为 Vibe 对象。同一个 Rust 解码器负责：

- 从磁盘加载并解码 DBN 文件。
- 实时解码历史数据和实时数据。

## 支持的数据模式

VibeTrader 支持以下 Databento 数据模式：

| Databento 数据模式                                                           | Vibe 数据类型                    | 说明                        |
| :--------------------------------------------------------------------------- | :------------------------------- | :-------------------------- |
| [MBO](https://databento.com/docs/schemas-and-data-formats/mbo)               | `OrderBookDelta`                 | 逐笔委托市场（L3）。        |
| [MBP_1](https://databento.com/docs/schemas-and-data-formats/mbp-1)           | `(QuoteTick, TradeTick \| None)` | 逐价市场（L1）。            |
| [MBP_10](https://databento.com/docs/schemas-and-data-formats/mbp-10)         | `OrderBookDepth10`               | 市场深度（L2）。            |
| [BBO_1S](https://databento.com/docs/schemas-and-data-formats/bbo-1s)         | `QuoteTick`                      | 1 秒最优买价/卖价。         |
| [BBO_1M](https://databento.com/docs/schemas-and-data-formats/bbo-1m)         | `QuoteTick`                      | 1 分钟最优买价/卖价。       |
| [CMBP_1](https://databento.com/docs/schemas-and-data-formats/cmbp-1)         | `(QuoteTick, TradeTick \| None)` | 跨交易场所合并 MBP。        |
| [CBBO_1S](https://databento.com/docs/schemas-and-data-formats/cbbo-1s)       | `QuoteTick`                      | 合并的 1 秒 BBO。           |
| [CBBO_1M](https://databento.com/docs/schemas-and-data-formats/cbbo-1m)       | `QuoteTick`                      | 合并的 1 分钟 BBO。         |
| [TCBBO](https://databento.com/docs/schemas-and-data-formats/tcbbo)           | `(QuoteTick, TradeTick)`         | 按成交采样的合并 BBO。      |
| [TBBO](https://databento.com/docs/schemas-and-data-formats/tbbo)             | `(QuoteTick, TradeTick)`         | 按成交采样的最优买价/卖价。 |
| [TRADES](https://databento.com/docs/schemas-and-data-formats/trades)         | `TradeTick`                      | 逐笔成交。                  |
| [OHLCV_1S](https://databento.com/docs/schemas-and-data-formats/ohlcv-1s)     | `Bar`                            | 1 秒 K 线。                 |
| [OHLCV_1M](https://databento.com/docs/schemas-and-data-formats/ohlcv-1m)     | `Bar`                            | 1 分钟 K 线。               |
| [OHLCV_1H](https://databento.com/docs/schemas-and-data-formats/ohlcv-1h)     | `Bar`                            | 1 小时 K 线。               |
| [OHLCV_1D](https://databento.com/docs/schemas-and-data-formats/ohlcv-1d)     | `Bar`                            | 日 K 线。                   |
| [DEFINITION](https://databento.com/docs/schemas-and-data-formats/definition) | `Instrument`（多种类型）         | 金融工具定义。              |
| [IMBALANCE](https://databento.com/docs/schemas-and-data-formats/imbalance)   | `DatabentoImbalance`             | 竞价不平衡数据。            |
| [STATISTICS](https://databento.com/docs/schemas-and-data-formats/statistics) | `DatabentoStatistics`            | 市场统计。                  |
| [STATUS](https://databento.com/docs/schemas-and-data-formats/status)         | `InstrumentStatus`               | 市场状态更新。              |

:::note
Databento 还记录了公司行动、调整因子和证券主数据等参考数据模式。此适配器目前只将上表数据模式映射到
Vibe 数据类型。Databento 日 OHLCV 使用 `ohlcv-1d`。官方结算价和未平仓量来自 `statistics` 数据模式，
而非 OHLCV K 线。
:::

:::info
不支持的 `instrument_class` 值（`'I'` 指数、`'B'` 债券）的金融工具定义会跳过并发出警告，
而不会中止批次。含有 Vibe 无法映射货币的 FX 现货定义也会跳过。会发出指数的发布方包括
CGIF.TITANIUM（110）、IEX Options（108）和 MEMX MX2（109）。如需 Vibe 对这些类型建模，请提交 issue。

`stat_type` 值超出已建模范围（目前为 1-20）的统计消息也会跳过并发出警告。其中包括交易场所
特定值 `VenueSpecificVolume1`（10001）和 `VenueSpecificPrice1`（10002），它们超出了持久化所用
`u8` Arrow 列宽度。
:::

### 数据模式注意事项

- **TBBO 和 TCBBO**：按成交采样的数据馈送，将每笔成交与其产生影响*之前*的 BBO 配对。需要让成交与
  同时段报价对齐而不管理两个数据流时使用。
- **MBP-1 和 CMBP-1（L1）**：事件级更新，只在成交事件上发出成交。需要完整的最优档事件带时使用。
  报价和成交对齐应优先使用 TBBO 或 TCBBO。
- **MBP-10（L2）**：前 10 档并包含成交。适用于不需要完整 MBO 数据的深度感知策略。包含每档订单数。
  Databento 订单簿深度订阅仅支持 `depth=10`。
- **MBO（L3）**：用于队列位置建模和精确订单簿重建的逐订单事件。应在节点初始化时开始，以获得正确重放上下文。
- **BBO_1S/BBO_1M 和 CBBO_1S/CBBO_1M**：按固定间隔（1s 或 1m）采样的最优档更新。适配器只为这些
  数据模式发出 `QuoteTick`。适用于监控、价差和低成本信号，不适合微观结构工作。
- **TRADES**：仅成交。与 MBP-1（`include_trades=True`）配合，或使用 TBBO/TCBBO 获取成交对应报价上下文。
- **OHLCV**：从成交聚合的 K 线，用于更高时间周期分析。设置 `bars_timestamp_on_close=True` 以使用收盘时间戳。
  日 K 线使用 `ohlcv-1d`；官方结算和未平仓量使用 `statistics`。
- **竞价不平衡与统计数据**：交易场所运营数据。通过 `subscribe_data` 订阅，并使用携带 `instrument_id`
  元数据的 `DataType`。
- **市场状态**：交易场所交易状态更新。通过 `subscribe_instrument_status` 订阅。

:::tip
合并数据模式（CMBP_1、CBBO_1S、CBBO_1M、TCBBO）聚合多个交易场所的数据，适合跨交易场所分析。
:::

:::info
另请参阅 Databento [数据模式和数据格式](https://databento.com/docs/schemas-and-data-formats)指南。
:::

## 数据集可用性与选择

Databento 数据集 ID 与 Vibe 交易场所标识符相互独立。适配器支持上列数据模式，但每个 Databento 数据集
只公开其中一个子集。在实盘配置中添加新数据集或数据模式前，请检查元数据端点：

```bash
databento_auth="$(printf '%s:' "$DATABENTO_API_KEY" | base64 | tr -d '\n')"

curl --header "Authorization: Basic ${databento_auth}" \
  "https://hist.databento.com/v0/metadata.list_schemas?dataset=EQUS.MINI"

curl --header "Authorization: Basic ${databento_auth}" \
  "https://hist.databento.com/v0/metadata.list_unit_prices?dataset=EQUS.MINI"

curl --header "Authorization: Basic ${databento_auth}" \
  "https://hist.databento.com/v0/metadata.get_cost" \
  --data-urlencode "dataset=EQUS.MINI" \
  --data-urlencode "symbols=AAPL" \
  --data-urlencode "stype_in=raw_symbol" \
  --data-urlencode "schema=bbo-1s" \
  --data-urlencode "start=2026-06-24T14:30:00Z" \
  --data-urlencode "end=2026-06-24T14:31:00Z"
```

两个常用评估数据集：

- `GLBX.MDP3` 是 CME、CBOT、NYMEX 和 COMEX 的 CME Globex MDP 3.0 数据集，涵盖期货、期货期权和价差。
  支持 MBO、MBP-1、MBP-10、TBBO、trades、BBO 周期、OHLCV、definitions、statistics 和 status。
  不公开合并股票数据模式（`cmbp-1`、`cbbo-*` 或 `tcbbo`）。
- `EQUS.MINI` 是 Databento US Equities Mini。它是派生的聚合最优档数据集，组件交易场所已匿名化。
  支持 MBP-1、TBBO、trades、BBO 周期、OHLCV 和 definitions。不支持 MBO、MBP-10、imbalance、
  statistics、status 或合并数据模式。

US Equities Mini 金融工具应使用 `EQUS` 作为 Vibe 交易场所：`AAPL.EQUS`、`MSFT.EQUS` 等。
内置交易场所到数据集的映射会将 `EQUS` 路由到 `EQUS.MINI`。`XNAS` 和 `XNYS` 等交易场所代码
指向交易场所特定数据集，除非通过 `venue_dataset_map` 覆盖。

:::warning
如果将 `XNAS` 等交易场所覆盖到 `EQUS.MINI`，请保持下游金融工具 ID 一致。Mini 记录携带合并的
`EQUS` 发布方；未显式指定 `instrument_id` 的文件或历史解码会发出 `*.EQUS` 标识符。
:::

成本取决于数据模式、符号和时间范围。探索时应从较窄范围、`definition`、`bbo-1s`、`bbo-1m` 或
`trades` 开始，并在拉取历史时间序列数据前调用 `metadata.get_cost`。当 `mbp-1` 或 `tbbo` 等组合
数据模式已包含策略所需数据时，请避免重复订阅报价和成交。

## 实时订阅的数据模式选择

Vibe 订阅方法按下表映射到 Databento 数据模式：

| Vibe 订阅方法              | 默认数据模式 | 可用 Databento 数据模式                                                      | Vibe 数据类型      |
| :------------------------- | :----------- | :--------------------------------------------------------------------------- | :----------------- |
| `subscribe_quotes()`       | `mbp-1`      | `mbp-1`, `bbo-1s`, `bbo-1m`, `cmbp-1`, `cbbo-1s`, `cbbo-1m`, `tbbo`, `tcbbo` | `QuoteTick`        |
| `subscribe_trades()`       | `trades`     | `trades`, `tbbo`, `tcbbo`, `mbp-1`, `cmbp-1`                                 | `TradeTick`        |
| `subscribe_book_depth10()` | `mbp-10`     | `mbp-10`                                                                     | `OrderBookDepth10` |
| `subscribe_book_deltas()`  | `mbo`        | `mbo`                                                                        | `OrderBookDeltas`  |
| `subscribe_bars()`         | 视情况而定   | `ohlcv-1s`, `ohlcv-1m`, `ohlcv-1h`, `ohlcv-1d`                               | `Bar`              |

:::warning
"可用 Databento 数据模式"列列出适配器为该 Vibe 订阅方法支持的选择。所选数据集也必须支持该数据模式。
例如，`EQUS.MINI` 无法提供 `mbo`、`mbp-10`、`statistics` 或 `status`。
:::

:::note
以下示例假定处于 `Strategy` 或 `DataActor` 上下文，且 `self` 具有订阅方法。导入所需类型：

```python
from vibe_trader.model import BarType
from vibe_trader.model import BookType
from vibe_trader.model import ClientId
from vibe_trader.model import InstrumentId


DATABENTO_CLIENT_ID = ClientId.from_str("DATABENTO")
```

:::

### 报价订阅（MBP 和 L1）

```python
# Default MBP-1 quotes (may include trades)
self.subscribe_quotes(instrument_id, client_id=DATABENTO_CLIENT_ID)

# Explicit MBP-1 schema
self.subscribe_quotes(
    instrument_id=instrument_id,
    params={"schema": "mbp-1"},
    client_id=DATABENTO_CLIENT_ID,
)

# 1-second BBO snapshots (adapter emits QuoteTick only)
self.subscribe_quotes(
    instrument_id=instrument_id,
    params={"schema": "bbo-1s"},
    client_id=DATABENTO_CLIENT_ID,
)

# Consolidated quotes across venues
self.subscribe_quotes(
    instrument_id=instrument_id,
    params={"schema": "cbbo-1s"},  # or "cmbp-1" for consolidated MBP
    client_id=DATABENTO_CLIENT_ID,
)

# Trade-sampled BBO (includes quotes and trades)
self.subscribe_quotes(
    instrument_id=instrument_id,
    params={"schema": "tbbo"},  # Receives QuoteTick and TradeTick on the message bus
    client_id=DATABENTO_CLIENT_ID,
)
```

### 成交订阅

```python
# Trade ticks only
self.subscribe_trades(instrument_id, client_id=DATABENTO_CLIENT_ID)

# Trades from MBP-1 feed (only when trade events occur)
self.subscribe_trades(
    instrument_id=instrument_id,
    params={"schema": "mbp-1"},
    client_id=DATABENTO_CLIENT_ID,
)

# Trade-sampled data (includes quotes at trade time)
self.subscribe_trades(
    instrument_id=instrument_id,
    params={"schema": "tbbo"},  # Also provides quotes at trade events
    client_id=DATABENTO_CLIENT_ID,
)
```

### 订单簿深度订阅（MBP 和 L2）

```python
from vibe_trader.model import BookType


# Subscribe to top 10 levels of market depth
self.subscribe_book_depth10(
    instrument_id=instrument_id,
    book_type=BookType.L2_MBP,  # MBP-10 schema is automatically selected
)

# The depth parameter must be 10 for Databento
# Receives OrderBookDepth10 updates
```

### 订单簿增量订阅（MBO 和 L3）

```python
# Subscribe to full order book updates (market by order)
self.subscribe_book_deltas(
    instrument_id=instrument_id,
    book_type=BookType.L3_MBO,  # Uses MBO schema
)

# Make MBO subscriptions at node startup so Databento can replay from session start
```

### K 线订阅

```python
# Subscribe to 1-minute bars (automatically uses ohlcv-1m schema)
self.subscribe_bars(bar_type=BarType.from_str(f"{instrument_id}-1-MINUTE-LAST-EXTERNAL"))

# Subscribe to 1-second bars (automatically uses ohlcv-1s schema)
self.subscribe_bars(bar_type=BarType.from_str(f"{instrument_id}-1-SECOND-LAST-EXTERNAL"))

# Subscribe to hourly bars (automatically uses ohlcv-1h schema)
self.subscribe_bars(bar_type=BarType.from_str(f"{instrument_id}-1-HOUR-LAST-EXTERNAL"))

# Subscribe to daily bars (automatically uses ohlcv-1d schema)
self.subscribe_bars(bar_type=BarType.from_str(f"{instrument_id}-1-DAY-LAST-EXTERNAL"))
```

### 自定义数据类型订阅

Imbalance 和 statistics 数据需要通用 `subscribe_data` 方法：

```python
from vibe_trader.adapters.databento import DatabentoImbalance
from vibe_trader.adapters.databento import DatabentoStatistics
from vibe_trader.model import ClientId
from vibe_trader.model import DataType


DATABENTO_CLIENT_ID = ClientId.from_str("DATABENTO")

# Subscribe to imbalance data
self.subscribe_data(
    data_type=DataType(DatabentoImbalance.__name__, metadata={"instrument_id": instrument_id}),
    client_id=DATABENTO_CLIENT_ID,
)

# Subscribe to statistics data
self.subscribe_data(
    data_type=DataType(DatabentoStatistics.__name__, metadata={"instrument_id": instrument_id}),
    client_id=DATABENTO_CLIENT_ID,
)
```

金融工具状态使用专用状态订阅 API：

```python
# Subscribe to instrument status updates
self.subscribe_instrument_status(
    instrument_id=instrument_id,
    client_id=DATABENTO_CLIENT_ID,
)
```

## 金融工具 ID 与符号体系

Databento 市场数据包含 `instrument_id` 字段：大多数情况下是发布方分配的数字 ID；发布方不提供时，
则由 Databento 合成。Databento 只保证该 ID 在某一天内唯一。Vibe `InstrumentId` 则不同，它是用句点分隔
符号与交易场所的字符串：`"{symbol}.{venue}"`。

解码器将 Databento `raw_symbol` 映射到 Vibe `symbol`。发布方 ID 通过 `publishers.json` 映射到默认
Vibe 交易场所。市场数据到达前，订阅的 `InstrumentId` 元数据也可以预先填充符号到交易场所的映射。

Databento 使用与交易场所标识符分离的*数据集 ID* 标识数据集。详情请参阅
[Databento 数据集命名约定](https://databento.com/docs/api-reference-historical/basics/datasets)。

对于历史请求和实时订阅，适配器会将每个 `InstrumentId` 的 Vibe 符号部分作为 Databento 符号发送，
并根据该字符串推断 `stype_in`：

- 以 `.FUT` 或 `.OPT` 结尾的符号使用 Databento 父级符号体系，例如 `ES.FUT.XCME`。
- 最后一部分为数字的三段式符号使用连续符号体系，例如 `ES.c.0.GLBX`。
- 全数字符号使用 Databento `instrument_id` 符号体系。
- 其他所有符号使用原始符号体系，例如 `ESZ6.XCME` 或 `AAPL.EQUS`。

一个请求或订阅中的所有符号必须使用同一种符号体系。可以将 `AAPL.EQUS` 与 `MSFT.EQUS` 批量处理，
或将 `ES.FUT.XCME` 与 `NQ.FUT.XCME` 批量处理，但不要在同一 Databento 请求中混用原始符号和父级符号。

对于 CME Globex MDP 3.0（`GLBX.MDP3`），发布方默认映射到 `GLBX` 交易场所。
当 `use_exchange_as_venue=True` 时，定义消息可以使用金融工具的交易所 MIC 覆盖 `GLBX`：

- `CBCM`：XCME-XCBT 跨交易所价差
- `NYUM`：XNYM-DUMX 跨交易所价差
- `XCBT`：Chicago Board of Trade（CBOT）
- `XCEC`：Commodities Exchange Center（COMEX）
- `XCME`：Chicago Mercantile Exchange（CME）
- `XFXS`：CME FX Link 价差
- `XNYM`：New York Mercantile Exchange（NYMEX）

:::info
其他交易场所 MIC 位于
[metadata.list_publishers](https://databento.com/docs/api-reference-historical/metadata/metadata-list-publishers)
端点响应的 `venue` 字段中。
:::

## 时间戳

Databento 数据包含以下时间戳字段：

- `ts_event`：撮合引擎收到消息的时间戳，单位为自 UNIX epoch 起的纳秒数。
- `ts_in_delta`：撮合引擎发送消息的时间，在 `ts_recv` 之前多少纳秒。
- `ts_recv`：采集服务器收到消息的时间戳，单位为自 UNIX epoch 起的纳秒数。
- `ts_out`：Databento 发送时间戳（仅实时数据）。

根据 `Data` 契约，Vibe 数据至少需要两个时间戳：

- `ts_event`：数据事件发生时的 UNIX 时间戳（纳秒）。
- `ts_init`：创建数据实例时的 UNIX 时间戳（纳秒）。

报价和成交类 schema 将 Databento `ts_recv` 映射到 Vibe `ts_event`，因为它更可靠，并且对每个
Databento 符号单调递增。K 线使用 DBN K 线周期时间戳；`bars_timestamp_on_close` 控制 Vibe K 线使用
周期开盘还是收盘时间戳。`InstrumentStatus` 使用解码后状态消息的状态事件时间戳。
`DatabentoImbalance` 和 `DatabentoStatistics` 会保留 Databento 时间戳字段，因为它们是适配器特定类型。

:::info
详细信息请参阅以下 Databento 文档：

- [Databento 标准与约定 - 时间戳](https://databento.com/docs/standards-and-conventions/common-fields-enums-types#timestamps)
- [Databento 时间戳指南](https://databento.com/docs/architecture/timestamping-guide)

:::

## 数据类型

本节说明 Databento 数据模式到 Vibe 数据类型的映射。

:::info
请参阅 Databento [数据模式和数据格式](https://databento.com/docs/schemas-and-data-formats)。
:::

### 金融工具定义

Databento 对所有金融工具类别使用同一个数据模式。解码器会将每种类别映射到适当的 Vibe `Instrument` 类型。

| Databento 金融工具类别 | 代码 | Vibe 金融工具类型 |
| ---------------------- | ---- | ----------------- |
| 股票                   | `K`  | `Equity`          |
| 期货                   | `F`  | `FuturesContract` |
| 看涨期权               | `C`  | `OptionContract`  |
| 看跌期权               | `P`  | `OptionContract`  |
| 期货价差               | `S`  | `FuturesSpread`   |
| 期权价差               | `T`  | `OptionSpread`    |
| 混合价差               | `M`  | `OptionSpread`    |
| FX 现货                | `X`  | `CurrencyPair`    |
| 指数                   | `I`  | 尚不可用          |
| 债券                   | `B`  | 尚不可用          |

### 期权到期时间修正

OPRA 期权定义（数据集 `OPRA.PILLAR`）的到期时间只有日期精度：日内时间归零为 UTC 午夜。因此，
在纽约时间 16:00 到期的期权会显示为纽约前一天晚上，导致撮合引擎在最后一个交易时段前就将合约视为到期。
默认情况下，加载器会将这种 UTC 午夜的 OPRA 到期时间修正为纽约时间 16:00，其他所有数据集保持不变；
已经包含日内时间的到期时间（例如 CME Globex）也不受影响。

使用 `expiration_overrides` 可以覆盖默认值或为各标的设置时间。它将数据集映射到标的符号与时间的映射，
其中保留键 `default` 用于设置数据集级时间：

```python
loader.load_instruments(
    filepath=path,
    use_exchange_as_venue=False,
    expiration_overrides={
        "OPRA.PILLAR": {"default": "16:00", "SPX": "09:30"},
    },
)
```

时间使用交易所本地时区的 `HH:MM` 或 `HH:MM:SS`（OPRA 为纽约）。只能调整具有内置修正规则的数据集
（目前为 `OPRA.PILLAR`）；未知或没有规则的数据集（例如 `GLBX.MDP3`）会引发 `ValueError`。
修正以期权标的为键，因此无法区分共享同一标的但结算时间不同的系列（例如上午结算的 SPX 与下午结算的 SPXW）；
请设置与所加载合约匹配的时间。

### 价格精度

Databento 原始价格是按 1e-9 缩放的定点整数。适配器根据定义消息中的金融工具 tick 大小派生价格精度。

对于实时数据馈送，馈送处理器会维护逐金融工具精度映射，在 `InstrumentDefMsg` 记录到达时填充。
市场数据处理器按以下顺序解析精度：

1. Databento 记录 `instrument_id` 的 `InstrumentDefMsg` 元数据。
2. Python 订阅路径传入的缓存金融工具精度。
3. 传给直接实时客户端的显式 `price_precisions`。
4. USD 默认精度 2。

回退映射会在符号映射后以 Databento 记录 `instrument_id` 为键，因此在定义元数据到达前，父级、连续
及其他非原始符号体系请求仍可使用缓存或显式精度。

对于 tick 大小非标准的金融工具（例如 tick 为 1/256 等分数的国债期货），要获得正确精度，
**金融工具定义必须先于市场数据到达**。请在市场数据订阅之前或同时为金融工具订阅 `DEFINITION` 数据模式。

对于历史请求和基于文件的加载，按以下顺序为每条记录解析精度：

1. 调用时显式传入的 `price_precision` 参数。
2. 通过加载定义（文件加载器上的 `load_instruments`、历史客户端上的 `get_range_instruments`）填充的逐符号缓存，
   或显式调用 `set_price_precision(symbol, precision)` 填充的缓存。

Python 数据客户端会在每次请求前使用金融工具提供器填充历史客户端缓存，因此已经加载的金融工具无需额外配置。
无法解析精度时，加载会返回明确错误，而不会静默回退到 USD 精度。

:::tip
Python 适配器会在市场数据前自动订阅金融工具定义，并将缓存的金融工具精度作为回退传入，因此精度映射无需
额外配置即可填充。直接使用 Rust 客户端时，请在市场数据前订阅 `DEFINITION` 数据模式或传入显式精度回退值。
:::

### MBO（逐笔委托市场）

MBO 是 Databento 粒度最高的数据，表示完整订单簿深度。部分消息包含成交数据。解码器会生成一个
`OrderBookDelta`，并可选生成一个 `TradeTick`。

实时客户端会缓存 MBO 消息，直到看到 `F_LAST` 标志，再将 `OrderBookDeltas` 容器传给处理器。

客户端还会在重放启动序列期间，将订单簿快照缓存到 `OrderBookDeltas` 中。

### MBP-1（逐价市场，最优档）

MBP-1 表示最优档报价和成交。部分消息携带成交数据。解码器会生成 `QuoteTick`，消息为成交时还会生成
`TradeTick`。

### TBBO 和 TCBBO（含成交的最优档）

TBBO 和 TCBBO 在每条消息中同时提供报价和成交数据。两种数据模式的每条消息都会发出 `QuoteTick` 和
`TradeTick`，比独立报价和成交订阅更高效。TCBBO 提供跨交易场所的合并数据。

#### 成交 ID 派生（CMBP-1 和 TCBBO）

CMBP-1 和 TCBBO 数据模式不发布原生成交标识符。解码器会对金融工具 ID、`ts_event`、`ts_recv`、价格、
数量和成交主动方方向计算 FNV-1a 哈希，派生确定性的 `TradeId`。同一交易场所事件在重放时会产生相同
成交 ID，保持下游去重有效。字段完全相同但逻辑上不同的两笔成交会冲突；这与交易场所无法区分它们的情况一致。

### OHLCV（K 线聚合）

Databento 在周期**开盘**时为 K 线消息添加时间戳。默认情况下，解码器会将 K 线 `ts_event` 规范化为
K 线**收盘**时间：原始 `ts_event` 加上周期。如果未提供显式初始化时间戳，`ts_init` 在实时场景使用
接收时间，在历史和文件加载中使用收盘时间。设置 `bars_timestamp_on_close=False` 可让 K 线 `ts_event`
使用周期开盘时间。

### 竞价不平衡与统计数据

`imbalance` 和 `statistics` 数据模式没有内置 Vibe 对应类型。适配器在 Rust 中定义了
`DatabentoImbalance` 和 `DatabentoStatistics`。

Python 绑定直接从 `vibe_trader.adapters.databento` 公开这些类型。

请求和订阅这些类型需要通用 `subscribe_data` 方法。为 `AAPL.XNAS` 订阅 `imbalance`：

```python
from vibe_trader.adapters.databento import DatabentoImbalance
from vibe_trader.model import ClientId
from vibe_trader.model import DataType


DATABENTO_CLIENT_ID = ClientId.from_str("DATABENTO")

instrument_id = InstrumentId.from_str("AAPL.XNAS")
self.subscribe_data(
    data_type=DataType(DatabentoImbalance.__name__, metadata={"instrument_id": instrument_id}),
    client_id=DATABENTO_CLIENT_ID,
)
```

请求 `ES.FUT` 父级符号（所有活跃 E-mini S&P 500 期货）的有界 `statistics` 范围。
实际拉取历史数据前，请使用 Databento Historical
[`metadata.get_cost`](https://databento.com/docs/api-reference-historical/metadata/metadata-get-cost)端点：

```python
from vibe_trader.adapters.databento import DatabentoStatistics
from vibe_trader.model import ClientId
from vibe_trader.model import DataType


DATABENTO_CLIENT_ID = ClientId.from_str("DATABENTO")

instrument_id = InstrumentId.from_str("ES.FUT.GLBX")
metadata = {
    "instrument_id": instrument_id,
    "start": "2024-03-06",
    "end": "2024-03-07",
}
self.request_data(
    data_type=DataType(DatabentoStatistics.__name__, metadata=metadata),
    client_id=DATABENTO_CLIENT_ID,
)
```

### 目录持久化

两种类型都支持 Arrow 序列化以存入目录。导入适配器包时，Arrow 序列化器会自动注册。

#### 写入目录

```python
from vibe_trader.adapters.databento import DatabentoDataLoader
from vibe_trader.model import InstrumentId
from vibe_trader.persistence import ParquetDataCatalog

catalog = ParquetDataCatalog.from_env()
loader = DatabentoDataLoader()

imbalances = loader.load_imbalance(
    filepath="aapl-imbalance.dbn.zst",
    instrument_id=InstrumentId.from_str("AAPL.XNAS"),
)

catalog.write_data(imbalances)
```

#### 从目录读取

```python
from vibe_trader.adapters.databento import DatabentoImbalance

results = catalog.query(DatabentoImbalance, identifiers=["AAPL.XNAS"])

for imbalance in results:
    print(imbalance.ref_price)  # DatabentoImbalance fields
```

:::warning
目录持久化支持写入和查询这些类型，但尚不支持通过 `BacktestNode` 或 `BacktestEngine` 流式传输。
使用 imbalance 或 statistics 数据进行回测时，请直接查询目录，并在策略或分析代码中处理结果。
:::

#### 在 Rust 中编码和解码

`vibe_databento::arrow` 模块提供 Arrow 记录批次的编码和解码。请启用 `arrow` 功能标志。

```rust
use vibe_databento::arrow::imbalance::{
    decode_imbalance_batch,
    imbalance_to_arrow_record_batch,
};

let batch = imbalance_to_arrow_record_batch(imbalances)?;

let metadata = batch.schema().metadata().clone();
let decoded = decode_imbalance_batch(&metadata, batch)?;
```

`statistics` 模块遵循相同模式，使用 `decode_statistics_batch` 和 `statistics_to_arrow_record_batch`。

## 性能注意事项

使用 DBN 数据进行回测有两种选择：

- 将数据存储为 DBN（`.dbn.zst`）文件，每次运行时解码为 Vibe 对象。
- 将 DBN 文件一次性转换为 Vibe 对象，并写入数据目录（Vibe Parquet 格式）。

DBN 解码器经过 Rust 优化，但一次性写入目录可获得最佳回测性能。

[DataFusion](https://arrow.apache.org/datafusion/) 能以高吞吐量从磁盘流式读取 Vibe Parquet 数据，
速度至少比每次运行时解码 DBN 快一个数量级。

:::note
性能基准测试仍在开发中。
:::

对于实时数据，从馈送处理器到 Vibe 的解码后交付有意采用无界方式。这样可防止慢速消费者阻塞馈送路径；
内存紧张的进程应当失败，而不是阻塞实时解码。

## 加载 DBN 数据

`DatabentoDataLoader` 将 DBN 文件直接解码为 Vibe 对象。它为每种受支持输出类型提供方法，包括
`load_instruments`、`load_order_book_deltas`、`load_order_book_depth10`、`load_quotes`、
`load_trades`、`load_bars`、`load_status`、`load_imbalance` 和 `load_statistics`。

如果运行可执行文件旁没有发布方元数据文件，请传入该文件：

```python
from vibe_trader.adapters.databento import DatabentoDataLoader
from vibe_trader.model import InstrumentId


loader = DatabentoDataLoader(publishers_filepath="publishers.json")

instruments = loader.load_instruments(
    filepath="equity-definitions.dbn.zst",
    use_exchange_as_venue=True,
)
trades = loader.load_trades(
    filepath="aapl-trades.dbn.zst",
    instrument_id=InstrumentId.from_str("AAPL.XNAS"),
)
```

写入 `ParquetDataCatalog` 时，请先加载定义数据，再加载市场数据：

```python
from vibe_trader.persistence import ParquetDataCatalog


catalog = ParquetDataCatalog.from_env()
catalog.write_data(instruments)
catalog.write_data(trades)
```

对合并文件使用数据模式专用的合并方法：

- `load_cmbp_quotes` 用于 CMBP-1 报价。
- `load_cbbo_quotes` 用于 CBBO 报价。
- `load_tcbbo_trades` 用于 TCBBO 成交。

已知值时，可选的 `instrument_id` 和 `price_precision` 参数可绕过符号体系或精度查找。
K 线加载器还接受 `timestamp_on_close`。

:::tip
请先加载金融工具定义，再加载市场数据。目录必须先有金融工具，才能写入该金融工具的记录。
:::

## 实时客户端架构

`DatabentoDataClient` 包装其他 Databento 适配器类。每个数据集使用两个 `DatabentoLiveClient` 实例：

- 一个用于 MBO（订单簿增量）实时数据馈送
- 一个用于所有其他实时数据馈送

:::warning
请在节点启动时创建某数据集的所有 MBO 订阅，以便从会话开始重放。客户端会将启动后的订阅记录为错误并忽略。

此限制不适用于其他数据模式。
:::

单个 `DatabentoHistoricalClient` 同时服务于 `DatabentoInstrumentProvider` 和 `DatabentoDataClient`
的历史请求。

## 配置

从适配器的公共 Python 模块创建 `DatabentoLiveClientConfig`。API 密钥和 `publishers.json` 路径为必填：

```python
import os
from pathlib import Path

from vibe_trader.adapters.databento import DatabentoLiveClientConfig


config = DatabentoLiveClientConfig(
    api_key=os.environ["DATABENTO_API_KEY"],
    publishers_filepath=Path("publishers.json"),
    use_exchange_as_venue=False,
)
```

下载规范的
[`publishers.json`](https://github.com/qOeOp/trade/blob/main/crates/adapters/databento/publishers.json)，
并让 `publishers_filepath` 指向本地副本。

| 选项                      | 默认值  | 说明                                      |
| ------------------------- | ------- | ----------------------------------------- |
| `api_key`                 | 必填    | Databento API 密钥。                      |
| `publishers_filepath`     | 必填    | Databento 发布方元数据的本地路径。        |
| `use_exchange_as_venue`   | `False` | 对 GLBX 金融工具使用交易所 MIC 交易场所。 |
| `bars_timestamp_on_close` | `True`  | 使用 K 线收盘而非周期开盘时间戳。         |
| `venue_dataset_map`       | `None`  | 覆盖发布方数据中的交易场所到数据集映射。  |

将 `DatabentoLiveClientConfig` 与 `DatabentoDataClientFactory` 搭配使用。当前
[Python 示例](https://github.com/qOeOp/trade/blob/main/examples/live/databento/data_tester.py)展示了完整的
`LiveNode.builder(...)` 配置。

### 连接稳定性

以下情况下，实时客户端会自动重连：

- **网络中断**：临时连接问题。
- **网关重启**：Databento 按计划重启实时网关。请参阅
  [维护计划](https://databento.com/docs/api-reference-live/basics#maintenance-schedule)。
- **市场收盘**：非交易时间的会话结束。

#### 重连策略

由工厂支持的实时客户端使用内部 10 分钟重连窗口，并采用最长 60 秒的指数退避。
`DatabentoLiveClientConfig` 不公开重连超时。

所有重连均包括：

- **抖动**：最长 1 秒的随机延迟，防止同时发生重连风暴。
- **自动重新订阅**：重连后恢复所有活动订阅。
- **周期重置**：每次成功会话（超过 60 秒）都会重置超时时钟。

Databento 实时会话不支持细粒度取消订阅，因此单独的取消订阅请求会记录警告并被忽略。
请停止会话，以从实时网关移除订阅。

#### 计划维护

Databento 按以下时间表重启实时网关（所有客户端都会断开）：

| 数据集            | 重启时间       |
| ----------------- | -------------- |
| CME Globex        | 周六 02:15 CT  |
| 所有 ICE 交易场所 | 周日 09:45 UTC |
| 所有其他数据集    | 周日 10:30 UTC |

内部 10 分钟超时足以覆盖典型重启。详情请参阅
[Databento 维护计划](https://databento.com/docs/api-reference-live/basics/maintenance-schedule)。

## 贡献

:::info
要贡献代码，请参阅
[贡献指南](https://github.com/qOeOp/trade/blob/main/CONTRIBUTING.md)。
:::
