# 数据测试规范

本节定义使用 Rust `DataTester` Actor 验证适配器数据功能的严格测试矩阵。Python 将其作为内置 Actor
暴露，通过 `vibe_trader.testkit.DataTesterConfig` 配置；Rust 代码从 `vibe_testkit::testers` 导入。
每个测试用例都用带前缀的 ID（例如 TC-D01）标识，并按功能分组。

**每个适配器都必须通过与其支持的数据类型相匹配的测试子集。**

测试组从派生程度最低的数据排到最高：先测试交易工具和原始订单簿数据，再测试报价、成交、K 线和
衍生品数据。通过第 1-4 组的适配器被视为符合数据基线。

适配器特有的数据行为（自定义通道、限流、快照语义等）应记录在适配器自己的指南中，而不是此处。

## 前置条件

运行数据测试前：

- 目标交易工具可用，并可通过交易工具 provider 加载。
- 当场所要求对被测试数据进行身份验证时，已通过环境变量（`{VENUE}_API_KEY`、
  `{VENUE}_API_SECRET`）设置 API 凭证。
- 如果场所提供 demo/testnet 模式，使用为该环境创建的凭证。Demo 和生产 API key 通常相互独立，
  无法互换；使用错误凭证会产生身份验证错误（例如 HTTP 401）。

**Python 节点设置**：

旧示例仍使用 `vibe_trader.live.node.TradingNode`，但当前以 Rust 为后端的 PyO3 适配器使用
`vibe_trader.live.LiveNode`。需要在节点构建前注册适配器客户端 factory 时，使用
`LiveNode.builder(...)`。

```python
from vibe_trader.common import Environment
from vibe_trader.config import LiveDataEngineConfig
from vibe_trader.live import LiveNode
from vibe_trader.model import TraderId
from vibe_trader.testkit import DataTesterConfig

node = (
    LiveNode.builder("TESTER-001", TraderId("TESTER-001"), Environment.SANDBOX)
    .with_data_engine_config(LiveDataEngineConfig(time_bars_build_with_no_updates=False))
    .add_data_client(None, adapter_data_client_factory, data_client_config)
    .build()
)

tester_config = DataTesterConfig(
    client_id=client_id,
    instrument_ids=[instrument_id],
    subscribe_quotes=True,
)
node.add_builtin_actor("DataTester", tester_config)
# Register remaining components, then start or run
```

**Rust 节点设置**（参考：`crates/adapters/{adapter}/examples/node_data_tester.rs`）：

```rust
use vibe_testkit::testers::{DataTester, DataTesterConfig};

let tester_config = DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_quotes(true)
    .build()?;
let tester = DataTester::new(tester_config);
node.add_actor(tester)?;
node.run().await?;
```

下方每组以摘要表格开始，后接详细测试卡。测试 ID 使用留有间隔的编号，以便插入新用例而无需重新编号。

---

## 第 1 组：交易工具

测试市场数据流前，先验证交易工具加载与订阅。

| TC     | 名称             | 描述                         | 跳过条件             |
| ------ | ---------------- | ---------------------------- | -------------------- |
| TC-D01 | 请求交易工具     | 加载一个场所的全部交易工具。 | 永不跳过。           |
| TC-D02 | 订阅交易工具     | 订阅交易工具更新。           | 不支持交易工具订阅。 |
| TC-D03 | 加载指定交易工具 | 按 ID 加载单个交易工具。     | 永不跳过。           |

### TC-D01：请求交易工具

| 字段         | 值                                                             |
| ------------ | -------------------------------------------------------------- |
| **前置条件** | 适配器已连接。                                                 |
| **操作**     | DataTester 启动时请求该场所的所有交易工具。                    |
| **事件序列** | `on_instruments` callback 接收交易工具列表。                   |
| **通过标准** | 至少收到一个交易工具；每个都具有有效代码、价格精度和数量增量。 |
| **跳过条件** | 永不跳过。                                                     |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    request_instruments=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .request_instruments(true)
    .build()?
```

### TC-D02：订阅交易工具

| 字段         | 值                                                    |
| ------------ | ----------------------------------------------------- |
| **前置条件** | 适配器已连接，交易工具已加载。                        |
| **操作**     | DataTester 订阅交易工具更新。                         |
| **事件序列** | `on_instrument` callback 接收交易工具。               |
| **通过标准** | 收到的交易工具具有正确的 `instrument_id` 和有效字段。 |
| **跳过条件** | 适配器不支持交易工具订阅。                            |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    subscribe_instrument=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_instrument(true)
    .build()?
```

