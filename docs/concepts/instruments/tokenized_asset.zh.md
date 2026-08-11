# 代币化资产

`TokenizedAsset` 表示在加密货币交易场所跟踪另一资产的类现货代币。当交易场所提供代币、但其经济参考为外部资产时，
将它用于代币化股票、代币化基金或类似金融工具。

示例包括加密货币交易场所中的代币化股票或 ETF 符号。

## 字段

| 字段              | Rust 类型          | Python 类型        | 必填/默认值 | 说明                         |
| ----------------- | ------------------ | ------------------ | ----------- | ---------------------------- |
| `instrument_id`   | `InstrumentId`     | `InstrumentId`     | 必填        | 在 Rust 中存储为 `id`。      |
| `raw_symbol`      | `Symbol`           | `Symbol`           | 必填        | 交易场所原生符号。           |
| `asset_class`     | `AssetClass`       | `AssetClass`       | 必填        | 经济资产分类。               |
| `base_currency`   | `Currency`         | `Currency`         | 必填        | 代币化资产或基础代币。       |
| `quote_currency`  | `Currency`         | `Currency`         | 必填        | 用于给代币定价的货币。       |
| `price_precision` | `u8`               | `int`              | 必填        | 价格允许的小数位数。         |
| `size_precision`  | `u8`               | `int`              | 必填        | 订单数量允许的小数位数。     |
| `price_increment` | `Price`            | `Price`            | 必填        | 最小有效价格步长。           |
| `size_increment`  | `Quantity`         | `Quantity`         | 必填        | 最小有效数量步长。           |
| `ts_event`        | `UnixNanos`        | `int`              | 必填        | 事件时间戳，单位为纳秒。     |
| `ts_init`         | `UnixNanos`        | `int`              | 必填        | 初始化时间戳，单位为纳秒。   |
| `isin`            | `Option<Ustr>`     | `str \| None`      | `None`      | 已知时为国际证券识别码。     |
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

- `TokenizedAsset` 的金融工具类别为 `Spot`。
- 它绝不会采用反向计价，成本货币为计价货币。
- 当代币引用上市证券时，它可以携带 `isin`。
- 它没有激活时间戳、到期日、行权价或期权类型。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    enums::AssetClass,
    identifiers::{InstrumentId, Symbol},
    instruments::TokenizedAsset,
    types::{Currency, Price, Quantity},
};
use rust_decimal_macros::dec;

let aaplx = TokenizedAsset::builder()
    .instrument_id(InstrumentId::from("AAPLx/USD.KRAKEN"))
    .raw_symbol(Symbol::from("AAPLxUSD"))
    .asset_class(AssetClass::Equity)
    .base_currency(Currency::get_or_create_crypto("AAPLx"))
    .quote_currency(Currency::from("USD"))
    .price_precision(2)
    .size_precision(4)
    .price_increment(Price::from("0.01"))
    .size_increment(Quantity::from("0.0001"))
    .min_quantity(Quantity::from("0.0001"))
    .maker_fee(dec!(-0.0002))
    .taker_fee(dec!(0.001))
    .ts_event(UnixNanos::default())
    .ts_init(UnixNanos::default())
    .build()
    .unwrap();
```

```python tab="Python"
from decimal import Decimal

from vibe_trader.model import AssetClass
from vibe_trader.model import Currency
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model import Symbol
from vibe_trader.model import TokenizedAsset

aaplx = TokenizedAsset(
    instrument_id=InstrumentId.from_str("AAPLx/USD.KRAKEN"),
    raw_symbol=Symbol("AAPLxUSD"),
    asset_class=AssetClass.EQUITY,
    base_currency=Currency.from_str("AAPLx"),
    quote_currency=Currency.from_str("USD"),
    price_precision=2,
    size_precision=4,
    price_increment=Price.from_str("0.01"),
    size_increment=Quantity.from_str("0.0001"),
    ts_event=0,
    ts_init=0,
    min_quantity=Quantity.from_str("0.0001"),
    maker_fee=Decimal("-0.0002"),
    taker_fee=Decimal("0.001"),
)
```

## 适配器

创建或使用 `TokenizedAsset` 金融工具的代表性适配器包括：

- [Kraken](../../integrations/kraken.md)，用于交易场所提供的代币化资产。

## 相关指南

- [货币对](currency_pair.md)介绍普通加密货币现货对。
- [股票](equity.md)介绍上市现货股票。
