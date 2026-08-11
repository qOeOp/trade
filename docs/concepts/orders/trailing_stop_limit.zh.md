# Trailing-Stop-Limit

`FIX OrdType <40>=4`（Stop Limit）+ 追踪挂钩

*Trailing-Stop-Limit* 是一种条件订单，其止损触发价格与指定市场价格保持固定偏移并随之移动。
触发后，会立即以指定价格挂出 *Limit* 订单（在触发前，该价格也会随市场变化而更新）。

## 使用场景

当既需要追踪止损的动态移动，又需要限制成交价格时，请使用 *Trailing-Stop-Limit* 订单。
其优势是结合追踪保护和价格控制。代价相当于追踪版本的 *Stop-Limit*：快速反转时，
释放后的 *Limit* 订单可能无法成交，使持仓保持未平仓。

## 示例

以下示例在 Currenex 外汇 ECN 创建一笔 *Trailing-Stop-Limit* 订单，使用 USD 买入 1,250,000 AUD：
限价为 0.71000 USD，在 0.72000 USD 激活，之后止损价格与当前卖价保持 0.00100 USD 的偏移并追踪移动，
撤销前一直有效：

```rust tab="Rust"
use vibe_model::{
    enums::{OrderSide, TimeInForce, TrailingOffsetType, TriggerType},
    identifiers::InstrumentId,
    types::{Price, Quantity},
};
use rust_decimal_macros::dec;
use ustr::Ustr;

let order = self.order().trailing_stop_limit(
    InstrumentId::from("AUD/USD.CURRENEX"),
    OrderSide::Buy,
    Quantity::from(1_250_000),
    Price::from("0.71000"),          // limit price
    dec!(0.00050),                   // limit_offset
    dec!(0.00100),                   // trailing_offset
    Some(TrailingOffsetType::Price), // optional (default PRICE)
    Some(Price::from("0.72000")),    // activation_price
    None,                            // trigger_price (materializes from the offset on the first trail)
    Some(TriggerType::BidAsk),       // optional (default DEFAULT)
    Some(TimeInForce::Gtc),          // optional (default GTC)
    None,                            // expire_time
    Some(false),                     // post_only (default false)
    Some(true),                      // reduce_only (default false)
    None,                            // quote_quantity (default false)
    None,                            // display_qty
    None,                            // emulation_trigger
    None,                            // trigger_instrument_id
    None,                            // exec_algorithm_id
    None,                            // exec_algorithm_params
    Some(vec![Ustr::from("TRAILING_STOP")]), // tags
    None,                            // client_order_id
);
```

```python tab="Python"
import pandas as pd
from decimal import Decimal
from vibe_trader.model.enums import OrderSide
from vibe_trader.model.enums import TimeInForce
from vibe_trader.model.enums import TriggerType
from vibe_trader.model.enums import TrailingOffsetType
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model.orders import TrailingStopLimitOrder

order: TrailingStopLimitOrder = self.order_factory.trailing_stop_limit(
    instrument_id=InstrumentId.from_str("AUD/USD.CURRENEX"),
    order_side=OrderSide.BUY,
    quantity=Quantity.from_int(1_250_000),
    price=Price.from_str("0.71000"),
    activation_price=Price.from_str("0.72000"),
    trigger_type=TriggerType.BID_ASK,  # <-- optional (default DEFAULT)
    limit_offset=Decimal("0.00050"),
    trailing_offset=Decimal("0.00100"),
    trailing_offset_type=TrailingOffsetType.PRICE,
    time_in_force=TimeInForce.GTC,  # <-- optional (default GTC)
    expire_time=None,  # <-- optional (default None)
    reduce_only=True,  # <-- optional (default False)
    tags=["TRAILING_STOP"],  # <-- optional (default None)
)
```

更多详情请参阅 [`TrailingStopLimitOrder` API 参考](/docs/python-api-latest/model/orders.html#vibe_trader.model.orders.trailing_stop_limit.TrailingStopLimitOrder)。

## 相关指南

- [订单](index.md#trigger-offset-type) - 触发类型与追踪偏移类型。
- [模拟订单](emulated.md) - 在没有原生支持的交易场所模拟追踪止损单。
- [执行](../execution.md) - 订单如何到达交易场所及如何处理成交。
