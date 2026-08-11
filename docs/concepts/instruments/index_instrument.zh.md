# 指数金融工具

`IndexInstrument` 表示股票指数、波动率指数或基准价格序列等参考指数。它携带精度和增量元数据，
使 Vibe 能够一致地存储和路由价格，但它不是可直接交易的合约。

示例包括 `SPX.XCBO`、`VIX.XCBO` 和交易场所特定的参考指数。

## 字段

| 字段              | Rust 类型        | Python 类型    | 必填/默认值 | 说明                         |
| ----------------- | ---------------- | -------------- | ----------- | ---------------------------- |
| `instrument_id`   | `InstrumentId`   | `InstrumentId` | 必填        | 在 Rust 中存储为 `id`。      |
| `raw_symbol`      | `Symbol`         | `Symbol`       | 必填        | 交易场所原生符号。           |
| `currency`        | `Currency`       | `Currency`     | 必填        | 报价值的参考货币。           |
| `price_precision` | `u8`             | `int`          | 必填        | 价格允许的小数位数。         |
| `size_precision`  | `u8`             | `int`          | 必填        | 数量允许的小数位数。         |
| `price_increment` | `Price`          | `Price`        | 必填        | 最小有效价格步长。           |
| `size_increment`  | `Quantity`       | `Quantity`     | 必填        | 最小有效数量步长。           |
| `ts_event`        | `UnixNanos`      | `int`          | 必填        | 事件时间戳，单位为纳秒。     |
| `ts_init`         | `UnixNanos`      | `int`          | 必填        | 初始化时间戳，单位为纳秒。   |
| `tick_scheme`     | `Option<Ustr>`   | `str \| None`  | `None`      | 已注册的可变 tick 方案名称。 |
| `info`            | `Option<Params>` | `dict \| None` | `None`      | 适配器元数据。               |

*注意：Python 构造函数使用 `instrument_id`；Rust 将相同的值存储为 `id`。*

## 行为

- `IndexInstrument` 的资产类别为 `Index`，金融工具类别为 `Spot`。
- 它是参考金融工具，不应当用于提交订单。
- 它没有限制、保证金、费用、合约乘数、到期日或结算货币。
- 对以指数为标的的可交易衍生品使用期权或期货类型。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    identifiers::{InstrumentId, Symbol},
    instruments::IndexInstrument,
    types::{Currency, Price, Quantity},
};

let spx = IndexInstrument::builder()
    .instrument_id(InstrumentId::from("SPX.XCBO"))
    .raw_symbol(Symbol::from("SPX"))
    .currency(Currency::from("USD"))
    .price_precision(2)
    .size_precision(0)
    .price_increment(Price::from("0.01"))
    .size_increment(Quantity::from("1"))
    .ts_event(UnixNanos::default())
    .ts_init(UnixNanos::default())
    .build()
    .unwrap();
```

```python tab="Python"
from vibe_trader.model import Currency
from vibe_trader.model import IndexInstrument
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model import Symbol

spx = IndexInstrument(
    instrument_id=InstrumentId.from_str("SPX.XCBO"),
    raw_symbol=Symbol("SPX"),
    currency=Currency.from_str("USD"),
    price_precision=2,
    size_precision=0,
    price_increment=Price.from_str("0.01"),
    size_increment=Quantity.from_str("1"),
    ts_event=0,
    ts_init=0,
)
```

## 适配器

创建或使用 `IndexInstrument` 金融工具的代表性适配器包括：

- [Interactive Brokers](../../integrations/ib.md)，用于参考指数。
- [Databento](../../integrations/databento.md)，用于参考数据馈送。

## 相关指南

- [期权合约](option_contract.md)介绍以指数为标的的上市期权。
- [期货合约](futures_contract.md)介绍指数期货。
