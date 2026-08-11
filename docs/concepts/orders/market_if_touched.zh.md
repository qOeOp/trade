# Market-If-Touched

`FIX OrdType <40>=J`（Market If Touched）

*Market-If-Touched* 是一种条件订单，触发后会立即挂出 *Market* 订单。这种订单类型常用于
以止损价格建立新持仓，或为现有持仓止盈：针对多头持仓使用 SELL 订单，针对空头持仓使用 BUY 订单。

## 使用场景

当目标价格被触及时希望确保执行，可使用 *Market-If-Touched* 订单，例如在价格回调到某一价位时入场，
或在目标价位止盈。其行为类似于方向相反的止损单（在当前市场价下方买入或上方卖出），
触发后转换为 *Market* 订单。代价与任何市价执行相同：触及价格并非成交价格，
在快速变化的市场中成交可能产生滑点。

## 示例

以下示例在 Binance Futures 交易所创建一笔 *Market-If-Touched* 订单，
在触发价格达到 10,000 USDT 时卖出 10 张 ETHUSDT-PERP 永续期货合约，撤销前一直有效：

```rust tab="Rust"
use vibe_model::{
    enums::{OrderSide, TimeInForce, TriggerType},
    identifiers::InstrumentId,
    types::{Price, Quantity},
};
use ustr::Ustr;

let order = self.order().market_if_touched(
    InstrumentId::from("ETHUSDT-PERP.BINANCE"),
    OrderSide::Sell,
    Quantity::from(10),
    Price::from("10000.00"),
    Some(TriggerType::LastPrice),    // optional (default DEFAULT)
    Some(TimeInForce::Gtc),          // optional (default GTC)
    None,                            // expire_time
    Some(false),                     // reduce_only (default false)
    None,                            // quote_quantity (default false)
    None,                            // emulation_trigger
    None,                            // trigger_instrument_id
    None,                            // exec_algorithm_id
    None,                            // exec_algorithm_params
    Some(vec![Ustr::from("ENTRY")]), // tags
    None,                            // client_order_id
);
```

```python tab="Python"
from vibe_trader.model.enums import OrderSide
from vibe_trader.model.enums import TimeInForce
from vibe_trader.model.enums import TriggerType
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model.orders import MarketIfTouchedOrder

order: MarketIfTouchedOrder = self.order_factory.market_if_touched(
    instrument_id=InstrumentId.from_str("ETHUSDT-PERP.BINANCE"),
    order_side=OrderSide.SELL,
    quantity=Quantity.from_int(10),
    trigger_price=Price.from_str("10_000.00"),
    trigger_type=TriggerType.LAST_PRICE,  # <-- optional (default DEFAULT)
    time_in_force=TimeInForce.GTC,  # <-- optional (default GTC)
    expire_time=None,  # <-- optional (default None)
    reduce_only=False,  # <-- optional (default False)
    tags=["ENTRY"],  # <-- optional (default None)
)
```

更多详情请参阅 [`MarketIfTouchedOrder` API 参考](/docs/python-api-latest/model/orders.html#vibe_trader.model.orders.market_if_touched.MarketIfTouchedOrder)。

## 相关指南

- [订单](index.md#trigger-type) - 触发类型及其他执行指令。
- [模拟订单](emulated.md) - 在没有原生支持的交易场所模拟条件订单。
- [执行](../execution.md) - 订单如何到达交易场所及如何处理成交。
