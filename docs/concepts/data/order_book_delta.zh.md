# OrderBookDelta

`OrderBookDelta` 表示订单簿的一次变更。它是粒度最细的内置订单簿数据类型，
支持 VibeTrader 用于增量更新的以下订单簿类型：

- `L3_MBO`：三级逐笔委托（MBO）数据。
- `L2_MBP`：二级逐价（MBP）数据。
- `L1_MBP`：一级逐价（MBP）最优报价数据。

源数据流和目标 `BookType` 决定增量数据采用哪种粒度。

当交易场所或数据提供商发布增量订单簿变更，而 Vibe 需要在本地维护订单簿状态时，
请使用此类型。

## 字段

| 字段            | Rust 类型      | Python 类型    | 必填/默认值 | 说明                                   |
| --------------- | -------------- | -------------- | ----------- | -------------------------------------- |
| `instrument_id` | `InstrumentId` | `InstrumentId` | 必填        | 订单簿发生变更的金融工具。             |
| `action`        | `BookAction`   | `BookAction`   | 必填        | `ADD`、`UPDATE`、`DELETE` 或 `CLEAR`。 |
| `order`         | `BookOrder`    | `BookOrder`    | 必填        | 价格、数量、方向及订单 ID 载荷。       |
| `flags`         | `u8`           | `int`          | 必填        | 表示事件元数据的 `RecordFlag` 位字段。 |
| `sequence`      | `u64`          | `int`          | 必填        | 交易场所序列号；若不存在则为零。       |
| `ts_event`      | `UnixNanos`    | `int`          | 必填        | 事件时间戳，单位为纳秒。               |
| `ts_init`       | `UnixNanos`    | `int`          | 必填        | 初始化时间戳，单位为纳秒。             |

## BookOrder 字段

`order` 字段包含该增量数据的 `BookOrder` 载荷。

| 字段       | Rust 类型         | Python 类型 | 说明                    |
| ---------- | ----------------- | ----------- | ----------------------- |
| `side`     | `OrderSide`       | `OrderSide` | 订单方向。              |
| `price`    | `Price`           | `Price`     | 订单价格。              |
| `size`     | `Quantity`        | `Quantity`  | 订单数量。              |
| `order_id` | `OrderId` (`u64`) | `int`       | 源数据流携带的订单 ID。 |

空值/默认订单使用 `NO_ORDER_SIDE`，价格和数量均为零，且 `order_id` 为零。

## BookAction 变体

| Rust 变体            | Python 变体 | 值  | 含义                     |
| -------------------- | ----------- | --- | ------------------------ |
| `BookAction::Add`    | `ADD`       | `1` | 向订单簿添加订单。       |
| `BookAction::Update` | `UPDATE`    | `2` | 更新订单簿中的现有订单。 |
| `BookAction::Delete` | `DELETE`    | `3` | 删除订单簿中的现有订单。 |
| `BookAction::Clear`  | `CLEAR`     | `4` | 清空订单簿状态。         |

## 行为

- `ADD` 和 `UPDATE` 增量数据要求订单数量为正数。
- `CLEAR` 增量数据会重置订单簿状态，并使用空订单簿订单。
- `flags` 携带事件边界和快照元数据。请参阅
  [增量标志与事件边界](index.md#delta-flags-and-event-boundaries)。
- Rust 提供 `OrderBookDelta::clear(...)`；Python 用户使用 `BookAction.CLEAR`
  和空值或默认订单簿订单来构造清空增量数据。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    data::{BookOrder, OrderBookDelta},
    enums::{BookAction, OrderSide, RecordFlag},
    identifiers::InstrumentId,
    types::{Price, Quantity},
};

let delta = OrderBookDelta::new(
    InstrumentId::from("ETHUSDT-PERP.BINANCE"),
    BookAction::Add,
    BookOrder::new(
        OrderSide::Buy,
        Price::from("2500.10"),
        Quantity::from("3.5"),
        12_345,
    ),
    RecordFlag::F_LAST as u8,
    42,
    UnixNanos::from(1_000_000_000),
    UnixNanos::from(1_000_000_100),
);
```

```python tab="Python"
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model.data import BookOrder
from vibe_trader.model.data import OrderBookDelta
from vibe_trader.model.enums import BookAction
from vibe_trader.model.enums import OrderSide
from vibe_trader.model.enums import RecordFlag

delta = OrderBookDelta(
    instrument_id=InstrumentId.from_str("ETHUSDT-PERP.BINANCE"),
    action=BookAction.ADD,
    order=BookOrder(
        OrderSide.BUY,
        Price.from_str("2500.10"),
        Quantity.from_str("3.5"),
        12_345,
    ),
    flags=RecordFlag.F_LAST,
    sequence=42,
    ts_event=1_000_000_000,
    ts_init=1_000_000_100,
)
```

## 相关指南

- [OrderBookDeltas](order_book_deltas.md) 介绍如何批量处理增量数据。
- [订单簿](../order_book.md) 说明订单簿类型和本地订单簿状态。
- [Python API 参考](/docs/python-api-latest/model/data.html) 列出了 Python 成员。
