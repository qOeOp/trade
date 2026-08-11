# Limit

`FIX OrdType <40>=2`

*Limit* 订单以指定价格挂入限价订单簿，并且只会按该价格或更优价格执行。

## 使用场景

当需要控制执行价格，并可选择提供流动性时，请使用 *Limit* 订单，例如做市、
在选定价位分批建仓或减仓，或通过 `post_only` 获取挂单方费率等级。其优势是成交价格
绝不会差于指定价格。代价是无法保证执行：如果市场始终未触及或停留在指定价格，
订单可能一直无法成交，也可能仅部分成交。

## 示例

以下示例在 Binance Futures 加密货币交易所创建一笔 *Limit* 订单，以做市商身份按 5,000 USDT
的限价卖出 20 张 ETHUSDT-PERP 永续期货合约。

```rust tab="Rust"
use vibe_model::{
    enums::{OrderSide, TimeInForce},
    identifiers::InstrumentId,
    types::{Price, Quantity},
};

let order = self.order().limit(
    InstrumentId::from("ETHUSDT-PERP.BINANCE"),
    OrderSide::Sell,
    Quantity::from(20),
    Price::from("5000.00"),
    Some(TimeInForce::Gtc), // optional (default GTC)
    None,                   // expire_time
    Some(true),             // post_only (default false)
    Some(false),            // reduce_only (default false)
    None,                   // quote_quantity (default false)
    None,                   // display_qty (default full display)
    None,                   // emulation_trigger
    None,                   // trigger_instrument_id
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
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model.orders import LimitOrder

order: LimitOrder = self.order_factory.limit(
    instrument_id=InstrumentId.from_str("ETHUSDT-PERP.BINANCE"),
    order_side=OrderSide.SELL,
    quantity=Quantity.from_int(20),
    price=Price.from_str("5_000.00"),
    time_in_force=TimeInForce.GTC,  # <-- optional (default GTC)
    expire_time=None,  # <-- optional (default None)
    post_only=True,  # <-- optional (default False)
    reduce_only=False,  # <-- optional (default False)
    display_qty=None,  # <-- optional (default None which indicates full display)
    tags=None,  # <-- optional (default None)
)
```

更多详情请参阅 [`LimitOrder` API 参考](/docs/python-api-latest/model/orders.html#vibe_trader.model.orders.limit.LimitOrder)。

## 相关指南

- [订单](index.md) - 订单概念、执行指令与订单工厂。
- [模拟订单](emulated.md) - 模拟 *Limit* 订单，并在触发时以 *Market* 订单形式释放。
- [执行](../execution.md) - 订单如何到达交易场所及如何处理成交。
