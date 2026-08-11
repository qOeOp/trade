# TradeTick

`TradeTick` 表示交易场所的一次已执行成交或撮合事件，包含成交价格、数量、主动方方向和交易场所成交标识符。

## 字段

| 字段             | Rust 类型       | Python 类型     | 必填/默认值 | 说明                       |
| ---------------- | --------------- | --------------- | ----------- | -------------------------- |
| `instrument_id`  | `InstrumentId`  | `InstrumentId`  | 必填        | 成交对应的金融工具。       |
| `price`          | `Price`         | `Price`         | 必填        | 成交价格。                 |
| `size`           | `Quantity`      | `Quantity`      | 必填        | 成交数量。                 |
| `aggressor_side` | `AggressorSide` | `AggressorSide` | 必填        | 买方、卖方或无主动方。     |
| `trade_id`       | `TradeId`       | `TradeId`       | 必填        | 交易场所分配的撮合 ID。    |
| `ts_event`       | `UnixNanos`     | `int`           | 必填        | 事件时间戳，单位为纳秒。   |
| `ts_init`        | `UnixNanos`     | `int`           | 必填        | 初始化时间戳，单位为纳秒。 |

## 行为

- `size` 必须为正数。
- 信息驱动型 K 线需要 `TradeTick` 数据，因为它们使用 `aggressor_side`。
- 成交 K 线使用 `LAST` 价格类型。
- 交易场所提供 `trade_id` 时，该值对于相应交易场所事件应保持稳定。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    data::TradeTick,
    enums::AggressorSide,
    identifiers::{InstrumentId, TradeId},
    types::{Price, Quantity},
};

let trade = TradeTick::new(
    InstrumentId::from("BTCUSDT.BINANCE"),
    Price::from("65000.10"),
    Quantity::from("0.25"),
    AggressorSide::Buyer,
    TradeId::from("123456789"),
    UnixNanos::from(1_000_000_000),
    UnixNanos::from(1_000_000_100),
);
```

```python tab="Python"
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model import TradeId
from vibe_trader.model import TradeTick
from vibe_trader.model.enums import AggressorSide

trade = TradeTick(
    instrument_id=InstrumentId.from_str("BTCUSDT.BINANCE"),
    price=Price.from_str("65000.10"),
    size=Quantity.from_str("0.25"),
    aggressor_side=AggressorSide.BUYER,
    trade_id=TradeId("123456789"),
    ts_event=1_000_000_000,
    ts_init=1_000_000_100,
)
```

## 相关指南

- [Bar](bar.md)介绍成交到 K 线的聚合。
- [信息驱动型 K 线](index.md#information-driven-bars)解释主动方方向的用途。
- [Python API 参考](/docs/python-api-latest/model/data.html)列出 Python 成员。
