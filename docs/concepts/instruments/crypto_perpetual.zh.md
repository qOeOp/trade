# 加密货币永续合约

`CryptoPerpetual` 表示加密货币永续期货合约，也称永续掉期。它没有到期日，跟踪加密基础资产，
并以加密货币、稳定币或交易场所定义的其他结算货币结算。

示例包括 `ETHUSDT-PERP.BINANCE`、`XBTUSD.BITMEX` 和 `BTC-USD-SWAP.OKX`。

## 字段

| 字段                  | Rust 类型          | Python 类型        | 必填/默认值 | 说明                                     |
| --------------------- | ------------------ | ------------------ | ----------- | ---------------------------------------- |
| `instrument_id`       | `InstrumentId`     | `InstrumentId`     | 必填        | 在 Rust 中存储为 `id`。                  |
| `raw_symbol`          | `Symbol`           | `Symbol`           | 必填        | 交易场所原生符号。                       |
| `base_currency`       | `Currency`         | `Currency`         | 必填        | 基础加密资产。                           |
| `quote_currency`      | `Currency`         | `Currency`         | 必填        | 价格的计价货币。                         |
| `settlement_currency` | `Currency`         | `Currency`         | 必填        | 用于结算损益和费用的货币。               |
| `is_inverse`          | `bool`             | `bool`             | 必填        | 数量计算/成本计价采用反向方式时为 true。 |
| `price_precision`     | `u8`               | `int`              | 必填        | 价格允许的小数位数。                     |
| `size_precision`      | `u8`               | `int`              | 必填        | 订单数量允许的小数位数。                 |
| `price_increment`     | `Price`            | `Price`            | 必填        | 最小有效价格步长。                       |
| `size_increment`      | `Quantity`         | `Quantity`         | 必填        | 最小有效数量步长。                       |
| `ts_event`            | `UnixNanos`        | `int`              | 必填        | 事件时间戳，单位为纳秒。                 |
| `ts_init`             | `UnixNanos`        | `int`              | 必填        | 初始化时间戳，单位为纳秒。               |
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

*注意：Python 构造函数使用 `instrument_id`；Rust 将相同的值存储为 `id`。*

## 行为

- `CryptoPerpetual` 的资产类别为 `Cryptocurrency`，金融工具类别为 `Swap`。
- 它没有激活或到期时间戳。
- 线性合约通常设置 `is_inverse=False`，并以计价货币结算。
- 反向合约设置 `is_inverse=True`，通常以基础货币结算。
- Quanto（双币种）合约以不同于基础货币和计价货币的第三种货币结算。
- 反向合约的成本货币为基础货币，Quanto（双币种）合约为结算货币，其他情况为计价货币。

:::note
资金费用不是金融工具上的字段。它们以数据形式到达，例如 `FundingRateUpdate`，并引用金融工具 ID。
:::

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    identifiers::{InstrumentId, Symbol},
    instruments::{CryptoPerpetual, InstrumentAny},
    types::{Currency, Money, Price, Quantity},
};
use rust_decimal_macros::dec;

let ethusdt_perp = CryptoPerpetual::builder()
    .instrument_id(InstrumentId::from("ETHUSDT-PERP.BINANCE"))
    .raw_symbol(Symbol::from("ETHUSDT"))
    .base_currency(Currency::from("ETH"))
    .quote_currency(Currency::from("USDT"))
    .settlement_currency(Currency::from("USDT"))
    .is_inverse(false)
    .price_precision(2)
    .size_precision(3)
    .price_increment(Price::from("0.01"))
    .size_increment(Quantity::from("0.001"))
    .max_quantity(Quantity::from("10000.000"))
    .min_quantity(Quantity::from("0.001"))
    .min_notional(Money::from("10.00 USDT"))
    .max_price(Price::from("15000.00"))
    .min_price(Price::from("1.00"))
    .margin_init(dec!(1.0))
    .margin_maint(dec!(0.35))
    .maker_fee(dec!(0.0002))
    .taker_fee(dec!(0.0004))
    .ts_event(UnixNanos::default())
    .ts_init(UnixNanos::default())
    .build()
    .unwrap();

let instrument = InstrumentAny::CryptoPerpetual(ethusdt_perp);
```

```python tab="Python"
from decimal import Decimal

from vibe_trader.model import CryptoPerpetual
from vibe_trader.model import Currency
from vibe_trader.model import InstrumentId
from vibe_trader.model import Money
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model import Symbol

ETH = Currency.from_str("ETH")
USDT = Currency.from_str("USDT")

ethusdt_perp = CryptoPerpetual(
    instrument_id=InstrumentId.from_str("ETHUSDT-PERP.BINANCE"),
    raw_symbol=Symbol("ETHUSDT"),
    base_currency=ETH,
    quote_currency=USDT,
    settlement_currency=USDT,
    is_inverse=False,
    price_precision=2,
    size_precision=3,
    price_increment=Price.from_str("0.01"),
    size_increment=Quantity.from_str("0.001"),
    ts_event=0,
    ts_init=0,
    max_quantity=Quantity.from_str("10000.000"),
    min_quantity=Quantity.from_str("0.001"),
    min_notional=Money(10.00, USDT),
    max_price=Price.from_str("15000.00"),
    min_price=Price.from_str("1.00"),
    margin_init=Decimal("1.0"),
    margin_maint=Decimal("0.35"),
    maker_fee=Decimal("0.0002"),
    taker_fee=Decimal("0.0004"),
)
```

## 适配器

创建或使用 `CryptoPerpetual` 金融工具的代表性适配器包括：

- [Binance](../../integrations/binance.md)，用于 USD-M 和 COIN-M 永续期货。
- [BitMEX](../../integrations/bitmex.md)，用于反向和线性永续合约。
- [Bybit](../../integrations/bybit.md)，用于线性和反向永续产品。
- [dYdX](../../integrations/dydx.md)，用于永续合约市场。
- [Hyperliquid](../../integrations/hyperliquid.md)，用于永续合约市场。
- [Kraken](../../integrations/kraken.md)，用于期货交易场所的永续市场。
- [OKX](../../integrations/okx.md)，用于掉期市场。
- [Tardis](../../integrations/tardis.md)，用于加密货币永续元数据。

## 相关指南

- [数据](../data/)介绍标记价格、指数价格和资金费率更新。
- [期权](../options.md)介绍期权专用金融工具类型。
- [执行](../execution.md)说明订单到达交易场所前的精度和名义价值检查。
