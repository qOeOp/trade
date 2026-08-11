# Market

`FIX OrdType <40>=1`

*Market* 订单是交易者发出的指令，要求按当前最佳可用价格立即交易指定数量。
还可以指定多种有效期选项，并指明该订单是否仅用于减少持仓。

## 使用场景

当成交比精确价格更重要时，请使用 *Market* 订单，例如紧急降低风险、进入快速变化的流动市场，
或在等待成本高于点差时跨越较窄的点差。其优势是几乎确定的即时执行。代价是没有价格保护：
需要支付点差，并在流动性较薄或行情快速变化的市场中承担滑点风险，因此它远比在非流动性金融工具中
更适合用于流动性金融工具。

## 示例

以下示例在 Interactive Brokers [IdealPro](https://ibkr.info/node/1708) 外汇 ECN
创建一笔 *Market* 订单，使用 USD 买入 100,000 AUD：

```rust tab="Rust"
use vibe_model::{
    enums::{OrderSide, TimeInForce},
    identifiers::InstrumentId,
    types::Quantity,
};
use ustr::Ustr;

let order = self.order().market(
    InstrumentId::from("AUD/USD.IDEALPRO"),
    OrderSide::Buy,
    Quantity::from(100_000),
    Some(TimeInForce::Ioc),          // optional (default GTC)
    Some(false),                     // reduce_only (default false)
    None,                            // quote_quantity (default false)
    None,                            // exec_algorithm_id
    None,                            // exec_algorithm_params
    Some(vec![Ustr::from("ENTRY")]), // tags
    None,                            // client_order_id (auto-generated if None)
);
```

```python tab="Python"
from vibe_trader.model.enums import OrderSide
from vibe_trader.model.enums import TimeInForce
from vibe_trader.model import InstrumentId
from vibe_trader.model import Quantity
from vibe_trader.model.orders import MarketOrder

order: MarketOrder = self.order_factory.market(
    instrument_id=InstrumentId.from_str("AUD/USD.IDEALPRO"),
    order_side=OrderSide.BUY,
    quantity=Quantity.from_int(100_000),
    time_in_force=TimeInForce.IOC,  # <-- optional (default GTC)
    reduce_only=False,  # <-- optional (default False)
    tags=["ENTRY"],  # <-- optional (default None)
)
```

更多详情请参阅 [`MarketOrder` API 参考](/docs/python-api-latest/model/orders.html#vibe_trader.model.orders.market.MarketOrder)。

## 相关指南

- [订单](index.md) - 订单概念、执行指令与订单工厂。
- [执行](../execution.md) - 订单如何到达交易场所及如何处理成交。