### TC-D03：加载指定交易工具

| 字段         | 值                                                          |
| ------------ | ----------------------------------------------------------- |
| **前置条件** | 适配器已连接。                                              |
| **操作**     | 通过交易工具 provider，按 `InstrumentId` 加载指定交易工具。 |
| **事件序列** | 加载完成后，缓存中可以访问该交易工具。                      |
| **通过标准** | 已加载交易工具具有正确 ID、价格精度、数量增量和交易规则。   |
| **跳过条件** | 永不跳过。                                                  |

**注意事项：**

- 该用例直接测试交易工具 provider 的 `load` / `load_async` 方法。
- 验证交易工具已缓存，并可通过 `self.cache.instrument(instrument_id)` 访问。

---

## 第 2 组：订单簿

测试订单簿订阅模式和快照请求。

| TC     | 名称             | 描述                              | 跳过条件           |
| ------ | ---------------- | --------------------------------- | ------------------ |
| TC-D10 | 订阅订单簿增量   | 流式接收 `OrderBookDeltas` 更新。 | 不支持订单簿。     |
| TC-D11 | 按间隔订阅订单簿 | 定期接收 `OrderBook` 快照。       | 不支持订单簿。     |
| TC-D12 | 订阅订单簿深度   | 接收 `OrderBookDepth10` 快照。    | 不支持订单簿深度。 |
| TC-D13 | 请求订单簿快照   | 一次性请求订单簿快照。            | 不支持订单簿快照。 |
| TC-D14 | 从增量维护订单簿 | 从增量流构建本地订单簿。          | 不支持订单簿。     |

这些场景的 Python 配置使用 `BookType.L2_MBP`。适配器需要不同订单簿表示时，Rust builder 可以覆盖
`book_type`。

### TC-D10：订阅订单簿增量

| 字段         | 值                                                             |
| ------------ | -------------------------------------------------------------- |
| **前置条件** | 适配器已连接，交易工具已加载。                                 |
| **操作**     | DataTester 订阅订单簿增量。                                    |
| **事件序列** | 在 `on_book_deltas` 中收到 `OrderBookDeltas` 事件。            |
| **通过标准** | 收到的增量具有有效交易工具 ID；至少一个增量包含买价/卖价更新。 |
| **跳过条件** | 适配器不支持订单簿数据。                                       |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    subscribe_book_deltas=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_book_deltas(true)
    .book_type(BookType::L2_MBP)
    .build()?
```

### TC-D11：按间隔订阅订单簿

| 字段         | 值                                                         |
| ------------ | ---------------------------------------------------------- |
| **前置条件** | 适配器已连接，交易工具已加载。                             |
| **操作**     | DataTester 订阅定期订单簿快照。                            |
| **事件序列** | 按配置间隔在 `on_book` 中收到 `OrderBook` 事件。           |
| **通过标准** | 收到包含买卖盘档位的订单簿快照；更新大约按照配置间隔到达。 |
| **跳过条件** | 适配器不支持订单簿数据。                                   |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    subscribe_book_at_interval=True,
    book_depth=10,
    book_interval_ms=1000,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_book_at_interval(true)
    .book_type(BookType::L2_MBP)
    .book_depth(10)
    .book_interval_ms(1000)
    .build()?
```

### TC-D12：订阅订单簿深度

| 字段         | 值                                                  |
| ------------ | --------------------------------------------------- |
| **前置条件** | 适配器已连接，交易工具已加载。                      |
| **操作**     | DataTester 订阅 `OrderBookDepth10` 快照。           |
| **事件序列** | 在 `on_book_depth` 中收到 `OrderBookDepth10` 事件。 |
| **通过标准** | 收到最多包含 10 档买卖盘的深度快照；价格排序正确。  |
| **跳过条件** | 适配器不支持订单簿深度订阅。                        |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    subscribe_book_depth=True,
    book_depth=10,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_book_depth(true)
    .book_type(BookType::L2_MBP)
    .book_depth(10)
    .build()?
