# 货币对

`CurrencyPair` 表示以 `BASE/QUOTE` 报价的现货或现金市场。基础货币是被买入或卖出的资产，
计价货币为一个单位的基础货币定价。Vibe 将此类型用于法币外汇对和加密货币现货对。

示例包括 `EUR/USD.SIM`、`BTCUSDT.BINANCE` 和 `ETH/USD.KRAKEN`。

## 字段

| 字段              | Rust 类型          | Python 类型        | 必填/默认值 | 说明                         |
| ----------------- | ------------------ | ------------------ | ----------- | ---------------------------- |
| `instrument_id`   | `InstrumentId`     | `InstrumentId`     | 必填        | 在 Rust 中存储为 `id`。      |
| `raw_symbol`      | `Symbol`           | `Symbol`           | 必填        | 交易场所原生符号。           |
| `base_currency`   | `Currency`         | `Currency`         | 必填        | 买入或卖出的资产。           |
| `quote_currency`  | `Currency`         | `Currency`         | 必填        | 用于给基础资产定价的货币。   |
| `price_precision` | `u8`               | `int`              | 必填        | 价格允许的小数位数。         |
| `size_precision`  | `u8`               | `int`              | 必填        | 订单数量允许的小数位数。     |
| `price_increment` | `Price`            | `Price`            | 必填        | 最小有效价格步长。           |
| `size_increment`  | `Quantity`         | `Quantity`         | 必填        | 最小有效数量步长。           |
| `ts_event`        | `UnixNanos`        | `int`              | 必填        | 事件时间戳，单位为纳秒。     |
| `ts_init`         | `UnixNanos`        | `int`              | 必填        | 初始化时间戳，单位为纳秒。   |
| `multiplier`      | `Quantity`         | `Quantity`         | `1`         | 合约乘数。                   |
| `lot_size`        | `Option<Quantity>` | `Quantity \| None` | `None`      | 取整手数或整批大小。         |
| `max_quantity`    | `Option<Quantity>` | `Quantity \| None` | `None`      | 最大订单数量。               |
| `min_quantity`    | `Option<Quantity>` | `Quantity \| None` | `None`      | 最小订单数量。               |
| `max_notional`    | `Option<Money>`    | `Money \| None`    | `None`      | 最大订单名义价值。           |
| `min_notional`    | `Option<Money>`    | `Money \| None`    | `None`      | 最小订单名义价值。           |
| `max_price`       | `Option<Price>`    | `Price \| None`    | `None`      | 最大有效报价或订单价格。     |
| `min_price`       | `Option<Price>`    | `Price \| None`    | `None`      | 最小有效报价或订单价格。     |
| `margin_init`     | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 初始保证金率。               |
| `margin_maint`    | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 维持保证金率。               |
| `maker_fee`       | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 挂单方费率。负值表示返佣。   |
| `taker_fee`       | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 吃单方费率。负值表示返佣。   |
| `tick_scheme`     | `Option<Ustr>`     | `str \| None`      | `None`      | 已注册的可变 tick 方案名称。 |
| `info`            | `Option<Params>`   | `dict \| None`     | `None`      | 适配器元数据。               |

*注意：Python 构造函数使用 `instrument_id`；Rust 将相同的值存储为 `id`。*

## 行为

- `CurrencyPair` 的金融工具类别为 `Spot`。
- 它没有到期日、行权价、期权类型或衍生品标的字段。
- 它绝不会采用反向计价。结算货币和成本货币均为计价货币。
- 法币外汇对和加密货币现货对均使用此类型。

:::warning
不要仅因符号看起来像货币对，就将有到期日的期货、掉期或期权建模为 `CurrencyPair`。
应使用具体的衍生品类型，使成本货币、结算货币、到期日和名义价值计算与交易场所一致。
:::

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    identifiers::{InstrumentId, Symbol},
    instruments::{CurrencyPair, InstrumentAny},
    types::{Currency, Money, Price, Quantity},
};
use rust_decimal_macros::dec;

let btcusdt = CurrencyPair::builder()
    .instrument_id(InstrumentId::from("BTCUSDT.BINANCE"))
    .raw_symbol(Symbol::from("BTCUSDT"))
    .base_currency(Currency::from("BTC"))
    .quote_currency(Currency::from("USDT"))
    .price_precision(2)
    .size_precision(6)
    .price_increment(Price::from("0.01"))
    .size_increment(Quantity::from("0.000001"))
    .min_quantity(Quantity::from("0.000001"))
    .min_notional(Money::from("10.00 USDT"))
    .max_price(Price::from("1000000.00"))
    .min_price(Price::from("0.01"))
    .margin_init(dec!(0.001))
    .margin_maint(dec!(0.001))
    .maker_fee(dec!(0.001))
    .taker_fee(dec!(0.001))
    .ts_event(UnixNanos::default())
    .ts_init(UnixNanos::default())
    .build()
    .unwrap();

let instrument = InstrumentAny::CurrencyPair(btcusdt);
```

```python tab="Python"
from decimal import Decimal

from vibe_trader.model import Currency
from vibe_trader.model import CurrencyPair
from vibe_trader.model import InstrumentId
from vibe_trader.model import Money
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model import Symbol

BTC = Currency.from_str("BTC")
USDT = Currency.from_str("USDT")

btcusdt = CurrencyPair(
    instrument_id=InstrumentId.from_str("BTCUSDT.BINANCE"),
    raw_symbol=Symbol("BTCUSDT"),
    base_currency=BTC,
    quote_currency=USDT,
    price_precision=2,
    size_precision=6,
    price_increment=Price.from_str("0.01"),
    size_increment=Quantity.from_str("0.000001"),
    ts_event=0,
    ts_init=0,
    min_quantity=Quantity.from_str("0.000001"),
    min_notional=Money(10.00, USDT),
    max_price=Price.from_str("1000000.00"),
    min_price=Price.from_str("0.01"),
    margin_init=Decimal("0.001"),
    margin_maint=Decimal("0.001"),
    maker_fee=Decimal("0.001"),
    taker_fee=Decimal("0.001"),
)
```

## 适配器

创建或使用 `CurrencyPair` 金融工具的代表性适配器包括：

- [Binance](../../integrations/binance.md)，用于现货市场。
- [Kraken](../../integrations/kraken.md)，用于现货市场。
- [OKX](../../integrations/okx.md)，用于现货市场。
- [Tardis](../../integrations/tardis.md)，用于现货元数据。
- [Interactive Brokers](../../integrations/ib.md)，用于外汇现货合约。
- [Hyperliquid](../../integrations/hyperliquid.md)，用于现货资产。

## 相关指南

- [数据](../data/)说明引用金融工具的市场数据。
- [执行](../execution.md)说明使用金融工具精度的订单检查。
- [值类型](../value_types.md)说明 `Price`、`Quantity` 和 `Money`。
