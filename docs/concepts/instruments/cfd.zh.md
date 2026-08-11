# 差价合约

`Cfd` 表示一种跟踪标的资产、但不转移标的所有权的差价合约。交易场所定义其
计价货币、精度、增量、限制、保证金和费用。

示例包括外汇、股票、指数和大宗商品的 CFD 合约。

## 字段

| 字段              | Rust 类型          | Python 类型        | 必填/默认值 | 说明                               |
| ----------------- | ------------------ | ------------------ | ----------- | ---------------------------------- |
| `instrument_id`   | `InstrumentId`     | `InstrumentId`     | 必填        | 在 Rust 中存储为 `id`。            |
| `raw_symbol`      | `Symbol`           | `Symbol`           | 必填        | 交易场所原生符号。                 |
| `asset_class`     | `AssetClass`       | `AssetClass`       | 必填        | 标的资产的资产类别。               |
| `base_currency`   | `Option<Currency>` | `Currency \| None` | `None`      | CFD 跟踪基础货币时使用的基础货币。 |
| `quote_currency`  | `Currency`         | `Currency`         | 必填        | 用于报价和计值的货币。             |
| `price_precision` | `u8`               | `int`              | 必填        | 价格允许的小数位数。               |
| `size_precision`  | `u8`               | `int`              | 必填        | 订单数量允许的小数位数。           |
| `price_increment` | `Price`            | `Price`            | 必填        | 最小有效价格步长。                 |
| `size_increment`  | `Quantity`         | `Quantity`         | 必填        | 最小有效数量步长。                 |
| `lot_size`        | `Option<Quantity>` | `Quantity \| None` | `None`      | 取整手数或整批大小。               |
| `max_quantity`    | `Option<Quantity>` | `Quantity \| None` | `None`      | 最大订单数量。                     |
| `min_quantity`    | `Option<Quantity>` | `Quantity \| None` | `None`      | 最小订单数量。                     |
| `max_notional`    | `Option<Money>`    | `Money \| None`    | `None`      | 最大订单名义价值。                 |
| `min_notional`    | `Option<Money>`    | `Money \| None`    | `None`      | 最小订单名义价值。                 |
| `max_price`       | `Option<Price>`    | `Price \| None`    | `None`      | 最大有效报价或订单价格。           |
| `min_price`       | `Option<Price>`    | `Price \| None`    | `None`      | 最小有效报价或订单价格。           |
| `margin_init`     | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 初始保证金率。                     |
| `margin_maint`    | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 维持保证金率。                     |
| `maker_fee`       | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 挂单方费率。负值表示返佣。         |
| `taker_fee`       | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 吃单方费率。负值表示返佣。         |
| `tick_scheme`     | `Option<Ustr>`     | `str \| None`      | `None`      | 已注册的可变 tick 方案名称。       |
| `info`            | `Option<Params>`   | `dict \| None`     | `None`      | 适配器元数据。                     |
| `ts_event`        | `UnixNanos`        | `int`              | 必填        | 事件时间戳，单位为纳秒。           |
| `ts_init`         | `UnixNanos`        | `int`              | 必填        | 初始化时间戳，单位为纳秒。         |

*注意：Python 构造函数使用 `instrument_id`；Rust 将相同的值存储为 `id`。*

## 行为

- `Cfd` 的金融工具类别为 `Cfd`。
- 它绝不会采用反向计价，且乘数为一。
- 它没有激活时间戳、到期时间戳、行权价或期权类型。
- 当交易场所同时提供现货金融工具和 CFD 时，应采用来源市场类型。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    enums::AssetClass,
    identifiers::{InstrumentId, Symbol},
    instruments::Cfd,
    types::{Currency, Price, Quantity},
};
use rust_decimal_macros::dec;

let audusd = Cfd::builder()
    .instrument_id(InstrumentId::from("AUDUSD.OANDA"))
    .raw_symbol(Symbol::from("AUD/USD"))
    .asset_class(AssetClass::FX)
    .base_currency(Currency::from("AUD"))
    .quote_currency(Currency::from("USD"))
    .price_precision(5)
    .size_precision(0)
    .price_increment(Price::from("0.00001"))
    .size_increment(Quantity::from("1"))
    .lot_size(Quantity::from("1000"))
    .margin_init(dec!(0.03))
    .margin_maint(dec!(0.03))
    .maker_fee(dec!(0.00002))
    .taker_fee(dec!(0.00002))
    .ts_event(UnixNanos::default())
    .ts_init(UnixNanos::default())
    .build()
    .unwrap();
```

```python tab="Python"
from decimal import Decimal

from vibe_trader.model import AssetClass
from vibe_trader.model import Cfd
from vibe_trader.model import Currency
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model import Symbol

audusd = Cfd(
    instrument_id=InstrumentId.from_str("AUDUSD.OANDA"),
    raw_symbol=Symbol("AUD/USD"),
    asset_class=AssetClass.FX,
    quote_currency=Currency.from_str("USD"),
    price_precision=5,
    price_increment=Price.from_str("0.00001"),
    size_precision=0,
    size_increment=Quantity.from_int(1),
    ts_event=0,
    ts_init=0,
    base_currency=Currency.from_str("AUD"),
    lot_size=Quantity.from_int(1000),
    margin_init=Decimal("0.03"),
    margin_maint=Decimal("0.03"),
    maker_fee=Decimal("0.00002"),
    taker_fee=Decimal("0.00002"),
)
```

## 适配器

创建或使用 `Cfd` 金融工具的代表性适配器包括：

- [Interactive Brokers](../../integrations/ib.md)，用于 CFD 合约。

## 相关指南

- [货币对](currency_pair.md)介绍现汇和加密货币现货对。
- [大宗商品](commodity.md)介绍现货大宗商品金融工具。