```

### TC-D13：请求订单簿快照

| 字段         | 值                                     |
| ------------ | -------------------------------------- |
| **前置条件** | 适配器已连接，交易工具已加载。         |
| **操作**     | DataTester 一次性请求订单簿快照。      |
| **事件序列** | 通过历史数据 callback 接收订单簿快照。 |
| **通过标准** | 快照包含价格和数量有效的买卖盘档位。   |
| **跳过条件** | 适配器不支持订单簿快照请求。           |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    request_book_snapshot=True,
    book_depth=10,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .request_book_snapshot(true)
    .book_depth(10)
    .build()?
```

### TC-D14：从增量维护订单簿

| 字段         | 值                                                                             |
| ------------ | ------------------------------------------------------------------------------ |
| **前置条件** | 适配器已连接，交易工具已加载，订单簿增量正在流入。                             |
| **操作**     | DataTester 使用 `manage_book=True` 订阅增量，并从增量流构建本地订单簿。        |
| **事件序列** | `OrderBookDeltas` 应用到本地 `OrderBook`；按配置深度记录订单簿。               |
| **通过标准** | 本地订单簿从增量正确构建；买盘档位降序、卖盘档位升序；初始快照后订单簿不为空。 |
| **跳过条件** | 适配器不支持订单簿数据。                                                       |

**注意事项：**

- 维护型订单簿会把每个增量应用到 Actor 持有的 `OrderBook` 实例。
- 使用 `book_levels_to_print` 控制日志详细程度。

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    subscribe_book_deltas=True,
    manage_book=True,
    book_levels_to_print=10,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_book_deltas(true)
    .manage_book(true)
    .book_type(BookType::L2_MBP)
    .build()?
```

`DataTesterConfig` 暴露了 `request_book_deltas`，但 `DataTester` 不会发出该历史请求。
在 tester 实现这条请求路径前，应通过自定义 Actor 测试适配器的历史订单簿增量支持。

---

## 第 3 组：报价

测试报价 tick 订阅和历史请求。

| TC     | 名称         | 描述                                | 跳过条件         |
| ------ | ------------ | ----------------------------------- | ---------------- |
| TC-D20 | 订阅报价     | 验证启动后有 `QuoteTick` 事件流入。 | 永不跳过。       |
| TC-D21 | 请求历史报价 | 请求历史报价 tick。                 | 不支持历史报价。 |

### TC-D20：订阅报价

| 字段         | 值                                                        |
| ------------ | --------------------------------------------------------- |
| **前置条件** | 适配器已连接，交易工具已加载。                            |
| **操作**     | DataTester 启动时订阅报价。                               |
| **事件序列** | 在 `on_quote` 中收到 `QuoteTick` 事件。                   |
| **通过标准** | 至少收到一个买卖价格和数量有效的 `QuoteTick`；bid < ask。 |
| **跳过条件** | 永不跳过。                                                |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    subscribe_quotes=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_quotes(true)
    .build()?
```

### TC-D21：请求历史报价

| 字段         | 值                                             |
| ------------ | ---------------------------------------------- |
| **前置条件** | 适配器已连接，交易工具已加载。                 |
| **操作**     | DataTester 请求历史报价 tick。                 |
| **事件序列** | 通过 `on_historical_quotes` 接收历史报价批次。 |
| **通过标准** | 收到的报价具有有效时间戳、买卖价格和数量。     |
| **跳过条件** | 适配器不支持历史报价请求。                     |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    request_quotes=True,
)
```

---

## 第 4 组：成交

测试成交 tick 订阅和历史请求。

| TC     | 名称         | 描述                                | 跳过条件         |
| ------ | ------------ | ----------------------------------- | ---------------- |
| TC-D30 | 订阅成交     | 验证启动后有 `TradeTick` 事件流入。 | 永不跳过。       |
| TC-D31 | 请求历史成交 | 请求历史成交 tick。                 | 不支持历史成交。 |

### TC-D30：订阅成交

| 字段         | 值                                                 |
| ------------ | -------------------------------------------------- |
| **前置条件** | 适配器已连接，交易工具已加载。                     |
| **操作**     | DataTester 启动时订阅成交。                        |
| **事件序列** | 在 `on_trade` 中收到 `TradeTick` 事件。            |
| **通过标准** | 至少收到一个价格、数量和主动方有效的 `TradeTick`。 |
| **跳过条件** | 永不跳过。                                         |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    subscribe_trades=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_trades(true)
    .build()?
```

