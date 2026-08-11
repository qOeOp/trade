# 高级订单

阅读以下指南时，应结合经纪商或交易场所针对这些订单类型、列表/分组和执行指令提供的具体文档
（例如 Interactive Brokers 的相关文档）。

## 订单列表

或有订单组合或更大批量的订单可以使用共同的 `order_list_id` 分组到一个列表中。
列表内的订单可能彼此存在或不存在或有关系，这取决于订单本身的构造方式，以及订单路由到的
具体交易场所。

列表中的所有订单必须属于同一交易场所。订单可以指向该交易场所的不同金融工具
（例如配对、日历价差、多腿组合的各条腿）；目标交易场所是否接受混合金融工具批次，
取决于交易场所。列表的 `instrument_id` 取自第一笔订单，作为代表值；需要逐订单确定金融工具的
下游消费者会分别解析每笔订单。

混合金融工具列表的注意事项：

- 交易前的逐订单检查（价格/数量精度、GTD）使用每笔订单自己的金融工具。
- 累计风险检查（可用余额、最小/最大名义价值、减少持仓的敞口、逐订单市场数据查询）
  使用列表的代表金融工具。对于混合列表，这只是单一金融工具的边界，而非逐金融工具的准确结果。
- `cache.order_lists(instrument_id=...)` 等缓存查询根据代表 `instrument_id` 进行过滤；
  包含其他金融工具的列表不会匹配针对这些其他金融工具的查询。
- 提供 `position_id` 时，执行引擎会拒绝混合金融工具列表
  （无论 OMS 如何，一项持仓都只属于一个金融工具）。
- 适配器的 `submit_order_list` 实现各不相同。有些实现会逐腿遍历订单，并针对交易场所 API
  解析每笔订单自己的 `instrument_id`；另一些实现仍围绕列表的代表 `instrument_id`
  构建批量请求，因而会错误路由第一笔以外的订单。请将混合金融工具列表视为适配器专用功能；
  依赖它之前，应验证目标适配器的行为。目前，在用户空间处理多腿路由的回测和自定义策略代码
  仍是最安全的路径。

## 或有类型

- **OTO（One-Triggers-Other）** - 父订单执行后，会自动挂出一个或多个子订单。
  - *完全触发模型*：**只有父订单完全成交后**，才会释放子订单。大多数零售股票/期权经纪商
    （例如 Schwab、Fidelity、TD Ameritrade）以及许多现货加密货币交易场所
    （Binance、Coinbase）通常采用此模型。
  - *部分触发模型*：子订单会**按每次部分成交的比例释放**。Interactive Brokers 等专业级平台、
    大多数期货/外汇 OMS 以及 Kraken Pro 采用此模型。

- **OCO（One-Cancels-Other）** - 两个或更多关联的活动订单，其中一笔执行时会取消其余订单。

- **OUO（One-Updates-Other）** - 两个或更多关联的活动订单，其中一笔执行时会减少其余订单的未成交数量。

:::info
这些或有类型对应 ContingencyType FIX 标签 <1385> <https://www.onixs.biz/fix-dictionary/5.0.sp2/tagnum_1385.html>。
:::

### One-Triggers-Other（OTO）

OTO 订单包括两部分：

1. **父订单** - 立即提交到撮合引擎。
2. **子订单** - 在满足触发条件前保持在*簿外*。

#### 触发模型

| 触发模型     | 何时释放子订单？                                                                 |
| ------------ | -------------------------------------------------------------------------------- |
| **完全触发** | 父订单的累计成交数量等于其原始数量时（即已*完全*成交）。                         |
| **部分触发** | 父订单每次部分执行时立即释放；子订单数量与已执行数量相同，并随后续成交继续增加。 |

:::info
VibeTrader 的默认回测交易场所对 OTO 订单使用*部分触发模型*。
若要选择*完全触发模式*，请为交易场所设置 `oto_trigger_mode="FULL"`（例如通过 `BacktestVenueConfig`）。
:::

**在生产环境中使用部分触发：**

如果策略需要完全触发语义，但交易场所或回测引擎使用部分触发：

1. 提交不带或有子订单的父订单。
2. 订阅父订单的 `OrderFilled` 事件。
3. 仅在确认父订单完全成交后，提交子订单（止损、止盈）。
4. 使用 `order.is_closed` 和 `order.filled_qty == order.quantity` 验证完全成交。

> **为何这种区别很重要**
> *完全触发*会留下风险窗口：在剩余数量成交之前，任何已部分成交的持仓都没有保护性退出订单。
> *部分触发*通过确保每个已执行批次立即具有其关联的止损/限价订单来缓解该风险，代价是产生更多订单流量与更新。

OTO 订单可以使用交易场所支持的任何资产类型（例如股票入场配合期权对冲、
期货入场配合 OCO 括号订单、加密货币现货入场配合止盈/止损）。

