# 大宗商品

`Commodity` 表示以货币计价的黄金、白银、石油或其他实物资产现货大宗商品市场。
它建模的是现货市场，而非有到期日的期货合约。

示例包括 `XAUUSD.IDEALPRO` 和交易场所特定的大宗商品现货符号。

## 字段

| 字段              | Rust 类型          | Python 类型        | 必填/默认值 | 说明                         |
| ----------------- | ------------------ | ------------------ | ----------- | ---------------------------- |
| `instrument_id`   | `InstrumentId`     | `InstrumentId`     | 必填        | 在 Rust 中存储为 `id`。      |
| `raw_symbol`      | `Symbol`           | `Symbol`           | 必填        | 交易场所原生符号。           |
| `asset_class`     | `AssetClass`       | `AssetClass`       | 必填        | 大宗商品资产分类。           |
| `quote_currency`  | `Currency`         | `Currency`         | 必填        | 用于给大宗商品定价的货币。   |
| `price_precision` | `u8`               | `int`              | 必填        | 价格允许的小数位数。         |
| `size_precision`  | `u8`               | `int`              | 必填        | 订单数量允许的小数位数。     |
| `price_increment` | `Price`            | `Price`            | 必填        | 最小有效价格步长。           |
| `size_increment`  | `Quantity`         | `Quantity`         | 必填        | 最小有效数量步长。           |
| `ts_event`        | `UnixNanos`        | `int`              | 必填        | 事件时间戳，单位为纳秒。     |
| `ts_init`         | `UnixNanos`        | `int`              | 必填        | 初始化时间戳，单位为纳秒。   |
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

- `Commodity` 的金融工具类别为 `Spot`。
- 它允许负价格：电力或石油等现货市场可能以低于零的价格交易，`RiskEngine` 在订单提交和修改时都接受负价格。
- 它绝不会采用反向计价，成本货币为计价货币。
- 它没有激活时间戳、到期日、行权价、期权类型或结算货币字段。
- 对有到期日的交易所交易大宗商品期货使用 `FuturesContract`。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    enums::AssetClass,
    identifiers::{InstrumentId, Symbol},
    instruments::Commodity,
    types::{Currency, Price, Quantity},
};

let gold = Commodity::builder()
    .instrument_id(InstrumentId::from("GOLD.COMEX"))
    .raw_symbol(Symbol::from("GOLD"))
    .asset_class(AssetClass::Commodity)
    .quote_currency(Currency::from("USD"))
    .price_precision(2)
    .size_precision(0)
    .price_increment(Price::from("0.01"))
    .size_increment(Quantity::from("1"))
    .lot_size(Quantity::from("1"))
    .ts_event(UnixNanos::default())
    .ts_init(UnixNanos::default())
    .build()
    .unwrap();
```

```python tab="Python"
from vibe_trader.model import AssetClass
from vibe_trader.model import Commodity
from vibe_trader.model import Currency
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model import Symbol

gold = Commodity(
    instrument_id=InstrumentId.from_str("GOLD.COMEX"),
    raw_symbol=Symbol("GOLD"),
    asset_class=AssetClass.COMMODITY,
    quote_currency=Currency.from_str("USD"),
    price_precision=2,
    price_increment=Price.from_str("0.01"),
    size_precision=0,
    size_increment=Quantity.from_int(1),
    ts_event=0,
    ts_init=0,
    lot_size=Quantity.from_int(1),
)
```

## 适配器

创建或使用 `Commodity` 金融工具的代表性适配器包括：

- [Interactive Brokers](../../integrations/ib.md)，用于现货大宗商品和金属合约。

## 相关指南

- [期货合约](futures_contract.md)介绍以大宗商品为标的的有到期日期货。
- [数据](../data/)说明引用金融工具的市场数据。