### TC-D31：请求历史成交

| 字段         | 值                                              |
| ------------ | ----------------------------------------------- |
| **前置条件** | 适配器已连接，交易工具已加载。                  |
| **操作**     | DataTester 请求历史成交 tick。                  |
| **事件序列** | 通过 `on_historical_trades` 接收历史成交批次。  |
| **通过标准** | 收到的成交具有有效时间戳、价格、数量和成交 ID。 |
| **跳过条件** | 适配器不支持历史成交请求。                      |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    request_trades=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .request_trades(true)
    .build()?
```

---

## 第 5 组：K 线

测试 K 线订阅和历史请求。

| TC     | 名称          | 描述                          | 跳过条件          |
| ------ | ------------- | ----------------------------- | ----------------- |
| TC-D40 | 订阅 K 线     | 验证启动后有 `Bar` 事件流入。 | 不支持 K 线。     |
| TC-D41 | 请求历史 K 线 | 请求历史 OHLCV K 线。         | 不支持历史 K 线。 |

### TC-D40：订阅 K 线

| 字段         | 值                                                                          |
| ------------ | --------------------------------------------------------------------------- |
| **前置条件** | 适配器已连接，交易工具已加载，K 线类型已配置。                              |
| **操作**     | DataTester 订阅已配置 `BarType` 的 K 线。                                   |
| **事件序列** | 在 `on_bar` 中收到 `Bar` 事件。                                             |
| **通过标准** | 至少收到一个 OHLCV 有效的 `Bar`；high >= low、high >= open、high >= close。 |
| **跳过条件** | 适配器不支持 K 线订阅。                                                     |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    bar_types=[BarType.from_str("BTCUSDT-PERP.VENUE-1-MINUTE-LAST-EXTERNAL")],
    subscribe_bars=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .bar_types(vec![bar_type])
    .subscribe_bars(true)
    .build()?
```

### TC-D41：请求历史 K 线

| 字段         | 值                                             |
| ------------ | ---------------------------------------------- |
| **前置条件** | 适配器已连接，交易工具已加载，K 线类型已配置。 |
| **操作**     | DataTester 请求已配置 `BarType` 的历史 K 线。  |
| **事件序列** | 通过 callback 接收历史 K 线。                  |
| **通过标准** | 收到的 K 线具有有效 OHLCV 值和升序时间戳。     |
| **跳过条件** | 适配器不支持历史 K 线请求。                    |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    bar_types=[BarType.from_str("BTCUSDT-PERP.VENUE-1-MINUTE-LAST-EXTERNAL")],
    request_bars=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .bar_types(vec![bar_type])
    .request_bars(true)
    .build()?
```

---

## 第 6 组：衍生品数据

测试衍生品特有的数据流：标记价格、指数价格和资金费率。

| TC     | 名称             | 描述                       | 跳过条件       |
| ------ | ---------------- | -------------------------- | -------------- |
| TC-D50 | 订阅标记价格     | `MarkPriceUpdate` 事件。   | 不是衍生品。   |
| TC-D51 | 订阅指数价格     | `IndexPriceUpdate` 事件。  | 不是衍生品。   |
| TC-D52 | 订阅资金费率     | `FundingRateUpdate` 事件。 | 不是永续合约。 |
| TC-D53 | 请求历史资金费率 | 历史资金费率数据。         | 不是永续合约。 |

### TC-D50：订阅标记价格

| 字段         | 值                                                           |
| ------------ | ------------------------------------------------------------ |
| **前置条件** | 适配器已连接，衍生品交易工具已加载。                         |
| **操作**     | DataTester 订阅标记价格更新。                                |
| **事件序列** | 在 `on_mark_price` 中收到 `MarkPriceUpdate` 事件。           |
| **通过标准** | 至少收到一个交易工具 ID 和标记价格有效的 `MarkPriceUpdate`。 |
| **跳过条件** | 交易工具不是衍生品，或适配器不提供标记价格。                 |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    subscribe_mark_prices=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_mark_prices(true)
    .build()?
```

### TC-D51：订阅指数价格

