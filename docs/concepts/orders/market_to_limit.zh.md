# Market-To-Limit

`FIX OrdType <40>=K`（Market With Left Over as Limit）

*Market-To-Limit* 订单按当前最佳价格以市价单提交。如果订单部分成交，系统会取消剩余部分，
并按已执行价格将其重新提交为 *Limit* 订单。

## 使用场景

当希望立即获取最佳价格上的可用流动性，又不希望以更差价格扫过更深档位时，
请使用 *Market-To-Limit* 订单。它适合订单簿较薄的市场，或希望获得最优报价、
却不想让较大订单逐档吃单并冲击市场的情况。其优势是立即按最佳价格成交，
任何剩余数量都会以 *Limit* 订单留在该价格，而不是追价。代价是市场离开该价格后，
未成交的剩余数量可能继续挂单而不执行。

## 示例

以下示例在 Interactive Brokers [IdealPro](https://ibkr.info/node/1708) 外汇 ECN
创建一笔 *Market-To-Limit* 订单，使用 JPY 买入 200,000 USD：

```rust tab="Rust"
use vibe_model::{
    enums::{OrderSide, TimeInForce},
    identifiers::InstrumentId,
    types::Quantity,
};

let order = self.order().market_to_limit(
    InstrumentId::from("USD/JPY.IDEALPRO"),
    OrderSide::Buy,
    Quantity::from(200_000),
    Some(TimeInForce::Gtc), // optional (default GTC)
    None,                   // expire_time
    Some(false),            // reduce_only (default false)
    None,                   // quote_quantity (default false)
    None,                   // display_qty (default full display)
    None,                   // exec_algorithm_id
    None,                   // exec_algorithm_params
    None,                   // tags
    None,                   // client_order_id
);
```

```python tab="Python"
from vibe_trader.model.enums import OrderSide
from vibe_trader.model.enums import TimeInForce
from vibe_trader.model import InstrumentId
from vibe_trader.model import Quantity
from vibe_trader.model.orders import MarketToLimitOrder

order: MarketToLimitOrder = self.order_factory.market_to_limit(
    instrument_id=InstrumentId.from_str("USD/JPY.IDEALPRO"),
    order_side=OrderSide.BUY,
    quantity=Quantity.from_int(200_000),
    time_in_force=TimeInForce.GTC,  # <-- optional (default GTC)
    reduce_only=False,  # <-- optional (default False)
    display_qty=None,  # <-- optional (default None which indicates full display)
    tags=None,  # <-- optional (default None)
)
```

更多详情请参阅 [`MarketToLimitOrder` API 参考](/docs/python-api-latest/model/orders.html#vibe_trader.model.orders.market_to_limit.MarketToLimitOrder)。

## 相关指南

- [订单](index.md) - 订单概念、执行指令与订单工厂。
- [执行](../execution.md) - 订单如何到达交易场所及如何处理成交。
