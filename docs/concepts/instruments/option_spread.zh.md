# 期权价差

`OptionSpread` 表示由交易所定义的多腿期权策略。交易场所将该策略作为单一金融工具发布，
并赋予其自身的符号、tick 大小、到期日和执行规则。

示例包括上市垂直价差、日历价差和其他期权策略。

## 字段

| 字段              | Rust 类型          | Python 类型        | 必填/默认值 | 说明                                |
| ----------------- | ------------------ | ------------------ | ----------- | ----------------------------------- |
| `instrument_id`   | `InstrumentId`     | `InstrumentId`     | 必填        | 在 Rust 中存储为 `id`。             |
| `raw_symbol`      | `Symbol`           | `Symbol`           | 必填        | 交易场所原生符号。                  |
| `asset_class`     | `AssetClass`       | `AssetClass`       | 必填        | 标的策略的资产类别。                |
| `exchange`        | `Option<Ustr>`     | `str \| None`      | `None`      | 已知时为交易所 MIC 或交易场所代码。 |
| `underlying`      | `Ustr`             | `str`              | 必填        | 标的资产、期货或指数。              |
| `strategy_type`   | `Ustr`             | `str`              | 必填        | 交易场所策略类型，例如垂直价差。    |
| `activation_ns`   | `UnixNanos`        | `int`              | 必填        | 策略激活时间戳。                    |
| `expiration_ns`   | `UnixNanos`        | `int`              | 必填        | 策略到期时间戳。                    |
| `currency`        | `Currency`         | `Currency`         | 必填        | 权利金计价货币和结算货币。          |
| `price_precision` | `u8`               | `int`              | 必填        | 价格允许的小数位数。                |
| `price_increment` | `Price`            | `Price`            | 必填        | 最小有效价格步长。                  |
| `size_precision`  | `u8`               | `int`              | `0`         | 期权价差以整数合约交易。            |
| `size_increment`  | `Quantity`         | `Quantity`         | `1`         | 最小合约数量步长。                  |
| `multiplier`      | `Quantity`         | `Quantity`         | 必填        | 策略乘数。                          |
| `lot_size`        | `Quantity`         | `Quantity`         | 必填        | 取整手数或合约手数大小。            |
| `margin_init`     | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 初始保证金率。                      |
| `margin_maint`    | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 维持保证金率。                      |
| `maker_fee`       | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 挂单方费率。负值表示返佣。          |
| `taker_fee`       | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 吃单方费率。负值表示返佣。          |
| `max_quantity`    | `Option<Quantity>` | `Quantity \| None` | `None`      | 最大订单数量。                      |
| `min_quantity`    | `Option<Quantity>` | `Quantity \| None` | `1`         | 最小订单数量。                      |
| `max_price`       | `Option<Price>`    | `Price \| None`    | `None`      | 最大有效报价或订单价格。            |
| `min_price`       | `Option<Price>`    | `Price \| None`    | `None`      | 最小有效报价或订单价格。            |
| `tick_scheme`     | `Option<Ustr>`     | `str \| None`      | `None`      | 已注册的可变 tick 方案名称。        |
| `info`            | `Option<Params>`   | `dict \| None`     | `None`      | 适配器元数据。                      |
| `ts_event`        | `UnixNanos`        | `int`              | 必填        | 事件时间戳，单位为纳秒。            |
| `ts_init`         | `UnixNanos`        | `int`              | 必填        | 初始化时间戳，单位为纳秒。          |

*注意：Python 构造函数使用 `instrument_id`；Rust 将相同的值存储为 `id`。*

## 行为

- `OptionSpread` 的金融工具类别为 `OptionSpread`。
- 交易场所将该价差作为单一可交易金融工具发布。
- 它以整数合约交易，数量精度为 `0`，数量增量为 `1`。
- 当适配器提供交易场所特定的腿部详情时，将其存入 `info`。

## 示例

```rust tab="Rust"
use jiff::Timestamp;
use vibe_core::UnixNanos;
use vibe_model::{
    enums::AssetClass,
    identifiers::{InstrumentId, Symbol},
    instruments::OptionSpread,
    types::{Currency, Price, Quantity},
};
use ustr::Ustr;

let activation: Timestamp = "2023-11-06T20:54:07Z".parse().unwrap();
let expiration: Timestamp = "2024-02-23T22:59:00Z".parse().unwrap();

let sr3_spread = OptionSpread::builder()
    .instrument_id(InstrumentId::from("UD:U$: GN 2534559.GLBX"))
    .raw_symbol(Symbol::from("UD:U$: GN 2534559"))
    .asset_class(AssetClass::FX)
    .exchange(Ustr::from("XCME"))
    .underlying(Ustr::from("SR3"))
    .strategy_type(Ustr::from("GN"))
    .activation_ns(UnixNanos::from(activation))
    .expiration_ns(UnixNanos::from(expiration))
    .currency(Currency::from("USD"))
    .price_precision(2)
    .price_increment(Price::from("0.01"))
    .multiplier(Quantity::from("1"))
    .lot_size(Quantity::from("1"))
    .ts_event(UnixNanos::default())
    .ts_init(UnixNanos::default())
    .build()
    .unwrap();
```

```python tab="Python"
import pandas as pd

from vibe_trader.model import AssetClass
from vibe_trader.model import Currency
from vibe_trader.model import InstrumentId
from vibe_trader.model import OptionSpread
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model import Symbol

sr3_spread = OptionSpread(
    instrument_id=InstrumentId.from_str("UD:U$: GN 2534559.GLBX"),
    raw_symbol=Symbol("UD:U$: GN 2534559"),
    asset_class=AssetClass.FX,
    underlying="SR3",
    strategy_type="GN",
    activation_ns=pd.Timestamp("2023-11-06T20:54:07", tz="UTC").value,
    expiration_ns=pd.Timestamp("2024-02-23T22:59:00", tz="UTC").value,
    currency=Currency.from_str("USD"),
    price_precision=2,
    price_increment=Price.from_str("0.01"),
    multiplier=Quantity.from_int(1),
    lot_size=Quantity.from_int(1),
    ts_event=0,
    ts_init=0,
    exchange="XCME",
)
```

## 适配器

创建或使用 `OptionSpread` 金融工具的代表性适配器包括：

- [Databento](../../integrations/databento.md)，用于上市期权价差市场。
- [Interactive Brokers](../../integrations/ib.md)，用于交易所定义的期权策略。

## 相关指南

- [期权合约](option_contract.md)介绍单腿期权合约。
- [期权](../options.md)介绍期权数据、希腊字母指标和期权链订阅。
