# OrderBookDepth10

`OrderBookDepth10` 表示固定深度的订单簿更新，最多包含 10 档买价和 10 档卖价。
当交易场所发布自包含的深度快照而非增量数据时，请使用此类型。

## 字段

| 字段            | Rust 类型         | Python 类型       | 必填/默认值 | 说明                                   |
| --------------- | ----------------- | ----------------- | ----------- | -------------------------------------- |
| `instrument_id` | `InstrumentId`    | `InstrumentId`    | 必填        | 此订单簿所表示的金融工具。             |
| `bids`          | `[BookOrder; 10]` | `list[BookOrder]` | 必填        | 恰好 10 档买价。                       |
| `asks`          | `[BookOrder; 10]` | `list[BookOrder]` | 必填        | 恰好 10 档卖价。                       |
| `bid_counts`    | `[u32; 10]`       | `list[int]`       | 必填        | 各买价档位的订单数。                   |
| `ask_counts`    | `[u32; 10]`       | `list[int]`       | 必填        | 各卖价档位的订单数。                   |
| `flags`         | `u8`              | `int`             | 必填        | 表示事件元数据的 `RecordFlag` 位字段。 |
| `sequence`      | `u64`             | `int`             | 必填        | 交易场所序列号；若不存在则为零。       |
| `ts_event`      | `UnixNanos`       | `int`             | 必填        | 事件时间戳，单位为纳秒。               |
| `ts_init`       | `UnixNanos`       | `int`             | 必填        | 初始化时间戳，单位为纳秒。             |

## 行为

- Rust 和 PyO3 Python 构造函数要求恰好包含 10 档买价、10 档卖价、
  10 个买方订单计数以及 10 个卖方订单计数。
- 对不可用档位使用空值或默认订单簿订单，并将计数设为零。
- 此类型不能与增量 `OrderBookDelta` 数据流互换使用。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    data::{BookOrder, OrderBookDepth10, DEPTH10_LEN},
    enums::OrderSide,
    identifiers::InstrumentId,
    types::{Price, Quantity},
};

let mut bids = [BookOrder::default(); DEPTH10_LEN];
let mut asks = [BookOrder::default(); DEPTH10_LEN];
bids[0] = BookOrder::new(OrderSide::Buy, Price::from("2500.10"), Quantity::from("3.5"), 1);
asks[0] = BookOrder::new(OrderSide::Sell, Price::from("2500.20"), Quantity::from("2.0"), 2);

let depth = OrderBookDepth10::new(
    InstrumentId::from("ETHUSDT-PERP.BINANCE"),
    bids,
    asks,
    [1; DEPTH10_LEN],
    [1; DEPTH10_LEN],
    0,
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
from vibe_trader.model.data import OrderBookDepth10
from vibe_trader.model.enums import OrderSide

bids = [
    BookOrder(
        OrderSide.BUY,
        Price.from_str(f"{2500.10 - i * 0.10:.2f}"),
        Quantity.from_str("3.5"),
        i + 1,
    )
    for i in range(10)
]
asks = [
    BookOrder(
        OrderSide.SELL,
        Price.from_str(f"{2500.20 + i * 0.10:.2f}"),
        Quantity.from_str("2.0"),
        i + 11,
    )
    for i in range(10)
]

depth = OrderBookDepth10(
    instrument_id=InstrumentId.from_str("ETHUSDT-PERP.BINANCE"),
    bids=bids,
    asks=asks,
    bid_counts=[1] * 10,
    ask_counts=[1] * 10,
    flags=0,
    sequence=42,
    ts_event=1_000_000_000,
    ts_init=1_000_000_100,
)
```

## 相关指南

- [QuoteTick](quote_tick.md) 介绍从深度数据派生的最优报价数据。
- [订单簿](index.md#order-books) 说明订单簿状态。
- [Python API 参考](/docs/python-api-latest/model/data.html) 列出了 Python 成员。
