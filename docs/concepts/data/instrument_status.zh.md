# InstrumentStatus

`InstrumentStatus` 表示金融工具交易状态的变化。它记录交易场所发布的盘前、交易中、停牌、暂停、收盘以及卖空限制变化等状态事件。

## 字段

| 字段                       | Rust 类型            | Python 类型          | 必填/默认值 | 说明                                 |
| -------------------------- | -------------------- | -------------------- | ----------- | ------------------------------------ |
| `instrument_id`            | `InstrumentId`       | `InstrumentId`       | 必填        | 状态发生变化的金融工具。             |
| `action`                   | `MarketStatusAction` | `MarketStatusAction` | 必填        | 交易场所状态操作。                   |
| `ts_event`                 | `UnixNanos`          | `int`                | 必填        | 事件时间戳，单位为纳秒。             |
| `ts_init`                  | `UnixNanos`          | `int`                | 必填        | 初始化时间戳，单位为纳秒。           |
| `reason`                   | `Option<Ustr>`       | `str \| None`        | `None`      | 交易场所提供时，表示状态变化的原因。 |
| `trading_event`            | `Option<Ustr>`       | `str \| None`        | `None`      | 交易场所提供时，表示其事件标签。     |
| `is_trading`               | `Option<bool>`       | `bool \| None`       | `None`      | 已知时，表示是否允许交易。           |
| `is_quoting`               | `Option<bool>`       | `bool \| None`       | `None`      | 已知时，表示是否允许报价。           |
| `is_short_sell_restricted` | `Option<bool>`       | `bool \| None`       | `None`      | 已知时，表示卖空限制状态。           |

## 行为

- 可选布尔值使适配器能够保留交易场所提供的状态，而无需猜测缺失值。
- `action` 提供标准化的高层状态，即使交易场所特有的详细信息也存储在 `reason` 或 `trading_event` 中。
- 策略可以通过 `on_instrument_status(...)` 处理状态更新。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    data::InstrumentStatus,
    enums::MarketStatusAction,
    identifiers::InstrumentId,
};
use ustr::Ustr;

let status = InstrumentStatus::new(
    InstrumentId::from("AAPL.XNAS"),
    MarketStatusAction::Trading,
    UnixNanos::from(1_000_000_000),
    UnixNanos::from(1_000_000_100),
    Some(Ustr::from("Normal trading")),
    Some(Ustr::from("MARKET_OPEN")),
    Some(true),
    Some(true),
    Some(false),
);
```

```python tab="Python"
from vibe_trader.model import InstrumentId
from vibe_trader.model import InstrumentStatus
from vibe_trader.model.enums import MarketStatusAction

status = InstrumentStatus(
    instrument_id=InstrumentId.from_str("AAPL.XNAS"),
    action=MarketStatusAction.TRADING,
    ts_event=1_000_000_000,
    ts_init=1_000_000_100,
    reason="Normal trading",
    trading_event="MARKET_OPEN",
    is_trading=True,
    is_quoting=True,
    is_short_sell_restricted=False,
)
```

## 相关指南

- [InstrumentClose](instrument_close.md)介绍金融工具收盘价格事件。
- [金融工具](../instruments/)介绍金融工具定义。
- [Python API 参考](/docs/python-api-latest/model/data.html)列出 Python 成员。
