# 合成金融工具

`SyntheticInstrument` 表示价格由其他金融工具的公式计算得到的本地金融工具。它适用于应在系统中作为金融工具呈现的价差、篮子、比率及其他衍生价格。

示例包括 `(BTC.BINANCE + LTC.BINANCE) / 2.0`，以及由组成金融工具价格构建的比率型交易对。

## 字段

| 字段              | Rust 类型           | Python 类型          | 必填/默认值 | 说明                                    |
| ----------------- | ------------------- | -------------------- | ----------- | --------------------------------------- |
| `symbol`          | `Symbol`            | `Symbol`             | 必填        | 与交易场所 `SYNTH` 一起使用的合成符号。 |
| `id`              | `InstrumentId`      | `InstrumentId`       | 派生        | 由 `symbol.SYNTH` 构成的金融工具 ID。   |
| `price_precision` | `u8`                | `int`                | 必填        | 合成价格允许的小数位数。                |
| `price_increment` | `Price`             | `Price`              | 派生        | 由精度确定的最小价格步长。              |
| `components`      | `Vec<InstrumentId>` | `list[InstrumentId]` | 必填        | 公式使用的组成金融工具。                |
| `formula`         | `String`            | `str`                | 必填        | 基于组成 ID 的数值表达式。              |
| `ts_event`        | `UnixNanos`         | `int`                | 必填        | 事件时间戳，单位为纳秒。                |
| `ts_init`         | `UnixNanos`         | `int`                | 必填        | 初始化时间戳，单位为纳秒。              |

*注意：Python 根据 `symbol` 和 `SYNTH` 交易场所构建金融工具 ID。Rust 将相同的值存储为 `id`。*

## 行为

- `SyntheticInstrument` 位于 Vibe 本地，不表示交易场所中可下单的市场。
- 它始终使用合成交易场所 `SYNTH`。
- Python 要求至少两个组成金融工具 ID。
- 该公式必须能针对提供的组成标识符成功编译，对象才有效。
- 它没有交易场所限制、保证金、费用、订单簿或适配器特定元数据。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    identifiers::{InstrumentId, Symbol},
    instruments::SyntheticInstrument,
};

let synthetic = SyntheticInstrument::new(
    Symbol::from("BTC-LTC"),
    2,
    vec![
        InstrumentId::from("BTC.BINANCE"),
        InstrumentId::from("LTC.BINANCE"),
    ],
    "(BTC.BINANCE + LTC.BINANCE) / 2.0",
    UnixNanos::default(),
    UnixNanos::default(),
);
```

```python tab="Python"
from vibe_trader.model import InstrumentId
from vibe_trader.model import Symbol
from vibe_trader.model import SyntheticInstrument

synthetic = SyntheticInstrument(
    symbol=Symbol("BTC-LTC"),
    price_precision=2,
    components=[
        InstrumentId.from_str("BTC.BINANCE"),
        InstrumentId.from_str("LTC.BINANCE"),
    ],
    formula="(BTC.BINANCE + LTC.BINANCE) / 2.0",
    ts_event=0,
    ts_init=0,
)
```

## 适配器

`SyntheticInstrument` 仅存在于本地。它从组成金融工具派生价格，而这些金融工具可以来自系统中已加载的任意适配器。

## 相关指南

- [合成金融工具](../synthetics.md)介绍公式派生金融工具和合成 K 线。
- [数据](../data/)说明引用金融工具的市场数据。
