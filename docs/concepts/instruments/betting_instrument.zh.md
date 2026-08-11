# 投注金融工具

`BettingInstrument` 表示体育或博彩市场中的一个选项。它携带赛事、竞赛、市场和
选项元数据，使 Vibe 能够将该选项作为具有价格、数量、限制、保证金和费用的金融工具处理。

示例包括 Betfair 赛果赔率选项和让分盘市场选项。

## 字段

| 字段                 | Rust 类型          | Python 类型        | 必填/默认值 | 说明                             |
| -------------------- | ------------------ | ------------------ | ----------- | -------------------------------- |
| `instrument_id`      | `InstrumentId`     | `InstrumentId`     | 必填        | 在 Rust 中存储为 `id`。          |
| `raw_symbol`         | `Symbol`           | `Symbol`           | 必填        | 交易场所的原生或生成符号。       |
| `event_type_id`      | `u64`              | `int`              | 必填        | 赛事类型标识符。                 |
| `event_type_name`    | `Ustr`             | `str`              | 必填        | 赛事类型名称，例如某项运动。     |
| `competition_id`     | `u64`              | `int`              | 必填        | 竞赛标识符。                     |
| `competition_name`   | `Ustr`             | `str`              | 必填        | 竞赛名称。                       |
| `event_id`           | `u64`              | `int`              | 必填        | 赛事标识符。                     |
| `event_name`         | `Ustr`             | `str`              | 必填        | 赛事名称。                       |
| `event_country_code` | `Ustr`             | `str`              | 必填        | 赛事国家代码。                   |
| `event_open_date`    | `UnixNanos`        | `int`              | 必填        | 赛事开放时间。                   |
| `betting_type`       | `Ustr`             | `str`              | 必填        | 交易场所发布的投注类型。         |
| `market_id`          | `Ustr`             | `str`              | 必填        | 市场标识符。                     |
| `market_name`        | `Ustr`             | `str`              | 必填        | 市场名称。                       |
| `market_type`        | `Ustr`             | `str`              | 必填        | 市场类型，例如赛果赔率。         |
| `market_start_time`  | `UnixNanos`        | `int`              | 必填        | 市场开始时间。                   |
| `selection_id`       | `u64`              | `int`              | 必填        | 选项或参赛者标识符。             |
| `selection_name`     | `Ustr`             | `str`              | 必填        | 选项或参赛者名称。               |
| `selection_handicap` | `f64`              | `float`            | 必填        | 让分盘市场的让分值。             |
| `currency`           | `Currency`         | `Currency`         | 必填        | 计价货币和结算货币。             |
| `price_precision`    | `u8`               | `int`              | 必填        | 价格允许的小数位数。             |
| `size_precision`     | `u8`               | `int`              | 必填        | 订单数量允许的小数位数。         |
| `price_increment`    | `Price`            | `Price`            | 必填        | 价格步长，通常由 tick 方案设定。 |
| `size_increment`     | `Quantity`         | `Quantity`         | 必填        | 最小数量步长。                   |
| `max_quantity`       | `Option<Quantity>` | `Quantity \| None` | `None`      | 最大订单数量。                   |
| `min_quantity`       | `Option<Quantity>` | `Quantity \| None` | `None`      | 最小订单数量。                   |
| `max_notional`       | `Option<Money>`    | `Money \| None`    | `None`      | 最大订单名义价值。               |
| `min_notional`       | `Option<Money>`    | `Money \| None`    | `None`      | 最小订单名义价值。               |
| `max_price`          | `Option<Price>`    | `Price \| None`    | `None`      | 最大有效报价或订单价格。         |
| `min_price`          | `Option<Price>`    | `Price \| None`    | `None`      | 最小有效报价或订单价格。         |
| `margin_init`        | `Option<Decimal>`  | `Decimal \| None`  | `1`         | 初始保证金率。                   |
| `margin_maint`       | `Option<Decimal>`  | `Decimal \| None`  | `1`         | 维持保证金率。                   |
| `maker_fee`          | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 挂单方费率。负值表示返佣。       |
| `taker_fee`          | `Option<Decimal>`  | `Decimal \| None`  | `0`         | 吃单方费率。负值表示返佣。       |
| `tick_scheme`        | `Option<Ustr>`     | `str \| None`      | `None`      | 已注册的可变 tick 方案名称。     |
| `info`               | `Option<Params>`   | `dict \| None`     | `None`      | 适配器元数据。                   |
| `ts_event`           | `UnixNanos`        | `int`              | 必填        | 事件时间戳，单位为纳秒。         |
| `ts_init`            | `UnixNanos`        | `int`              | 必填        | 初始化时间戳，单位为纳秒。       |

