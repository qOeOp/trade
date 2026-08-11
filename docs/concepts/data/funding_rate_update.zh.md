# FundingRateUpdate

`FundingRateUpdate` 表示永续合约金融工具的资金费率。当交易场所发布相关信息时，它还可以包含资金费间隔和下一次资金费时间戳。

## 字段

| 字段              | Rust 类型           | Python 类型    | 必填/默认值 | 说明                             |
| ----------------- | ------------------- | -------------- | ----------- | -------------------------------- |
| `instrument_id`   | `InstrumentId`      | `InstrumentId` | 必填        | 该费率对应的永续合约金融工具。   |
| `rate`            | `Decimal`           | `Decimal`      | 必填        | 当前资金费率。                   |
| `interval`        | `Option<u16>`       | `int \| None`  | `None`      | 资金费间隔，单位为分钟。         |
| `next_funding_ns` | `Option<UnixNanos>` | `int \| None`  | `None`      | 下一次资金费时间戳，单位为纳秒。 |
| `ts_event`        | `UnixNanos`         | `int`          | 必填        | 事件时间戳，单位为纳秒。         |
| `ts_init`         | `UnixNanos`         | `int`          | 必填        | 初始化时间戳，单位为纳秒。       |

## 行为

- 相等性比较和哈希使用金融工具 ID、费率、间隔和下一次资金费时间。
- 资金费率是参考数据，并不表示已经应用了资金费支付。
- 仅当交易场所发布 `interval` 和 `next_funding_ns` 时才使用它们。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{data::FundingRateUpdate, identifiers::InstrumentId};
use rust_decimal::Decimal;

let funding = FundingRateUpdate::new(
    InstrumentId::from("BTCUSDT-PERP.BINANCE"),
    Decimal::new(1, 4),
    Some(480),
    Some(UnixNanos::from(1_000_008_000)),
    UnixNanos::from(1_000_000_000),
    UnixNanos::from(1_000_000_100),
);
```

```python tab="Python"
from decimal import Decimal

from vibe_trader.model import FundingRateUpdate
from vibe_trader.model import InstrumentId

funding = FundingRateUpdate(
    instrument_id=InstrumentId.from_str("BTCUSDT-PERP.BINANCE"),
    rate=Decimal("0.0001"),
    ts_event=1_000_000_000,
    ts_init=1_000_000_100,
    interval=480,
    next_funding_ns=1_000_008_000,
)
```

## 相关指南

- [MarkPriceUpdate](mark_price_update.md)介绍衍生品的标记价格。
- [IndexPriceUpdate](index_price_update.md)介绍指数参考价格。
- [Python API 参考](/docs/python-api-latest/model/data.html)列出 Python 成员。
