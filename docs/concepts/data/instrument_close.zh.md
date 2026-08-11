# InstrumentClose

`InstrumentClose` 表示金融工具在某个交易场所的收盘价格事件，涵盖交易时段结束时的收盘事件和合约到期收盘事件。

## 字段

| 字段            | Rust 类型             | Python 类型           | 必填/默认值 | 说明                                     |
| --------------- | --------------------- | --------------------- | ----------- | ---------------------------------------- |
| `instrument_id` | `InstrumentId`        | `InstrumentId`        | 必填        | 正在收盘的金融工具。                     |
| `close_price`   | `Price`               | `Price`               | 必填        | 收盘价或结算价。                         |
| `close_type`    | `InstrumentCloseType` | `InstrumentCloseType` | 必填        | `END_OF_SESSION` 或 `CONTRACT_EXPIRED`。 |
| `ts_event`      | `UnixNanos`           | `int`                 | 必填        | 事件时间戳，单位为纳秒。                 |
| `ts_init`       | `UnixNanos`           | `int`                 | 必填        | 初始化时间戳，单位为纳秒。               |

## 行为

- 交易时段结束收盘事件提供时段级收盘价。
- 合约到期收盘事件标记有期限合约的到期事件。
- 收盘价是参考数据，并不表示曾以该价格发生成交。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    data::InstrumentClose,
    enums::InstrumentCloseType,
    identifiers::InstrumentId,
    types::Price,
};

let close = InstrumentClose::new(
    InstrumentId::from("ESM4.XCME"),
    Price::from("5325.25"),
    InstrumentCloseType::EndOfSession,
    UnixNanos::from(1_000_000_000),
    UnixNanos::from(1_000_000_100),
);
```

```python tab="Python"
from vibe_trader.model import InstrumentClose
from vibe_trader.model import InstrumentCloseType
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price

close = InstrumentClose(
    instrument_id=InstrumentId.from_str("ESM4.XCME"),
    close_price=Price.from_str("5325.25"),
    close_type=InstrumentCloseType.END_OF_SESSION,
    ts_event=1_000_000_000,
    ts_init=1_000_000_100,
)
```

## 相关指南

- [InstrumentStatus](instrument_status.md)介绍金融工具状态事件。
- [金融工具](../instruments/)介绍金融工具定义。
- [Python API 参考](/docs/python-api-latest/model/data.html)列出 Python 成员。