*注意：Python 根据交易场所、市场、选项和让分字段构建金融工具 ID 与原始符号。
Rust 以 `instrument_id` 和 `raw_symbol` 接收它们。*

## 行为

- `BettingInstrument` 的资产类别为 `Alternative`，金融工具类别为 `SportsBetting`。
- 每个选项或参赛者都建模为独立的金融工具。
- 投注金融工具通常使用已注册的 tick 方案来规定有效赔率步长。
- 保证金默认为一，因为下注通常会预留全部投注额。

## 示例

```rust tab="Rust"
use jiff::Timestamp;
use vibe_core::UnixNanos;
use vibe_model::{
    identifiers::{InstrumentId, Symbol},
    instruments::BettingInstrument,
    types::{Currency, Money, Price, Quantity},
};
use rust_decimal_macros::dec;
use ustr::Ustr;

let event_open: Timestamp = "2022-02-07T23:30:00Z".parse().unwrap();
let market_start: Timestamp = "2022-02-07T23:30:00Z".parse().unwrap();

let selection = BettingInstrument::builder()
    .instrument_id(InstrumentId::from("1-123456789.BETFAIR"))
    .raw_symbol(Symbol::from("1-123456789"))
    .event_type_id(6423)
    .event_type_name(Ustr::from("American Football"))
    .competition_id(12_282_733)
    .competition_name(Ustr::from("NFL"))
    .event_id(29_678_534)
    .event_name(Ustr::from("NFL"))
    .event_country_code(Ustr::from("GB"))
    .event_open_date(UnixNanos::from(event_open))
    .betting_type(Ustr::from("ODDS"))
    .market_id(Ustr::from("1-123456789"))
    .market_name(Ustr::from("AFC Conference Winner"))
    .market_type(Ustr::from("SPECIAL"))
    .market_start_time(UnixNanos::from(market_start))
    .selection_id(50214)
    .selection_name(Ustr::from("Kansas City Chiefs"))
    .selection_handicap(0.0)
    .currency(Currency::from("GBP"))
    .price_precision(2)
    .size_precision(2)
    .price_increment(Price::from("0.01"))
    .size_increment(Quantity::from("0.01"))
    .max_quantity(Quantity::from("1000"))
    .min_quantity(Quantity::from("1"))
    .max_notional(Money::from("10000 GBP"))
    .min_notional(Money::from("10 GBP"))
    .max_price(Price::from("100.00"))
    .min_price(Price::from("1.00"))
    .margin_init(dec!(1))
    .margin_maint(dec!(1))
    .maker_fee(dec!(0))
    .taker_fee(dec!(0))
    .ts_event(UnixNanos::default())
    .ts_init(UnixNanos::default())
    .build()
    .unwrap();
```

```python tab="Python"
import pandas as pd

from vibe_trader.model import BettingInstrument
from vibe_trader.model import Currency
from vibe_trader.model import InstrumentId
from vibe_trader.model import Money
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model import Symbol
from vibe_trader.model import Venue

GBP = Currency.from_str("GBP")

selection = BettingInstrument(
    instrument_id=InstrumentId(Symbol("1-123456789-50214"), Venue("BETFAIR")),
    raw_symbol=Symbol("1-123456789-50214"),
    event_type_id=6423,
    event_type_name="American Football",
    competition_id=12282733,
    competition_name="NFL",
    event_id=29678534,
    event_name="NFL",
    event_country_code="GB",
    event_open_date=pd.Timestamp("2022-02-07 23:30:00+00:00").value,
    betting_type="ODDS",
    market_id="1-123456789",
    market_name="AFC Conference Winner",
    market_type="SPECIAL",
    market_start_time=pd.Timestamp("2022-02-07 23:30:00+00:00").value,
    selection_id=50214,
    selection_name="Kansas City Chiefs",
    selection_handicap=0.0,
    currency=GBP,
    price_precision=2,
    size_precision=2,
    price_increment=Price.from_str("0.01"),
    size_increment=Quantity.from_str("0.01"),
    min_notional=Money(1, GBP),
    ts_event=0,
    ts_init=0,
)
```

## 适配器

创建或使用 `BettingInstrument` 金融工具的代表性适配器包括：

- [Betfair](../../integrations/betfair.md)，用于体育博彩市场。

## 相关指南

- [会计](../accounting.md)介绍投注账户行为。
- [数据](../data/)说明引用金融工具的市场数据。
