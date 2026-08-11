# OptionGreeks

`OptionGreeks` 表示交易场所为某一期权金融工具提供的期权敏感度和隐含波动率。作为原生 `Data` 枚举变体，它可以通过数据目录记录、回放和查询。

## 字段

| 字段               | Rust 类型           | Python 类型        | 必填/默认值 | 说明                               |
| ------------------ | ------------------- | ------------------ | ----------- | ---------------------------------- |
| `instrument_id`    | `InstrumentId`      | `InstrumentId`     | 必填        | 希腊字母值对应的期权金融工具。     |
| `convention`       | `GreeksConvention`  | `GreeksConvention` | 默认值      | 这些数值采用的计价基准约定。       |
| `greeks`           | `OptionGreekValues` | 独立浮点数         | 必填        | Delta、gamma、vega、theta 和 rho。 |
| `mark_iv`          | `Option<f64>`       | `float \| None`    | `None`      | 标记隐含波动率。                   |
| `bid_iv`           | `Option<f64>`       | `float \| None`    | `None`      | 买方隐含波动率。                   |
| `ask_iv`           | `Option<f64>`       | `float \| None`    | `None`      | 卖方隐含波动率。                   |
| `underlying_price` | `Option<f64>`       | `float \| None`    | `None`      | 计算时使用的标的价格。             |
| `open_interest`    | `Option<f64>`       | `float \| None`    | `None`      | 交易场所发布时的未平仓量。         |
| `ts_event`         | `UnixNanos`         | `int`              | 必填        | 事件时间戳，单位为纳秒。           |
| `ts_init`          | `UnixNanos`         | `int`              | 必填        | 初始化时间戳，单位为纳秒。         |

## 行为

- 在 Rust 接口中，`OptionGreeks` 可解引用为其核心 `OptionGreekValues`。
- Python 构造函数以独立浮点参数接收 `delta`、`gamma`、`vega`、`theta` 和可选的 `rho`。
- 期权链订阅使用 `underlying_price` 和 delta 来解析 ATM 行权价窗口以及基于 delta 的行权价窗口。

## 示例

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    data::{OptionGreekValues, OptionGreeks},
    enums::GreeksConvention,
    identifiers::InstrumentId,
};

let greeks = OptionGreeks {
    instrument_id: InstrumentId::from("BTC-20240628-65000-C.DERIBIT"),
    convention: GreeksConvention::PriceAdjusted,
    greeks: OptionGreekValues {
        delta: 0.51,
        gamma: 0.0002,
        vega: 12.5,
        theta: -3.2,
        rho: 0.1,
    },
    mark_iv: Some(0.55),
    bid_iv: Some(0.54),
    ask_iv: Some(0.56),
    underlying_price: Some(65_000.0),
    open_interest: Some(120.0),
    ts_event: UnixNanos::from(1_000_000_000),
    ts_init: UnixNanos::from(1_000_000_100),
};
```

```python tab="Python"
from vibe_trader.model import InstrumentId
from vibe_trader.model import OptionGreeks

greeks = OptionGreeks(
    instrument_id=InstrumentId.from_str("BTC-20240628-65000-C.DERIBIT"),
    delta=0.51,
    gamma=0.0002,
    vega=12.5,
    theta=-3.2,
    rho=0.1,
    mark_iv=0.55,
    bid_iv=0.54,
    ask_iv=0.56,
    underlying_price=65_000.0,
    open_interest=120.0,
    ts_event=1_000_000_000,
    ts_init=1_000_000_100,
)
```

## 相关指南

- [希腊字母值](../greeks.md)介绍交易场所提供和本地计算的希腊字母值。
- [期权](../options.md#optiongreeks-data-type)介绍期权链订阅。
- [Python API 参考](/docs/python-api-latest/model/data.html)列出 Python 成员。