| 交易场所/适配器 ID                           | 资产类别               | 子订单触发规则                      | 实务说明                                       |
| -------------------------------------------- | ---------------------- | ----------------------------------- | ---------------------------------------------- |
| Binance / Binance Futures（`BINANCE`）       | 现货、永续期货         | **部分或完全** - 首次成交时触发。   | OTOCO/止盈止损子订单立即出现；监控保证金占用。 |
| Bybit Spot（`BYBIT`）                        | 现货                   | **完全** - 完成后挂出子订单。       | 仅在限价订单完全成交后激活预设止盈止损。       |
| Bybit Perps（`BYBIT`）                       | 永续期货               | **部分和完全** - 可配置。           | "部分持仓"模式随成交到达调整止盈止损数量。     |
| Kraken Futures（`KRAKEN`）                   | 期货与永续合约         | **部分和完全** - 自动。             | 子订单数量匹配每次部分执行。                   |
| OKX（`OKX`）                                 | 现货、期货、期权       | **完全** - 附带的止损订单等待成交。 | 可以单独添加持仓级止盈止损。                   |
| Interactive Brokers（`INTERACTIVE_BROKERS`） | 股票、期权、外汇、期货 | **可配置** - OCA 可以按比例调整。   | `OcaType 2/3` 会减少剩余子订单数量。           |
| dYdX v4（`DYDX`）                            | 永续期货（DEX）        | 链上条件（数量精确）。              | 止盈止损由预言机价格触发；不适用部分成交。     |
| Polymarket（`POLYMARKET`）                   | 预测市场（DEX）        | 不适用。                            | 高级或有逻辑完全由策略层处理。                 |
| Betfair（`BETFAIR`）                         | 体育博彩               | 不适用。                            | 高级或有逻辑完全由策略层处理。                 |

### One-Cancels-Other（OCO）

OCO 订单是一组关联订单，其中**任意**订单执行（完全或部分）都会触发对其他订单的尽力取消。
两笔订单同时处于活动状态；一旦其中一笔开始成交，交易场所会尝试取消其余订单的未执行部分。

### One-Updates-Other（OUO）

OUO 订单是一组关联订单，其中一笔订单执行时，会立即*减少*其他订单的未成交数量。
两笔订单同时处于活动状态，每次部分执行都会尽力按比例更新其对等订单的剩余数量。

## 或有订单校验

使用或有订单（OTO、OCO、OUO）时，请注意以下校验规则和错误情形：

**订单列表要求：**

- 或有组内的所有订单必须共享同一个 `order_list_id`。
- 父订单必须早于子订单或与子订单同时提交。
- 子订单通过 `parent_order_id` 引用其父订单。

**修改规则：**

- 父订单通常可以在等待期间修改，但修改可能级联到子订单。
- 大多数交易场所允许单独修改子订单，但应检查交易场所特有的行为。
- 取消父订单会取消所有关联的子订单。

**常见错误情形：**

| 情形                         | 系统行为                           |
| ---------------------------- | ---------------------------------- |
| 子订单引用不存在的父订单     | 以 `INVALID_ORDER` 错误否决订单    |
| 父订单在子订单触发前取消     | 自动取消子订单                     |
| OCO 同级订单在取消传播前成交 | 承认部分成交，取消剩余数量         |
| 括号订单保证金不足           | 入场订单可能执行，子订单分别被拒绝 |

:::warning
始终在策略中处理 `OrderDenied` 和 `OrderRejected` 事件，尤其是使用或有订单时，
因为部分失败可能使持仓失去保护。
:::

## 括号订单

括号订单是一种高级订单类型，允许交易者同时为持仓设置止盈和止损价位。它会挂出一笔父订单
（入场订单）和两笔子订单：一笔止盈 `LIMIT` 订单和一笔止损 `STOP_MARKET` 订单。
父订单执行后，系统会挂出子订单。如果市场向有利方向移动，止盈订单会关闭持仓；
如果市场向不利方向移动，止损订单会限制损失。

可以使用 [OrderFactory](/docs/python-api-latest/common.html#vibe_trader.common.factories.OrderFactory)
轻松创建括号订单；它支持多种订单类型、参数和指令。

以下示例为一笔买入 10 张 ETHUSDT-PERP 合约的 *Market* 入场订单设置括号：
止盈 *Limit* 价格为 3,300 USDT，止损 *Stop-Market* 在 2,800 USDT 触发。入场订单默认为
`MARKET`，止盈订单默认为 `LIMIT`，止损订单默认为 `STOP_MARKET`；止盈腿和止损腿均为
`reduce_only`，并使用 `OUO` 或有关系关联：

```rust tab="Rust"
use vibe_model::{
    enums::OrderSide,
    identifiers::InstrumentId,
    types::{Price, Quantity},
};

// `bracket()` returns a `bon` builder; finalize with `.call()`.
// The result is a `Vec<OrderAny>` ordered as [entry, stop-loss, take-profit].
let orders = self
    .order()
    .bracket()
    .instrument_id(InstrumentId::from("ETHUSDT-PERP.BINANCE"))
    .order_side(OrderSide::Buy)
    .quantity(Quantity::from(10))
    .tp_price(Price::from("3300.00"))         // take-profit LIMIT (default)
    .sl_trigger_price(Price::from("2800.00")) // stop-loss STOP_MARKET (default)
    .call();
```

```python tab="Python"
from vibe_trader.model.enums import OrderSide
from vibe_trader.model import InstrumentId
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model.orders import OrderList

bracket: OrderList = self.order_factory.bracket(
    instrument_id=InstrumentId.from_str("ETHUSDT-PERP.BINANCE"),
    order_side=OrderSide.BUY,
    quantity=Quantity.from_int(10),
    tp_price=Price.from_str("3300.00"),  # <-- take-profit LIMIT (default)
    sl_trigger_price=Price.from_str("2800.00"),  # <-- stop-loss STOP_MARKET (default)
)
```

:::warning
应注意持仓的保证金要求，因为为持仓设置括号订单会占用更多订单保证金。
:::

## 相关指南

- [订单](index.md) - 订单概念、执行指令与订单工厂。
- [模拟订单](emulated.md) - 在没有原生支持的交易场所模拟订单类型。
- [执行](../execution.md) - 订单执行与成交处理。
