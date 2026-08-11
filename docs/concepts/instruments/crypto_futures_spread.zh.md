# 加密货币期货价差

`CryptoFuturesSpread` 表示交易所定义的加密货币期货价差策略。交易场所将该策略作为单一金融工具发布，
并赋予其自身的符号、策略类型、精度、增量和到期日。

示例包括上市加密货币期货日历价差。

## 字段

| 字段                  | Rust 类型          | Python 类型        | 必填/默认值 | 说明                                     |
| --------------------- | ------------------ | ------------------ | ----------- | ---------------------------------------- |
| `instrument_id`       | `InstrumentId`     | `InstrumentId`     | 必填        | 在 Rust 中存储为 `id`。                  |
| `raw_symbol`          | `Symbol`           | `Symbol`           | 必填        | 交易场所原生符号。                       |
| `underlying`          | `Currency`         | `Currency`         | 必填        | 策略跟踪的加密资产。                     |
| `quote_currency`      | `Currency`         | `Currency`         | 必填        | 用于价格报价的货币。                     |
| `settlement_currency` | `Currency`         | `Currency`         | 必填        | 用于结算损益和费用的货币。               |
| `is_inverse`          | `bool`             | `bool`             | 必填        | 数量计算/成本计价采用反向方式时为 true。 |
| `strategy_type`       | `Ustr`             | `str`              | 必填        | 交易场所策略类型，例如日历价差。         |
| `activation_ns`       | `UnixNanos`        | `int`              | 必填        | 策略激活时间戳。                         |
| `expiration_ns`       | `UnixNanos`        | `int`              | 必填        | 策略到期时间戳。                         |
| `price_precision`     | `u8`               | `int`              | 必填        | 价格允许的小数位数。                     |
| `size_precision`      | `u8`               | `int`              | 必填        | 订单数量允许的小数位数。                 |
| `price_increment`     | `Price`            | `Price`            | 必填        | 最小有效价格步长。                       |
| `size_increment`      | `Quantity`         | `Quantity`         | 必填        | 最小有效数量步长。                       |
| `multiplier`          | `Quantity`         | `Quantity`         | `1`         | 策略乘数。                               |
| `lot_size`            | `Quantity`         | `Quantity`         | `1`         | 取整手数或整批大小。                     |
| `max_quantity`        | `Option<Quantity>` | `Quantity \| None` | `None`      | 最大订单数量。                           |
| `min_quantity`        | `Option<Quantity>` | `Quantity \| None` | `None`      | 最小订单数量。                           |
| `max_notional`        | `Option<Money>`    | `Money \| None`    | `None`      | 最大订单名义价值。                       |
| `min_notional`        | `Option<Money>`    | `Money \| None`    | `None`      | 最小订单名义价值。                       |
| `max_price`           | `Option<Price>`    | `Price \| None`    | `None`      | 最大有效报价或订单价格。                 |
| `min_price`           | `Option<Price>`    | `Price \| None`    | `None`      | 最小有效报价或订单价格。                 |
| `margin_init`         | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 初始保证金率。                           |
| `margin_maint`        | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 维持保证金率。                           |
| `maker_fee`           | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 挂单方费率。负值表示返佣。               |
| `taker_fee`           | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 吃单方费率。负值表示返佣。               |
| `tick_scheme`         | `Option<Ustr>`     | `str \| None`      | `None`      | 已注册的可变 tick 方案名称。             |
| `info`                | `Option<Params>`   | `dict \| None`     | `None`      | 适配器元数据。                           |
| `ts_event`            | `UnixNanos`        | `int`              | 必填        | 事件时间戳，单位为纳秒。                 |
| `ts_init`             | `UnixNanos`        | `int`              | 必填        | 初始化时间戳，单位为纳秒。               |

*注意：Python 构造函数使用 `instrument_id`；Rust 将相同的值存储为 `id`。*

## 行为

- `CryptoFuturesSpread` 的资产类别为 `Cryptocurrency`，金融工具类别为 `FuturesSpread`。
- 交易场所将该价差作为单一可交易金融工具发布。
- 该策略可以是线性、反向或 Quanto（双币种）型，具体取决于货币集合。
- 当适配器提供交易场所特定的腿部详情时，将其存入 `info`。

## 示例

```rust tab="Rust"
use jiff::Timestamp;
use vibe_core::UnixNanos;
use vibe_model::{
    identifiers::{InstrumentId, Symbol},
    instruments::CryptoFuturesSpread,
    types::{Currency, Price, Quantity},
};
use rust_decimal_macros::dec;
use ustr::Ustr;

let activation: Timestamp = "2026-05-12T00:00:00Z".parse().unwrap();
let expiration: Timestamp = "2026-05-19T08:00:00Z".parse().unwrap();

let btc_spread = CryptoFuturesSpread::builder()
    .instrument_id(InstrumentId::from("BTC-FS-19MAY26_PERP.DERIBIT"))
    .raw_symbol(Symbol::from("BTC-FS-19MAY26_PERP"))
    .underlying(Currency::from("BTC"))
    .quote_currency(Currency::from("USD"))
    .settlement_currency(Currency::from("BTC"))
    .is_inverse(false)
    .strategy_type(Ustr::from("FS"))
    .activation_ns(UnixNanos::from(activation))
    .expiration_ns(UnixNanos::from(expiration))
    .price_precision(1)
    .size_precision(0)
    .price_increment(Price::from("0.5"))
    .size_increment(Quantity::from("1"))
    .multiplier(Quantity::from("10"))
    .lot_size(Quantity::from("1"))
    .min_quantity(Quantity::from("1"))
    .maker_fee(dec!(0.0003))
    .taker_fee(dec!(0.0003))
    .ts_event(UnixNanos::default())
    .ts_init(UnixNanos::default())
    .build()
    .unwrap();
```

```python tab="Python"
from decimal import Decimal

import pandas as pd

from vibe_trader.model import CryptoFuturesSpread
from vibe_trader.model import Currency
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model import Symbol

BTC = Currency.from_str("BTC")
USD = Currency.from_str("USD")

btc_spread = CryptoFuturesSpread(
    instrument_id=InstrumentId.from_str("BTC-FS-19MAY26_PERP.DERIBIT"),
    raw_symbol=Symbol("BTC-FS-19MAY26_PERP"),
    underlying=BTC,
    quote_currency=USD,
    settlement_currency=BTC,
    is_inverse=False,
    strategy_type="FS",
    activation_ns=pd.Timestamp("2026-05-12T00:00:00", tz="UTC").value,
    expiration_ns=pd.Timestamp("2026-05-19T08:00:00", tz="UTC").value,
    price_precision=1,
    size_precision=0,
    price_increment=Price.from_str("0.5"),
    size_increment=Quantity.from_int(1),
    multiplier=Quantity.from_int(10),
    lot_size=Quantity.from_int(1),
    min_quantity=Quantity.from_int(1),
    maker_fee=Decimal("0.0003"),
    taker_fee=Decimal("0.0003"),
    ts_event=0,
    ts_init=0,
)
```

## 适配器

创建或使用 `CryptoFuturesSpread` 金融工具的代表性适配器包括：

- [Deribit](../../integrations/deribit.md)，用于加密货币期货组合。
- [OKX](../../integrations/okx.md)，用于加密货币期货价差市场。

## 相关指南

- [加密货币期货](crypto_future.md)介绍单腿、有到期日的加密货币期货。
- [期货价差](futures_spread.md)介绍非加密货币期货价差。
