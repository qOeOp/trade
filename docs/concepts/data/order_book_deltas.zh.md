# OrderBookDeltas

`OrderBookDeltas` 将一个逻辑订单簿事件中非空的一批 `OrderBookDelta` 记录组合在一起。当适配器一次接收或生成多项变更时，它可以减少单条消息的开销。

## 字段

| 字段            | Rust 类型             | Python 类型            | 必填/默认值  | 说明                       |
| --------------- | --------------------- | ---------------------- | ------------ | -------------------------- |
| `instrument_id` | `InstrumentId`        | `InstrumentId`         | 必填         | 订单簿发生变化的金融工具。 |
| `deltas`        | `Vec<OrderBookDelta>` | `list[OrderBookDelta]` | 必填         | 非空的增量批次。           |
| `flags`         | `u8`                  | `int`                  | 来自末条增量 | 末条增量的标志。           |
| `sequence`      | `u64`                 | `int`                  | 来自末条增量 | 末条增量的序列号。         |
| `ts_event`      | `UnixNanos`           | `int`                  | 来自末条增量 | 末条增量的事件时间戳。     |
| `ts_init`       | `UnixNanos`           | `int`                  | 来自末条增量 | 末条增量的初始化时间戳。   |

## 行为

- 批次必须至少包含一条增量。
- 批次元数据与最后一条增量保持一致。
- 最后一条增量结束一个逻辑事件组时，应携带 `F_LAST`。
- 快照批次通常以 `CLEAR` 增量开始，并以 `F_SNAPSHOT | F_LAST` 结束。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    data::{BookOrder, OrderBookDelta, OrderBookDeltas},
    enums::{BookAction, OrderSide, RecordFlag},
    identifiers::InstrumentId,
    types::{Price, Quantity},
};

let instrument_id = InstrumentId::from("ETHUSDT-PERP.BINANCE");
let bid = OrderBookDelta::new(
    instrument_id,
    BookAction::Add,
    BookOrder::new(OrderSide::Buy, Price::from("2500.10"), Quantity::from("3.5"), 1),
    0,
    41,
    UnixNanos::from(1_000_000_000),
    UnixNanos::from(1_000_000_100),
);
let ask = OrderBookDelta::new(
    instrument_id,
    BookAction::Add,
    BookOrder::new(OrderSide::Sell, Price::from("2500.20"), Quantity::from("2.0"), 2),
    RecordFlag::F_LAST as u8,
    42,
    UnixNanos::from(1_000_000_000),
    UnixNanos::from(1_000_000_100),
);

let deltas = OrderBookDeltas::new(instrument_id, vec![bid, ask]);
```

```python tab="Python"
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model.data import BookOrder
from vibe_trader.model.data import OrderBookDelta
from vibe_trader.model.data import OrderBookDeltas
from vibe_trader.model.enums import BookAction
from vibe_trader.model.enums import OrderSide
from vibe_trader.model.enums import RecordFlag

instrument_id = InstrumentId.from_str("ETHUSDT-PERP.BINANCE")
bid = OrderBookDelta(
    instrument_id=instrument_id,
    action=BookAction.ADD,
    order=BookOrder(
        OrderSide.BUY,
        Price.from_str("2500.10"),
        Quantity.from_str("3.5"),
        1,
    ),
    flags=0,
    sequence=41,
    ts_event=1_000_000_000,
    ts_init=1_000_000_100,
)
ask = OrderBookDelta(
    instrument_id=instrument_id,
    action=BookAction.ADD,
    order=BookOrder(
        OrderSide.SELL,
        Price.from_str("2500.20"),
        Quantity.from_str("2.0"),
        2,
    ),
    flags=RecordFlag.F_LAST,
    sequence=42,
    ts_event=1_000_000_000,
    ts_init=1_000_000_100,
)

deltas = OrderBookDeltas(instrument_id, [bid, ask])
```

## 相关指南

- [OrderBookDelta](order_book_delta.md)介绍批次中包含的更新类型。
- [订单簿](../order_book.md)解释支持的订单簿状态。
- [Python API 参考](/docs/python-api-latest/model/data.html)列出 Python 成员。
