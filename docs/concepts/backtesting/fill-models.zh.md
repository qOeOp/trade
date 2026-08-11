# 成交模型

历史数据无法反映模拟订单原本会如何与其他市场参与者交互。成交模型控制 VibeTrader
对限价单成交资格、单个最小价位滑点以及可选合成流动性所作的假设。

## 不同订单簿类型下的行为

使用 L2 或 L3 数据时，记录的订单簿会提供价格层级和数量。撮合引擎会依次遍历
这些层级，而 `prob_fill_on_limit` 可用于模拟价格被触及时限价单是否成交。
`prob_slippage` 不适用，因为价格影响由订单簿本身决定。

对于 L1 订单簿，包括根据报价、逐笔成交或 K 线更新的订单簿：

- `prob_fill_on_limit` 控制限价单价格被触及时该订单是否成交。
- 每笔成交都会评估 `prob_slippage`，无论订单类型，也无论其是提供还是获取流动性。
- 若滑点随机抽样命中，成交价会沿订单不利方向移动一个最小价位。
- 模型可提供合成 L2 订单簿，以表示最优买价和最优卖价以外的流动性。

例如，使用 `prob_slippage=0.5` 时，每笔 BUY 成交都有 50% 的概率向上移动一个最小价位。
当一次运行必须复现模型的随机抽样结果时，请设置 `random_seed`。

如果交易场所未指定成交模型，它会使用 `DefaultFillModel`，其中
`prob_fill_on_limit=1.0` 且 `prob_slippage=0.0`。因此，该模型会将价格被触及的限价单
视为具备成交资格，而 L1 成交默认不会受到概率性单个最小价位滑点的影响。这并
不会禁用撮合引擎针对具备资格的市价型订单所采用的独立剩余成交规则。

:::warning
成交后，历史订单簿数据仍保持不变。使用
`liquidity_consumption=False` 时，同一档位显示的数量在一次迭代中可以支持多笔模拟订单。
设置 `liquidity_consumption=True`，可在新数据到达前跟踪每个层级已消耗的数量。
请参阅[订单簿不可变性](fill-prices-and-matching.md#order-book-immutability)。
:::

## 可用模型

| 模型                         | 流动性行为                                           |
| ---------------------------- | ---------------------------------------------------- |
| `DefaultFillModel`           | 使用撮合引擎记录的订单簿。                           |
| `BestPriceFillModel`         | 在最优买价和最优卖价提供无限数量。                   |
| `OneTickSlippageFillModel`   | 在最优价格以外一个最小价位处提供无限数量。           |
| `ProbabilisticFillModel`     | 选择最优价格或差一个最小价位的价格。                 |
| `TwoTierFillModel`           | 在最优价位放置 10 个单位，其余放在差一个最小价位处。 |
| `ThreeTierFillModel`         | 在三个层级分别放置 50、30 和 20 个单位。             |
| `LimitOrderPartialFillModel` | 在最优价位放置 5 个单位，其余放在差一个最小价位处。  |
| `SizeAwareFillModel`         | 当订单规模为 10 个单位时改变订单簿形态。             |
| `CompetitionAwareFillModel`  | 在最优价位提供 1,000 个单位中的可配置比例。          |
| `VolumeSensitiveFillModel`   | 在最优价位放置其内部成交量的 25%。                   |
| `MarketHoursFillModel`       | 使用正常的合成价差或加宽一个最小价位的合成价差。     |

各层级数量是以金融工具数量单位表示的模型常量。使用分层模型前，请确认这些数量
适合该金融工具的规模。

`CompetitionAwareFillModel` 接受 `[0.0, 1.0]` 范围内的 `liquidity_factor` 值，默认值为 `0.3`，
并将计算出的数量限制为至少一个金融工具数量单位。

当前 Python 绑定并未公开 `VolumeSensitiveFillModel` 或
`MarketHoursFillModel` 的状态设置方法。通过 Python 使用时，它们分别保留 1,000 个近期
成交量单位和正常流动性模式的初始值。

## 配置

将内置模型对象直接传给 `BacktestVenueConfig`：

```python
from vibe_trader.config import BacktestVenueConfig
from vibe_trader.execution import DefaultFillModel
from vibe_trader.model import AccountType
from vibe_trader.model import BookType
from vibe_trader.model import OmsType

venue = BacktestVenueConfig(
    name="SIM",
    oms_type=OmsType.NETTING,
    account_type=AccountType.CASH,
    book_type=BookType.L1_MBP,
    starting_balances=["100_000 USD"],
    fill_model=DefaultFillModel(
        prob_fill_on_limit=0.2,
        prob_slippage=0.5,
        random_seed=42,
    ),
)
```

合成订单簿模型使用相同的构造函数参数：

```python
from vibe_trader.execution import ThreeTierFillModel

venue = BacktestVenueConfig(
    name="SIM",
    oms_type=OmsType.NETTING,
    account_type=AccountType.CASH,
    book_type=BookType.L1_MBP,
    starting_balances=["100_000 USD"],
    fill_model=ThreeTierFillModel(
        prob_fill_on_limit=1.0,
        prob_slippage=0.0,
        random_seed=42,
    ),
)
```

当前高层交易场所配置接受内置成交模型，但不会从导入路径配置对象加载成交模型。

底层 `BacktestEngine.add_venue()` 方法也接受自定义 Python 对象。该对象必须实现：

- `is_limit_filled() -> bool`
- `is_slipped() -> bool`

它还可以实现：

- `fill_limit_inside_spread() -> bool`
- `get_orderbook_for_fill_simulation(instrument, order, best_bid, best_ask) -> OrderBook | None`

继承 `vibe_trader.execution.FillModel` 可获得这些方法的默认实现。
此自定义对象协议仅适用于底层引擎。

## 概率参数

### `prob_fill_on_limit`（默认值：`1.0`）

此值控制市场触及但未越过限价单价格时，该限价单是否成交：

- `0.0`：价格被触及时从不成交。
- `0.5`：符合条件的触价平均有一半会成交。
- `1.0`：价格被触及时始终成交。

越过限价是另一项独立的撮合条件。有关显式队列成交量跟踪，请参阅
[队列位置跟踪](trade-execution.md#queue-position-tracking)。

### `prob_slippage`（默认值：`0.0`）

对于 L1 订单簿，此值控制每笔成交是否产生一个最小价位的不利变动：

- `0.0`：从不添加模型滑点。
- `0.5`：平均一半的成交会增加一个最小价位的滑点。
- `1.0`：每笔成交都会增加一个最小价位的滑点。

该随机抽样同时适用于提供流动性（maker）和获取流动性（taker）的成交，但不适用于
L2 或 L3 订单簿。

## 合成订单簿

在确定成交前，撮合引擎会向模型请求可选的合成订单簿。如果模型返回订单簿，引擎
会按其中的层级成交。如果模型返回 `None`，引擎会使用记录的订单簿。

按层级进行的 `liquidity_consumption` 跟踪不适用于合成模型订单簿。自定义模型
必须在其返回的订单簿中体现所需的消耗行为。
