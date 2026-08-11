# Stop-Limit

`FIX OrdType <40>=4`（Stop Limit）

*Stop-Limit* 是一种条件订单，触发后会立即以指定价格挂出 *Limit* 订单。

## 使用场景

当既需要止损触发条件，又需要限制可接受的最差成交价格时，请使用 *Stop-Limit* 订单，
例如设置保护性退出，或在拒绝以某一价格之外成交时用于突破入场。其优势是释放后的 *Limit*
订单具有价格保护。相较于 *Stop-Market*，代价是存在一个核心风险：如果市场跳空穿过触发价和限价，
订单可能完全无法成交，使持仓失去保护。

## 示例

以下示例在 Currenex 外汇 ECN 创建一笔 *Stop-Limit* 订单：当市场触及 1.30010 USD
的触发价格后，以 1.3000 USD 的限价买入 50,000 GBP，有效期至 2022 年 6 月 6 日中午（UTC）：

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    enums::{OrderSide, TimeInForce, TriggerType},
    identifiers::InstrumentId,
    types::{Price, Quantity},
};

let order = self.order().stop_limit(
    InstrumentId::from("GBP/USD.CURRENEX"),
    OrderSide::Buy,
    Quantity::from(50_000),
    Price::from("1.30000"),
    Price::from("1.30010"),
    Some(TriggerType::BidAsk), // optional (default DEFAULT)
    Some(TimeInForce::Gtd),    // optional (default GTC)
    Some(UnixNanos::from(1_654_516_800_000_000_000_u64)), // 2022-06-06T12:00:00 UTC
    Some(true),                // post_only (default false)
    Some(false),               // reduce_only (default false)
    None,                      // quote_quantity (default false)
    None,                      // display_qty
    None,                      // emulation_trigger
    None,                      // trigger_instrument_id
    None,                      // exec_algorithm_id
    None,                      // exec_algorithm_params
    None,                      // tags
    None,                      // client_order_id
);
```

```python tab="Python"
import pandas as pd
from vibe_trader.model.enums import OrderSide
from vibe_trader.model.enums import TimeInForce
from vibe_trader.model.enums import TriggerType
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model.orders import StopLimitOrder

order: StopLimitOrder = self.order_factory.stop_limit(
    instrument_id=InstrumentId.from_str("GBP/USD.CURRENEX"),
    order_side=OrderSide.BUY,
    quantity=Quantity.from_int(50_000),
    price=Price.from_str("1.30000"),
    trigger_price=Price.from_str("1.30010"),
    trigger_type=TriggerType.BID_ASK,  # <-- optional (default DEFAULT)
    time_in_force=TimeInForce.GTD,  # <-- optional (default GTC)
    expire_time=pd.Timestamp("2022-06-06T12:00"),
    post_only=True,  # <-- optional (default False)
    reduce_only=False,  # <-- optional (default False)
    tags=None,  # <-- optional (default None)
)
```

更多详情请参阅 [`StopLimitOrder` API 参考](/docs/python-api-latest/model/orders.html#vibe_trader.model.orders.stop_limit.StopLimitOrder)。

## 相关指南

- [订单](index.md#trigger-type) - 触发类型及其他执行指令。
- [模拟订单](emulated.md) - 在没有原生支持的交易场所模拟条件订单。
- [执行](../execution.md) - 订单如何到达交易场所及如何处理成交。
