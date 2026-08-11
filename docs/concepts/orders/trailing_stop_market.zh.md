# Trailing-Stop-Market

`FIX OrdType <40>=3`（Stop）+ 追踪挂钩

*Trailing-Stop-Market* 是一种条件订单，其止损触发价格与指定市场价格保持固定偏移并随之移动。
触发后，会立即挂出 *Market* 订单。

## 使用场景

当希望锁定收益并让持仓继续运行时，请使用 *Trailing-Stop-Market* 订单：触发价格以固定偏移
追踪有利方向的价格变化，仅在反转时触发，无需手动调整。其优势是动态保护，加上触发后的执行确定性。
代价在于如何选择偏移量：偏移过窄会增加反复触发风险，过宽则会回吐更多利润；
而且市场急剧反转时，市价成交仍可能产生滑点。

## 示例

以下示例在 Binance Futures 交易所创建一笔 *Trailing-Stop-Market* 订单，
卖出 10 张以 COIN_M 计保证金的 ETHUSD-PERP 永续期货合约：订单在 5,000 USD 激活，
随后与当前最新成交价保持 1%（以基点表示）的偏移并追踪移动：

```rust tab="Rust"
use vibe_model::{
    enums::{OrderSide, TimeInForce, TrailingOffsetType, TriggerType},
    identifiers::InstrumentId,
    types::{Price, Quantity},
};
use rust_decimal::Decimal;
use ustr::Ustr;

let order = self.order().trailing_stop_market(
    InstrumentId::from("ETHUSD-PERP.BINANCE"),
    OrderSide::Sell,
    Quantity::from(10),
    Decimal::from(100),                    // trailing_offset
    Some(TrailingOffsetType::BasisPoints), // optional (default PRICE)
    Some(Price::from("5000")),             // activation_price
    None,                                  // trigger_price (materializes from the offset on the first trail)
    Some(TriggerType::LastPrice),          // optional (default DEFAULT)
    Some(TimeInForce::Gtc),                // optional (default GTC)
    None,                                  // expire_time
    Some(true),                            // reduce_only (default false)
    None,                                  // quote_quantity (default false)
    None,                                  // display_qty
    None,                                  // emulation_trigger
    None,                                  // trigger_instrument_id
    None,                                  // exec_algorithm_id
    None,                                  // exec_algorithm_params
    Some(vec![Ustr::from("TRAILING_STOP-1")]), // tags
    None,                                  // client_order_id
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
from vibe_trader.model.orders import TrailingStopMarketOrder

order: TrailingStopMarketOrder = self.order_factory.trailing_stop_market(
    instrument_id=InstrumentId.from_str("ETHUSD-PERP.BINANCE"),
    order_side=OrderSide.SELL,
    quantity=Quantity.from_int(10),
    activation_price=Price.from_str("5_000"),
    trigger_type=TriggerType.LAST_PRICE,  # <-- optional (default DEFAULT)
    trailing_offset=Decimal(100),
    trailing_offset_type=TrailingOffsetType.BASIS_POINTS,
    time_in_force=TimeInForce.GTC,  # <-- optional (default GTC)
    expire_time=None,  # <-- optional (default None)
    reduce_only=True,  # <-- optional (default False)
    tags=["TRAILING_STOP-1"],  # <-- optional (default None)
)
```

如果同时省略 `activation_price` 和 `trigger_price`，订单会在当前市场立即激活，
其触发价格会在首次更新时根据 `trailing_offset` 形成。

更多详情请参阅 [`TrailingStopMarketOrder` API 参考](/docs/python-api-latest/model/orders.html#vibe_trader.model.orders.trailing_stop_market.TrailingStopMarketOrder)。

## 相关指南

- [订单](index.md#trigger-offset-type) - 触发类型与追踪偏移类型。
- [模拟订单](emulated.md) - 在没有原生支持的交易场所模拟追踪止损单。
- [执行](../execution.md) - 订单如何到达交易场所及如何处理成交。
