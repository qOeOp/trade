# Stop-Market

`FIX OrdType <40>=3`（Stop）

*Stop-Market* 是一种条件订单，触发后会立即挂出 *Market* 订单。这种订单类型常用作止损单来限制损失：
针对多头持仓使用 SELL 订单，针对空头持仓使用 BUY 订单。

## 使用场景

当价格突破某一价位后需要确保执行时，请使用 *Stop-Market* 订单，例如保护性止损或突破入场。
由于触发后会转换为 *Market* 订单，持仓几乎总能打开或关闭。代价是触发价格并非成交价格：
在快速变化或跳空的市场中，成交价格可能远远越过止损价，因此它以价格确定性换取执行确定性
（与 *Stop-Limit* 相反）。

## 示例

以下示例在 Binance 现货/保证金交易所创建一笔 *Stop-Market* 订单，
当触发价格达到 100,000 USDT 时卖出 1 BTC，撤销前一直有效：

```rust tab="Rust"
use vibe_model::{
    enums::{OrderSide, TimeInForce, TriggerType},
    identifiers::InstrumentId,
    types::{Price, Quantity},
};

let order = self.order().stop_market(
    InstrumentId::from("BTCUSDT.BINANCE"),
    OrderSide::Sell,
    Quantity::from(1),
    Price::from("100000"),
    Some(TriggerType::LastPrice), // optional (default DEFAULT)
    Some(TimeInForce::Gtc),       // optional (default GTC)
    None,                         // expire_time
    Some(false),                  // reduce_only (default false)
    None,                         // quote_quantity (default false)
    None,                         // display_qty
    None,                         // emulation_trigger
    None,                         // trigger_instrument_id
    None,                         // exec_algorithm_id
    None,                         // exec_algorithm_params
    None,                         // tags
    None,                         // client_order_id
);
```

```python tab="Python"
from vibe_trader.model.enums import OrderSide
from vibe_trader.model.enums import TimeInForce
from vibe_trader.model.enums import TriggerType
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model.orders import StopMarketOrder

order: StopMarketOrder = self.order_factory.stop_market(
    instrument_id=InstrumentId.from_str("BTCUSDT.BINANCE"),
    order_side=OrderSide.SELL,
    quantity=Quantity.from_int(1),
    trigger_price=Price.from_int(100_000),
    trigger_type=TriggerType.LAST_PRICE,  # <-- optional (default DEFAULT)
    time_in_force=TimeInForce.GTC,  # <-- optional (default GTC)
    expire_time=None,  # <-- optional (default None)
    reduce_only=False,  # <-- optional (default False)
    tags=None,  # <-- optional (default None)
)
```

更多详情请参阅 [`StopMarketOrder` API 参考](/docs/python-api-latest/model/orders.html#vibe_trader.model.orders.stop_market.StopMarketOrder)。

## 相关指南

- [订单](index.md#trigger-type) - 触发类型及其他执行指令。
- [模拟订单](emulated.md) - 在没有原生支持的交易场所模拟条件订单。
- [执行](../execution.md) - 订单如何到达交易场所及如何处理成交。