| 字段         | 值                                                            |
| ------------ | ------------------------------------------------------------- |
| **前置条件** | 适配器已连接，衍生品交易工具已加载。                          |
| **操作**     | DataTester 订阅指数价格更新。                                 |
| **事件序列** | 在 `on_index_price` 中收到 `IndexPriceUpdate` 事件。          |
| **通过标准** | 至少收到一个交易工具 ID 和指数价格有效的 `IndexPriceUpdate`。 |
| **跳过条件** | 交易工具不是衍生品，或适配器不提供指数价格。                  |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    subscribe_index_prices=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_index_prices(true)
    .build()?
```

### TC-D52：订阅资金费率

| 字段         | 值                                                         |
| ------------ | ---------------------------------------------------------- |
| **前置条件** | 适配器已连接，永续合约交易工具已加载。                     |
| **操作**     | DataTester 订阅资金费率更新。                              |
| **事件序列** | 在 `on_funding_rate` 中收到 `FundingRateUpdate` 事件。     |
| **通过标准** | 至少收到一个交易工具 ID 和费率有效的 `FundingRateUpdate`。 |
| **跳过条件** | 交易工具不是永续合约，或适配器不提供资金费率。             |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    subscribe_funding_rates=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_funding_rates(true)
    .build()?
```

### TC-D53：请求历史资金费率

| 字段         | 值                                                     |
| ------------ | ------------------------------------------------------ |
| **前置条件** | 适配器已连接，永续合约交易工具已加载。                 |
| **操作**     | DataTester 请求历史资金费率（默认回看 7 天）。         |
| **事件序列** | 通过 callback 接收历史资金费率。                       |
| **通过标准** | 收到的资金费率具有有效时间戳和费率值。                 |
| **跳过条件** | 交易工具不是永续合约，或适配器不支持历史资金费率请求。 |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    request_funding_rates=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .request_funding_rates(true)
    .build()?
```

---

## 第 7 组：交易工具状态

测试交易工具状态和收盘事件订阅。

| TC     | 名称             | 描述                      | 跳过条件     |
| ------ | ---------------- | ------------------------- | ------------ |
| TC-D60 | 订阅交易工具状态 | `InstrumentStatus` 事件。 | 不支持状态。 |
| TC-D61 | 订阅交易工具收盘 | `InstrumentClose` 事件。  | 不支持收盘。 |

### TC-D60：订阅交易工具状态

| 字段         | 值                                                              |
| ------------ | --------------------------------------------------------------- |
| **前置条件** | 适配器已连接，交易工具已加载。                                  |
| **操作**     | DataTester 订阅交易工具状态更新。                               |
| **事件序列** | 在 `on_instrument_status` 中收到 `InstrumentStatus` 事件。      |
| **通过标准** | 收到具有有效 `MarketStatusAction`（例如 `Trading`）的状态事件。 |
| **跳过条件** | 适配器不支持交易工具状态订阅。                                  |

**注意事项：**

- 状态事件可能只在状态变化时触发（例如暂停交易 -> 恢复交易）。
- 正常交易时段内，订阅时可能收到 `Trading` 状态。

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    subscribe_instrument_status=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_instrument_status(true)
    .build()?
```

### TC-D61：订阅交易工具收盘

| 字段         | 值                                                       |
| ------------ | -------------------------------------------------------- |
| **前置条件** | 适配器已连接，交易工具已加载。                           |
| **操作**     | DataTester 订阅交易工具收盘事件。                        |
| **事件序列** | 在 `on_instrument_close` 中收到 `InstrumentClose` 事件。 |
| **通过标准** | 收到具有有效收盘价和收盘类型的收盘事件。                 |
| **跳过条件** | 适配器不支持交易工具收盘订阅。                           |

**注意事项：**

- 对于传统市场，收盘事件通常在交易时段结束时触发。
- 对于全天候加密货币场所，除非适配器合成每日收盘，否则可能不会触发。

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    subscribe_instrument_close=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_instrument_close(true)
    .build()?
