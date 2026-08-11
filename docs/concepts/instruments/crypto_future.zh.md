# 加密货币期货

`CryptoFuture` 表示有到期日的加密货币期货合约。它跟踪加密货币标的，以计价货币报价，
以结算货币结算，并在固定时间戳到期。

示例包括加密衍生品交易场所中有到期日的 BTC 或 ETH 期货。

## 字段

| 字段                  | Rust 类型          | Python 类型        | 必填/默认值 | 说明                                     |
| --------------------- | ------------------ | ------------------ | ----------- | ---------------------------------------- |
| `instrument_id`       | `InstrumentId`     | `InstrumentId`     | 必填        | 在 Rust 中存储为 `id`。                  |
| `raw_symbol`          | `Symbol`           | `Symbol`           | 必填        | 交易场所原生符号。                       |
| `underlying`          | `Currency`         | `Currency`         | 必填        | 合约跟踪的加密资产。                     |
| `quote_currency`      | `Currency`         | `Currency`         | 必填        | 用于价格报价的货币。                     |
| `settlement_currency` | `Currency`         | `Currency`         | 必填        | 用于结算损益和费用的货币。               |
| `is_inverse`          | `bool`             | `bool`             | 必填        | 数量计算/成本计价采用反向方式时为 true。 |
| `activation_ns`       | `UnixNanos`        | `int`              | 必填        | 合约激活时间戳。                         |
| `expiration_ns`       | `UnixNanos`        | `int`              | 必填        | 合约到期时间戳。                         |
| `price_precision`     | `u8`               | `int`              | 必填        | 价格允许的小数位数。                     |
| `size_precision`      | `u8`               | `int`              | 必填        | 订单数量允许的小数位数。                 |
| `price_increment`     | `Price`            | `Price`            | 必填        | 最小有效价格步长。                       |
| `size_increment`      | `Quantity`         | `Quantity`         | 必填        | 最小有效数量步长。                       |
| `multiplier`          | `Quantity`         | `Quantity`         | `1`         | 合约乘数。                               |
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

- `CryptoFuture` 的资产类别为 `Cryptocurrency`，金融工具类别为 `Future`。
- 线性合约通常设置 `is_inverse=False`，并以计价货币结算。
- 反向合约设置 `is_inverse=True`，通常以标的货币结算。
- Quanto（双币种）合约以不同于标的货币和计价货币的第三种货币结算。
- 对没有到期日的加密衍生品使用 `CryptoPerpetual`。

## 示例

```rust tab="Rust"
use jiff::Timestamp;
use vibe_core::UnixNanos;
use vibe_model::{
    identifiers::{InstrumentId, Symbol},
    instruments::CryptoFuture,
    types::{Currency, Money, Price, Quantity},
};

let activation: Timestamp = "2024-01-08T00:00:00Z".parse().unwrap();
let expiration: Timestamp = "2024-03-29T00:00:00Z".parse().unwrap();

let btcusdt_future = CryptoFuture::builder()
    .instrument_id(InstrumentId::from("BTCUSDT-240329.BINANCE"))
    .raw_symbol(Symbol::from("BTCUSDT-240329"))
    .underlying(Currency::from("BTC"))
    .quote_currency(Currency::from("USDT"))
    .settlement_currency(Currency::from("USDT"))
    .is_inverse(false)
    .activation_ns(UnixNanos::from(activation))
    .expiration_ns(UnixNanos::from(expiration))
    .price_precision(2)
    .size_precision(6)
    .price_increment(Price::from("0.01"))
    .size_increment(Quantity::from("0.000001"))
    .max_quantity(Quantity::from("9000.0"))
    .min_quantity(Quantity::from("0.000001"))
    .min_notional(Money::from("10.00 USDT"))
    .max_price(Price::from("1000000.00"))
    .min_price(Price::from("0.01"))
    .ts_event(UnixNanos::default())
    .ts_init(UnixNanos::default())
    .build()
    .unwrap();
```

```python tab="Python"
import pandas as pd

from vibe_trader.model import CryptoFuture
from vibe_trader.model import Currency
from vibe_trader.model import InstrumentId
from vibe_trader.model import Money
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model import Symbol

BTC = Currency.from_str("BTC")
USDT = Currency.from_str("USDT")

btcusdt_future = CryptoFuture(
    instrument_id=InstrumentId.from_str("BTCUSDT-240329.BINANCE"),
    raw_symbol=Symbol("BTCUSDT-240329"),
    underlying=BTC,
    quote_currency=USDT,
    settlement_currency=USDT,
    is_inverse=False,
    activation_ns=pd.Timestamp("2024-01-08", tz="UTC").value,
    expiration_ns=pd.Timestamp("2024-03-29", tz="UTC").value,
    price_precision=2,
    size_precision=6,
    price_increment=Price.from_str("0.01"),
    size_increment=Quantity.from_str("0.000001"),
    max_quantity=Quantity.from_str("9000"),
    min_quantity=Quantity.from_str("0.000001"),
    min_notional=Money(10.00, USDT),
    max_price=Price.from_str("1000000.00"),
    min_price=Price.from_str("0.01"),
    ts_event=0,
    ts_init=0,
)
```

## 适配器

创建或使用 `CryptoFuture` 金融工具的代表性适配器包括：

- [BitMEX](../../integrations/bitmex.md)，用于反向和线性有到期日期货。
- [Bybit](../../integrations/bybit.md)，用于加密货币期货市场。
- [Deribit](../../integrations/deribit.md)，用于有到期日的加密货币期货。
- [OKX](../../integrations/okx.md)，用于有到期日的加密货币期货。
- [Tardis](../../integrations/tardis.md)，用于加密货币期货元数据。

## 相关指南

- [加密货币永续合约](crypto_perpetual.md)介绍加密货币永续期货。
- [期货合约](futures_contract.md)介绍非加密货币期货合约。
