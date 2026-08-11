# MarkPriceUpdate

`MarkPriceUpdate` 表示金融工具的标记价格。衍生品交易场所通常使用标记价格进行保证金计算、强平检查和未实现盈亏计算。

## 字段

| 字段            | Rust 类型      | Python 类型    | 必填/默认值 | 说明                       |
| --------------- | -------------- | -------------- | ----------- | -------------------------- |
| `instrument_id` | `InstrumentId` | `InstrumentId` | 必填        | 标记价格对应的金融工具。   |
| `value`         | `Price`        | `Price`        | 必填        | 当前标记价格。             |
| `ts_event`      | `UnixNanos`    | `int`          | 必填        | 事件时间戳，单位为纳秒。   |
| `ts_init`       | `UnixNanos`    | `int`          | 必填        | 初始化时间戳，单位为纳秒。 |

## 行为

- 收到标记价格后，会按金融工具缓存该价格。
- 对于将参考价格与成交数据分开发布的交易场所，回测可以输入标记价格，使保证金和盈亏行为与交易场所保持一致。
- 数据目录存储标记价格时会附带金融工具 ID 和价格精度元数据。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    data::MarkPriceUpdate,
    identifiers::InstrumentId,
    types::Price,
};

let mark = MarkPriceUpdate::new(
    InstrumentId::from("BTCUSDT-PERP.BINANCE"),
    Price::from("65000.10"),
    UnixNanos::from(1_000_000_000),
    UnixNanos::from(1_000_000_100),
);
```

```python tab="Python"
from vibe_trader.model import InstrumentId
from vibe_trader.model import MarkPriceUpdate
from vibe_trader.model import Price

mark = MarkPriceUpdate(
    instrument_id=InstrumentId.from_str("BTCUSDT-PERP.BINANCE"),
    value=Price.from_str("65000.10"),
    ts_event=1_000_000_000,
    ts_init=1_000_000_100,
)
```

## 相关指南

- [IndexPriceUpdate](index_price_update.md)介绍指数参考价格。
- [FundingRateUpdate](funding_rate_update.md)介绍永续合约资金费元数据。
- [Python API 参考](/docs/python-api-latest/model/data.html)列出 Python 成员。