```

---

## 第 8 组：期权 Greeks

测试期权 Greeks 和期权链订阅。

| TC     | 名称            | 描述                                 | 跳过条件        |
| ------ | --------------- | ------------------------------------ | --------------- |
| TC-D62 | 订阅期权 Greeks | 单个交易工具的 `OptionGreeks` 数据。 | 不支持 Greeks。 |
| TC-D63 | 订阅期权链      | 一个系列的 `OptionChainSlice` 快照。 | 不支持期权链。  |

### TC-D62：订阅期权 Greeks

| 字段         | 值                                                    |
| ------------ | ----------------------------------------------------- |
| **前置条件** | 适配器已连接，期权交易工具已加载。                    |
| **操作**     | DataTester 订阅期权 Greeks 更新。                     |
| **事件序列** | 在 `on_option_greeks` 中收到 `OptionGreeks` 事件。    |
| **通过标准** | 收到的 Greeks 具有有效 delta、gamma、vega、theta 值。 |
| **跳过条件** | 适配器不支持期权 Greeks 订阅。                        |

**注意事项：**

- Greeks 只适用于期权交易工具。
- 数值取决于场所定价模型，并且可能在每次报价变化时更新。
- 一些场所（Bybit、Deribit）按交易工具订阅；OKX 按交易工具家族订阅，再筛选到所请求的交易工具。
- 当场所不提供 `rho` 时（Bybit、OKX），其值可能为零。
- 根据场所通道，`underlying_price` 和 `open_interest` 可能为 `None`。

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    subscribe_option_greeks=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_option_greeks(true)
    .build()?
```

### TC-D63：订阅期权链

| 字段         | 值                                                    |
| ------------ | ----------------------------------------------------- |
| **前置条件** | 适配器已连接，该系列的期权交易工具已加载。            |
| **操作**     | DataTester 订阅一个系列的期权链快照。                 |
| **事件序列** | 在 `on_option_chain` 中收到 `OptionChainSlice` 快照。 |
| **通过标准** | 期权链快照包含与该系列相匹配交易工具的 Greeks。       |
| **跳过条件** | 适配器不支持期权链订阅。                              |

**注意事项：**

- 期权链订阅由 DataEngine 管理，它会在内部创建逐交易工具报价和 Greeks 订阅。
- 相对于 ATM 的行权价范围需要先引导得到远期价格，再开始订阅。
- 尚无法通过 `DataTesterConfig` 配置；需要使用 `subscribe_option_chain` 和 `OptionSeriesId`
  手动设置 Actor。

---

## 第 9 组：生命周期

测试 Actor 生命周期行为：取消订阅处理和自定义参数。

| TC     | 名称           | 描述                             | 跳过条件         |
| ------ | -------------- | -------------------------------- | ---------------- |
| TC-D70 | 停止时取消订阅 | Actor 停止时取消数据 feed 订阅。 | 不支持取消订阅。 |
| TC-D71 | 自定义订阅参数 | 适配器特有的订阅参数。           | 不适用。         |
| TC-D72 | 自定义请求参数 | 适配器特有的请求参数。           | 不适用。         |

### TC-D70：停止时取消订阅

| 字段         | 值                                                   |
| ------------ | ---------------------------------------------------- |
| **前置条件** | 存在活跃的数据订阅（报价、成交、订单簿）。           |
| **操作**     | 使用 `can_unsubscribe=True`（默认值）停止 Actor。    |
| **事件序列** | 数据订阅被移除；不再接收数据事件。                   |
| **通过标准** | 干净地取消订阅；日志中没有错误；停止后没有数据事件。 |
| **跳过条件** | 适配器不支持取消订阅。                               |

**Python 配置：**

```python
DataTesterConfig(
    instrument_ids=[instrument_id],
    subscribe_quotes=True,
    subscribe_trades=True,
    can_unsubscribe=True,
)
```

**Rust 配置：**

```rust
DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_quotes(true)
    .subscribe_trades(true)
    .can_unsubscribe(true)
    .build()?
```

### TC-D71：自定义订阅参数

| 字段         | 值                                         |
| ------------ | ------------------------------------------ |
| **前置条件** | 适配器已连接，并接受额外订阅参数。         |
| **操作**     | 使用适配器特有的 `subscribe_params` 订阅。 |
| **事件序列** | 订阅已建立，并应用自定义参数。             |
| **通过标准** | 数据流入时，适配器特有参数已生效。         |
| **跳过条件** | 不适用（适配器特有）。                     |

**Rust 配置：**

```rust
use vibe_core::Params;
use serde_json::json;

let mut subscribe_params = Params::new();
subscribe_params.insert("key".to_string(), json!("value"));

DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .subscribe_quotes(true)
    .subscribe_params(subscribe_params)
    .build()?
```

**注意事项：**

