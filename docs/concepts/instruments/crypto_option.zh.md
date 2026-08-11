# 加密货币期权

`CryptoOption` 表示以加密资产为标的的看跌或看涨期权。它定义期权类型、行权价、激活时间、
到期时间、计价货币、结算货币和合约规模。

示例包括加密衍生品交易场所中的 BTC 和 ETH 期权。

## 字段

| 字段                  | Rust 类型          | Python 类型        | 必填/默认值 | 说明                                     |
| --------------------- | ------------------ | ------------------ | ----------- | ---------------------------------------- |
| `instrument_id`       | `InstrumentId`     | `InstrumentId`     | 必填        | 在 Rust 中存储为 `id`。                  |
| `raw_symbol`          | `Symbol`           | `Symbol`           | 必填        | 交易场所原生符号。                       |
| `underlying`          | `Currency`         | `Currency`         | 必填        | 期权跟踪的加密资产。                     |
| `quote_currency`      | `Currency`         | `Currency`         | 必填        | 用于权利金报价的货币。                   |
| `settlement_currency` | `Currency`         | `Currency`         | 必填        | 用于结算损益和费用的货币。               |
| `is_inverse`          | `bool`             | `bool`             | 必填        | 数量计算/成本计价采用反向方式时为 true。 |
| `option_kind`         | `OptionKind`       | `OptionKind`       | 必填        | 看跌或看涨。                             |
| `strike_price`        | `Price`            | `Price`            | 必填        | 期权行权价。                             |
| `activation_ns`       | `UnixNanos`        | `int`              | 必填        | 合约激活时间戳。                         |
| `expiration_ns`       | `UnixNanos`        | `int`              | 必填        | 合约到期时间戳。                         |
| `price_precision`     | `u8`               | `int`              | 必填        | 价格允许的小数位数。                     |
| `size_precision`      | `u8`               | `int`              | 必填        | 订单数量允许的小数位数。                 |
| `price_increment`     | `Price`            | `Price`            | 必填        | 最小有效价格步长。                       |
| `size_increment`      | `Quantity`         | `Quantity`         | 必填        | 最小有效数量步长。                       |
| `multiplier`          | `Quantity`         | `Quantity`         | `1`         | 合约乘数。                               |
| `lot_size`            | `Quantity`         | `Quantity`         | `1`         | 取整手数或整批大小。                     |
| `max_quantity`        | `Option<Quantity>` | `Quantity \| None` | `None`      | 最大订单数量。                           |
| `min_quantity`        | `Option<Quantity>` | `Quantity \| None` | `1`         | 最小订单数量。                           |
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

- `CryptoOption` 的资产类别为 `Cryptocurrency`，金融工具类别为 `Option`。
- 期权类型和行权价定义收益结构。
- 该合约可以是线性、反向或 Quanto（双币种）型，具体取决于货币集合。
- 对非加密货币上市期权使用 `OptionContract`。

## 示例

```rust tab="Rust"
use jiff::Timestamp;
use vibe_core::UnixNanos;
use vibe_model::{
    enums::OptionKind,
    identifiers::{InstrumentId, Symbol},
    instruments::CryptoOption,
    types::{Currency, Money, Price, Quantity},
};
use rust_decimal_macros::dec;

let activation: Timestamp = "2022-12-22T00:00:00Z".parse().unwrap();
let expiration: Timestamp = "2023-01-13T08:00:00Z".parse().unwrap();

let btc_option = CryptoOption::builder()
    .instrument_id(InstrumentId::from("BTC-13JAN23-16000-P.DERIBIT"))
    .raw_symbol(Symbol::from("BTC-13JAN23-16000-P"))
    .underlying(Currency::from("BTC"))
    .quote_currency(Currency::from("USD"))
    .settlement_currency(Currency::from("BTC"))
    .is_inverse(false)
    .option_kind(OptionKind::Put)
    .strike_price(Price::from("16000.00"))
    .activation_ns(UnixNanos::from(activation))
    .expiration_ns(UnixNanos::from(expiration))
    .price_precision(2)
    .size_precision(1)
    .price_increment(Price::from("0.01"))
    .size_increment(Quantity::from("0.1"))
    .multiplier(Quantity::from("1"))
    .lot_size(Quantity::from("1"))
    .max_quantity(Quantity::from("9000"))
    .min_quantity(Quantity::from("0.1"))
    .min_notional(Money::from("10.00 USD"))
    .margin_init(dec!(0))
    .margin_maint(dec!(0))
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

from vibe_trader.model import CryptoOption
from vibe_trader.model import Currency
from vibe_trader.model import InstrumentId
from vibe_trader.model import Money
from vibe_trader.model import OptionKind
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model import Symbol

BTC = Currency.from_str("BTC")
USD = Currency.from_str("USD")

btc_option = CryptoOption(
    instrument_id=InstrumentId.from_str("BTC-13JAN23-16000-P.DERIBIT"),
    raw_symbol=Symbol("BTC-13JAN23-16000-P"),
    underlying=BTC,
    quote_currency=USD,
    settlement_currency=BTC,
    is_inverse=False,
    option_kind=OptionKind.PUT,
    strike_price=Price.from_str("16000.00"),
    activation_ns=pd.Timestamp("2022-12-22", tz="UTC").value,
    expiration_ns=pd.Timestamp("2023-01-13T08:00:00", tz="UTC").value,
    price_precision=2,
    size_precision=1,
    price_increment=Price.from_str("0.01"),
    size_increment=Quantity.from_str("0.1"),
    max_quantity=Quantity.from_str("9000"),
    min_quantity=Quantity.from_str("0.1"),
    min_notional=Money(10.00, USD),
    margin_init=Decimal(0),
    margin_maint=Decimal(0),
    maker_fee=Decimal("0.0003"),
    taker_fee=Decimal("0.0003"),
    ts_event=0,
    ts_init=0,
)
```

## 适配器

创建或使用 `CryptoOption` 金融工具的代表性适配器包括：

- [Bybit](../../integrations/bybit.md)，用于加密货币期权。
- [Deribit](../../integrations/deribit.md)，用于加密货币期权。
- [OKX](../../integrations/okx.md)，用于加密货币期权。
- [Tardis](../../integrations/tardis.md)，用于加密货币期权元数据。

## 相关指南

- [期权](../options.md)介绍期权数据、希腊字母指标和期权链订阅。
- [加密货币期权价差](crypto_option_spread.md)介绍交易所定义的加密货币期权价差。
