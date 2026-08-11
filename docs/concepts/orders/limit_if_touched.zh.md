# Limit-If-Touched

`FIX OrdType <40>` 没有专用值（通常使用带有有利方向触发条件的 `4` Stop Limit）

*Limit-If-Touched* 是一种条件订单，触发后会立即以指定价格挂出 *Limit* 订单。

## 使用场景

当希望仅在价格触及触发条件后才启用受价格保护的订单时，请使用 *Limit-If-Touched* 订单。
例如，当价格接近目标时再启用止盈 *Limit*，而不是提前挂单。其优势是将条件激活与成交价格上限结合。
与 *Stop-Limit* 相同，代价是触发后价格若穿过限价，订单可能无法成交。

## 示例

以下示例在 Binance Futures 交易所创建一笔 *Limit-If-Touched* 订单：当市场触及 30,150 USDT
的触发价格后，以 30,100 USDT 的限价买入 5 张 BTCUSDT-PERP 永续期货合约，
有效期至 2022 年 6 月 6 日中午（UTC）：

```rust tab="Rust"
use vibe_core::UnixNanos;
use vibe_model::{
    enums::{OrderSide, TimeInForce, TriggerType},
    identifiers::InstrumentId,
    types::{Price, Quantity},
};
use ustr::Ustr;

let order = self.order().limit_if_touched(
    InstrumentId::from("BTCUSDT-PERP.BINANCE"),
    OrderSide::Buy,
    Quantity::from(5),
    Price::from("30100"),
    Price::from("30150"),
    Some(TriggerType::LastPrice), // optional (default DEFAULT)
    Some(TimeInForce::Gtd),       // optional (default GTC)
    Some(UnixNanos::from(1_654_516_800_000_000_000_u64)), // 2022-06-06T12:00:00 UTC
    Some(true),                   // post_only (default false)
    Some(false),                  // reduce_only (default false)
    None,                         // quote_quantity (default false)
    None,                         // display_qty
    None,                         // emulation_trigger
    None,                         // trigger_instrument_id
    None,                         // exec_algorithm_id
    None,                         // exec_algorithm_params
    Some(vec![Ustr::from("TAKE_PROFIT")]), // tags
    None,                         // client_order_id
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
from vibe_trader.model.orders import LimitIfTouchedOrder

order: LimitIfTouchedOrder = self.order_factory.limit_if_touched(
    instrument_id=InstrumentId.from_str("BTCUSDT-PERP.BINANCE"),
    order_side=OrderSide.BUY,
    quantity=Quantity.from_int(5),
    price=Price.from_str("30_100"),
    trigger_price=Price.from_str("30_150"),
    trigger_type=TriggerType.LAST_PRICE,  # <-- optional (default DEFAULT)
    time_in_force=TimeInForce.GTD,  # <-- optional (default GTC)
    expire_time=pd.Timestamp("2022-06-06T12:00"),
    post_only=True,  # <-- optional (default False)
    reduce_only=False,  # <-- optional (default False)
    tags=["TAKE_PROFIT"],  # <-- optional (default None)
)
```

更多详情请参阅 [`LimitIfTouchedOrder` API 参考](/docs/python-api-latest/model/orders.html#vibe_trader.model.orders.limit_if_touched.LimitIfTouchedOrder)。

## 相关指南

- [订单](index.md#trigger-type) - 触发类型及其他执行指令。
- [模拟订单](emulated.md) - 在没有原生支持的交易场所模拟条件订单。
- [执行](../execution.md) - 订单如何到达交易场所及如何处理成交。