- `subscribe_params` 对 DataTester 不透明，会直接传递给适配器。
- Python `DataTesterConfig` 构造器不暴露这个仅 Rust 字段。
- 查阅适配器指南以了解受支持参数。

### TC-D72：自定义请求参数

| 字段         | 值                                           |
| ------------ | -------------------------------------------- |
| **前置条件** | 适配器已连接，并接受额外请求参数。           |
| **操作**     | 使用适配器特有的 `request_params` 请求数据。 |
| **事件序列** | 请求得到满足，并应用自定义参数。             |
| **通过标准** | 收到历史数据时，适配器特有参数已生效。       |
| **跳过条件** | 不适用（适配器特有）。                       |

**Rust 配置：**

```rust
use vibe_core::Params;
use serde_json::json;

let mut request_params = Params::new();
request_params.insert("key".to_string(), json!("value"));

DataTesterConfig::builder()
    .client_id(client_id)
    .instrument_ids(vec![instrument_id])
    .request_quotes(true)
    .request_params(request_params)
    .build()?
```

**注意事项：**

- `request_params` 对 DataTester 不透明，会直接传递给适配器。
- Python `DataTesterConfig` 构造器不暴露这个仅 Rust 字段。
- 查阅适配器指南以了解受支持参数。

---

## DataTester 配置参考

Python 构造器接受下列参数。默认值是构造完成后的解析值。历史报价、成交和 K 线请求使用一小时回看期；
资金费率请求使用七天。无法通过 `DataTesterConfig` 配置回看期。

| 参数                          | 类型                 | 默认值  | 影响组 |
| ----------------------------- | -------------------- | ------- | ------ |
| `actor_id`                    | `ActorId?`           | `None`  | 全部   |
| `client_id`                   | `ClientId?`          | `None`  | 全部   |
| `instrument_ids`              | `list[InstrumentId]` | `[]`    | 全部   |
| `bar_types`                   | `list[BarType]?`     | `None`  | 5      |
| `subscribe_book_deltas`       | `bool`               | `False` | 2      |
| `subscribe_book_depth`        | `bool`               | `False` | 2      |
| `subscribe_book_at_interval`  | `bool`               | `False` | 2      |
| `subscribe_quotes`            | `bool`               | `False` | 3      |
| `subscribe_trades`            | `bool`               | `False` | 4      |
| `subscribe_mark_prices`       | `bool`               | `False` | 6      |
| `subscribe_index_prices`      | `bool`               | `False` | 6      |
| `subscribe_funding_rates`     | `bool`               | `False` | 6      |
| `subscribe_bars`              | `bool`               | `False` | 5      |
| `subscribe_instrument`        | `bool`               | `False` | 1      |
| `subscribe_instrument_status` | `bool`               | `False` | 7      |
| `subscribe_instrument_close`  | `bool`               | `False` | 7      |
| `subscribe_option_greeks`     | `bool`               | `False` | 8      |
| `can_unsubscribe`             | `bool`               | `True`  | 9      |
| `request_instruments`         | `bool`               | `False` | 1      |
| `request_book_snapshot`       | `bool`               | `False` | 2      |
| `request_book_deltas`         | `bool`               | `False` | 未实现 |
| `request_quotes`              | `bool`               | `False` | 3      |
| `request_trades`              | `bool`               | `False` | 4      |
| `request_bars`                | `bool`               | `False` | 5      |
| `request_funding_rates`       | `bool`               | `False` | 6      |
| `book_depth`                  | `PositiveInt?`       | `None`  | 2      |
| `book_interval_ms`            | `PositiveInt`        | `1000`  | 2      |
| `book_levels_to_print`        | `PositiveInt`        | `10`    | 2      |
| `manage_book`                 | `bool`               | `True`  | 2      |
| `log_data`                    | `bool`               | `True`  | 全部   |
| `stats_interval_secs`         | `int`                | `5`     | 全部   |
| `log_events`                  | `bool`               | `True`  | 全部   |
| `log_commands`                | `bool`               | `True`  | 全部   |

Rust builder 还暴露以下参数：

| 参数               | 类型       | 默认值   | 影响组 |
| ------------------ | ---------- | -------- | ------ |
| `book_type`        | `BookType` | `L2_MBP` | 2      |
| `subscribe_params` | `Params?`  | `None`   | 9      |
| `request_params`   | `Params?`  | `None`   | 9      |

---
