# QuoteTick

`QuoteTick` 表示某一金融工具订单簿顶部的买价和卖价，包含特定事件时刻可用的最优买卖价格和数量。

## 字段

| 字段            | Rust 类型      | Python 类型    | 必填/默认值 | 说明                       |
| --------------- | -------------- | -------------- | ----------- | -------------------------- |
| `instrument_id` | `InstrumentId` | `InstrumentId` | 必填        | 报价对应的金融工具。       |
| `bid_price`     | `Price`        | `Price`        | 必填        | 最优买价。                 |
| `ask_price`     | `Price`        | `Price`        | 必填        | 最优卖价。                 |
| `bid_size`      | `Quantity`     | `Quantity`     | 必填        | 最优买价处的可用数量。     |
| `ask_size`      | `Quantity`     | `Quantity`     | 必填        | 最优卖价处的可用数量。     |
| `ts_event`      | `UnixNanos`    | `int`          | 必填        | 事件时间戳，单位为纳秒。   |
| `ts_init`       | `UnixNanos`    | `int`          | 必填        | 初始化时间戳，单位为纳秒。 |

## 行为

- 买价和卖价必须使用相同的精度。
- 买量和卖量必须使用相同的精度。
- `extract_price(PriceType.BID | ASK | MID)` 返回请求的价格基准。
- 报价 K 线可以使用 `BID`、`ASK` 或 `MID` 价格类型。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    data::QuoteTick,
    identifiers::InstrumentId,
    types::{Price, Quantity},
};

let quote = QuoteTick::new(
    InstrumentId::from("AUD/USD.SIM"),
    Price::from("0.65000"),
    Price::from("0.65002"),
    Quantity::from("1000000"),
    Quantity::from("1200000"),
    UnixNanos::from(1_000_000_000),
    UnixNanos::from(1_000_000_100),
);
```

```python tab="Python"
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model import QuoteTick

quote = QuoteTick(
    instrument_id=InstrumentId.from_str("AUD/USD.SIM"),
    bid_price=Price.from_str("0.65000"),
    ask_price=Price.from_str("0.65002"),
    bid_size=Quantity.from_int(1_000_000),
    ask_size=Quantity.from_int(1_200_000),
    ts_event=1_000_000_000,
    ts_init=1_000_000_100,
)
```

## 相关指南

- [OrderBookDepth10](order_book_depth10.md)介绍包含顶部档位的固定深度快照。
- [K 线与聚合](index.md#bars-and-aggregation)介绍报价到 K 线的聚合。
- [Python API 参考](/docs/python-api-latest/model/data.html)列出 Python 成员。
