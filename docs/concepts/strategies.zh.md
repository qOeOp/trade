# 策略

策略继承 `Strategy` 类，并实现自身逻辑所需的方法。

**能力**：

- `DataActor` 的全部能力。
- 订单管理。

**与参与者的关系**：
`Strategy` 类继承自 `DataActor`，因此策略既能使用数据参与者的全部功能，也具备订单管理能力。

:::tip
建议先阅读[参与者](actors.md)指南，再开始开发策略。
:::

策略可以添加到 Vibe 系统的任意[环境上下文](architecture.md#environment-contexts)中。系统启动后，策略会立即按照自身逻辑发送命令和接收事件。

利用数据接入、事件处理和订单管理这些基础能力（下文将详细介绍），可以构建方向性、动量、再平衡、配对交易、做市等各种策略。

所有可用方法请参阅 [`Strategy` API 参考](/docs/python-api-latest/trading.html)。

Vibe 交易策略主要由两部分组成：

- 策略实现本身，通过继承 `Strategy` 类定义。
- *可选的*策略配置，通过继承 `StrategyConfig` 类定义。

:::tip
策略定义完成后，同一份源代码可同时用于回测和实盘交易。
:::

策略的主要能力包括：

- 请求历史数据。
- 订阅实盘数据源。
- 设置时间提醒或计时器。
- 访问缓存。
- 访问投资组合。
- 创建和管理订单与持仓。

:::info Rust 实现
Rust 策略作者实现所需的 `DataActor` 回调，并使用 `vibe_strategy!` 生成 `Strategy` 实现，随后在 `self` 上调用 `clock()`、`cache()`、`order()` 和 `portfolio()` 等门面方法。`DataActorNative` 只提供对运行时连接和参与者核心状态的原生访问；`StrategyNative` 则公开借用的策略状态，例如订单工厂、订单管理器和投资组合访问。只有同一二进制中的高性能路径或内部运行时连接才应导入它们。
:::

## 策略实现

交易策略继承自 `Strategy`，因此必须定义构造函数。至少需要初始化基类：

```python
from vibe_trader.trading import Strategy


class MyStrategy(Strategy):
    def __init__(self) -> None:
        super().__init__()  # <-- the superclass must be called to initialize the strategy
```

随后可按需实现处理程序，根据状态转换和事件执行操作。

:::warning
不要在 `__init__` 构造函数中（即注册之前）调用 `clock`、`logger` 等组件，因为系统时钟和日志子系统此时尚未初始化。
:::

### 处理程序

处理程序是 `Strategy` 类中根据事件或状态变化执行操作的方法。这些方法使用 `on_*` 前缀；策略可以按需实现其中任意方法。

相似事件类型设有多个处理程序，以便控制处理粒度。可以使用专用处理程序响应特定事件，也可以使用通用处理程序处理一组相关事件（通常在其中使用 switch 逻辑）。系统会按从最具体到最通用的顺序依次调用处理程序。

#### 生命周期操作

生命周期状态变化会触发以下处理程序。建议：

- 使用 `on_start` 方法初始化策略（例如获取金融工具、订阅数据）。
- 使用 `on_stop` 方法执行清理任务（例如取消未结订单、平掉未平持仓、取消数据订阅）。

```python
def on_start(self) -> None:
def on_stop(self) -> None:
def on_resume(self) -> None:
def on_reset(self) -> None:
def on_dispose(self) -> None:
def on_degrade(self) -> None:
def on_fault(self) -> None:
def on_save(self) -> dict[str, bytes]:  # Returns user-defined dictionary of state to be saved
def on_load(self, state: dict[str, bytes]) -> None:
```

#### 数据处理

以下处理程序接收数据更新，包括内置市场数据和用户定义的自定义数据。

```python
from collections.abc import Sequence
from typing import Any

from vibe_trader.common import Signal
from vibe_trader.model import CustomData
from vibe_trader.model import OrderBook
from vibe_trader.model import OrderBookDelta
from vibe_trader.model import Bar
from vibe_trader.model import FundingRateUpdate
from vibe_trader.model import QuoteTick
from vibe_trader.model import TradeTick
from vibe_trader.model import OrderBookDeltas
from vibe_trader.model import OrderBookDepth10
from vibe_trader.model import InstrumentClose
from vibe_trader.model import InstrumentStatus
from vibe_trader.model import OptionChainSlice
from vibe_trader.model import OptionGreeks
def on_book_deltas(self, deltas: OrderBookDeltas) -> None:
def on_book(self, order_book: OrderBook) -> None:
def on_quote(self, tick: QuoteTick) -> None:
def on_trade(self, tick: TradeTick) -> None:
def on_bar(self, bar: Bar) -> None:
def on_instrument(self, instrument: Any) -> None:
def on_instrument_status(self, data: InstrumentStatus) -> None:
def on_instrument_close(self, data: InstrumentClose) -> None:
def on_option_greeks(self, greeks: OptionGreeks) -> None:
def on_option_chain(self, chain: OptionChainSlice) -> None:
def on_historical_data(self, data: CustomData | Sequence[CustomData]) -> None:
def on_historical_book_deltas(self, deltas: Sequence[OrderBookDelta]) -> None:
def on_historical_book_depth(self, depths: Sequence[OrderBookDepth10]) -> None:
def on_historical_quotes(self, quotes: Sequence[QuoteTick]) -> None:
def on_historical_trades(self, trades: Sequence[TradeTick]) -> None:
def on_historical_funding_rates(self, rates: Sequence[FundingRateUpdate]) -> None:
def on_historical_bars(self, bars: Sequence[Bar]) -> None:
def on_data(self, data: CustomData) -> None:
def on_signal(self, signal: Signal) -> None:
```

#### 订单管理

以下处理程序接收订单相关事件。`OrderEvent` 类型消息会按以下顺序传给处理程序：

1. 专用处理程序（例如 `on_order_accepted`、`on_order_rejected` 等）
2. `on_order_event(...)`

```python
from vibe_trader.model.events import OrderAccepted
from vibe_trader.model.events import OrderCanceled
from vibe_trader.model.events import OrderCancelRejected
from vibe_trader.model.events import OrderDenied
from vibe_trader.model.events import OrderEmulated
from vibe_trader.model.events import OrderEvent
from vibe_trader.model.events import OrderExpired
from vibe_trader.model.events import OrderFilled
from vibe_trader.model.events import OrderInitialized
from vibe_trader.model.events import OrderModifyRejected
from vibe_trader.model.events import OrderPendingCancel
from vibe_trader.model.events import OrderPendingUpdate
from vibe_trader.model.events import OrderRejected
from vibe_trader.model.events import OrderReleased
from vibe_trader.model.events import OrderSubmitted
from vibe_trader.model.events import OrderTriggered
from vibe_trader.model.events import OrderUpdated

def on_order_initialized(self, event: OrderInitialized) -> None:
def on_order_denied(self, event: OrderDenied) -> None:
def on_order_emulated(self, event: OrderEmulated) -> None:
def on_order_released(self, event: OrderReleased) -> None:
def on_order_submitted(self, event: OrderSubmitted) -> None:
def on_order_rejected(self, event: OrderRejected) -> None:
def on_order_accepted(self, event: OrderAccepted) -> None:
def on_order_canceled(self, event: OrderCanceled) -> None:
def on_order_expired(self, event: OrderExpired) -> None:
def on_order_triggered(self, event: OrderTriggered) -> None:
def on_order_pending_update(self, event: OrderPendingUpdate) -> None:
def on_order_pending_cancel(self, event: OrderPendingCancel) -> None:
def on_order_modify_rejected(self, event: OrderModifyRejected) -> None:
def on_order_cancel_rejected(self, event: OrderCancelRejected) -> None:
def on_order_updated(self, event: OrderUpdated) -> None:
def on_order_filled(self, event: OrderFilled) -> None:
def on_order_event(self, event: OrderEvent) -> None:  # All order event messages are eventually passed to this handler
```

#### 持仓管理

以下处理程序接收持仓相关事件。`PositionEvent` 类型消息会按以下顺序传给处理程序：

1. 专用处理程序（例如 `on_position_opened`、`on_position_changed` 等）
2. `on_position_event(...)`

```python
from vibe_trader.model.events import PositionChanged
from vibe_trader.model.events import PositionClosed
from vibe_trader.model.events import PositionEvent
from vibe_trader.model.events import PositionOpened

def on_position_opened(self, event: PositionOpened) -> None:
def on_position_changed(self, event: PositionChanged) -> None:
def on_position_closed(self, event: PositionClosed) -> None:
def on_position_event(self, event: PositionEvent) -> None:  # All position event messages are eventually passed to this handler
```

计时器事件使用 `on_time_event()`，汇总订单事件使用 `on_order_event()`，汇总持仓事件使用 `on_position_event()`。Python API 不公开通用 `on_event()` 钩子。

#### 处理程序示例

以下示例展示典型的 `on_start` 处理程序实现，取自 EMA 交叉策略示例。可以看到：

- 注册指标以接收 K 线更新。
- 请求历史数据以预热指标。
- 订阅实盘数据。

缓存检查对实盘交易很重要。直接订阅以金融工具已由金融工具提供程序配置加载，或已由更早的金融工具请求加载为前提。

```python
def on_start(self) -> None:
    """
    Actions to be performed on strategy start.
    """
    self.instrument = self.cache.instrument(self.instrument_id)
    if self.instrument is None:
        self.log.error(f"Could not find instrument for {self.instrument_id}")
        self.stop()  # Transitions strategy to STOPPED state
        return

    # Register the indicators for updating
    self.register_indicator_for_bars(self.bar_type, self.fast_ema)
    self.register_indicator_for_bars(self.bar_type, self.slow_ema)

    # Get historical data and subscribe to live data
    self.request_bars(self.bar_type)
    self.subscribe_bars(self.bar_type)
    self.subscribe_quotes(self.instrument_id)
```

### 时钟和计时器

策略可以访问 `Clock`。它提供多种方法来创建不同形式的时间戳，也可以设置时间提醒或计时器来触发 `TimeEvent`。

所有可用方法请参阅 [`Clock` API 参考](/docs/python-api-latest/common.html)。

#### 当前时间戳

获取当前时间戳的方法有很多，以下列出两种常用方式。

获取带时区信息、类型为 `pd.Timestamp` 的当前 UTC 时间戳：

```python
import pandas as pd


now: pd.Timestamp = self.clock.utc_now()
```

获取从 UNIX 纪元开始、以纳秒表示的当前 UTC 时间戳：

```python
unix_nanos: int = self.clock.timestamp_ns()
```

#### 时间提醒

可以设置时间提醒，使 `TimeEvent` 在指定提醒时间分派给 `on_time_event` 处理程序。在实盘环境中，分派时间可能延迟几微秒。

以下示例设置一个从当前时刻起一分钟后触发的时间提醒：

```python
import pandas as pd

# Fire a TimeEvent one minute from now
self.clock.set_time_alert(
    name="MyTimeAlert1",
    alert_time=self.clock.utc_now() + pd.Timedelta(minutes=1),
)
```

#### 计时器

可以设置连续计时器，按固定间隔生成 `TimeEvent`，直到计时器到期或被取消。

以下示例设置一个立即启动、每分钟触发一次的计时器：

```python
import pandas as pd

# Fire a TimeEvent every minute
self.clock.set_timer(
    name="MyTimer1",
    interval=pd.Timedelta(minutes=1),
)
```

### 缓存访问

交易者的中央 `Cache` 存储数据和执行对象（订单、持仓等），并提供许多带筛选条件的方法。以下是一些基本用法。

#### 获取数据

以下示例从缓存获取数据，假定已经设置某个金融工具 ID 属性。请求的数据不可用时，这些方法返回 `None`。

```python
last_quote = self.cache.quote(self.instrument_id)
last_trade = self.cache.trade(self.instrument_id)
last_bar = self.cache.bar(bar_type)
```

#### 获取执行对象

以下示例展示如何从缓存获取单个订单和持仓对象：

```python
order = self.cache.order(client_order_id)
position = self.cache.position(position_id)
```

所有可用方法请参阅 [`Cache` API 参考](/docs/python-api-latest/cache.html)。

### 投资组合访问

交易者的中央 `Portfolio` 提供账户和持仓信息。以下代码概括了可用方法。

#### 账户与持仓信息

```python
import decimal

from vibe_trader.accounting.accounts.base import Account
from vibe_trader.model import Venue
from vibe_trader.model import Currency
from vibe_trader.model import Money
from vibe_trader.model import InstrumentId

def account(self, venue: Venue) -> Account

def balances_locked(self, venue: Venue) -> dict[Currency, Money]
def margins_init(self, venue: Venue) -> dict[Currency, Money]
def margins_maint(self, venue: Venue) -> dict[Currency, Money]
def unrealized_pnls(self, venue: Venue) -> dict[Currency, Money]
def realized_pnls(self, venue: Venue) -> dict[Currency, Money]
def net_exposures(self, venue: Venue) -> dict[Currency, Money]

def unrealized_pnl(self, instrument_id: InstrumentId) -> Money
def realized_pnl(self, instrument_id: InstrumentId) -> Money
def net_exposure(self, instrument_id: InstrumentId) -> Money
def net_position(self, instrument_id: InstrumentId) -> decimal.Decimal

def is_net_long(self, instrument_id: InstrumentId) -> bool
def is_net_short(self, instrument_id: InstrumentId) -> bool
def is_flat(self, instrument_id: InstrumentId) -> bool
def is_completely_flat(self) -> bool
```

所有可用方法请参阅 [`Portfolio` API 参考](/docs/python-api-latest/portfolio.html)。

#### 报告与分析

使用 `Portfolio.statistics()` 和 `Portfolio.snapshots()` 进行业绩分析。请参阅[分析 API 参考](/docs/python-api-latest/analysis.html)和[投资组合统计](portfolio.md#portfolio-statistics)指南。

### 交易命令

以下交易命令可用于订单管理。命令在系统中的完整流转过程另见[执行](../concepts/execution.md)指南。

#### 提交订单

为方便使用，每个 `Strategy` 的基类都提供一个 `OrderFactory`，以减少创建不同 `Order` 对象所需的样板代码；如果交易者需要，仍可通过 `Order.__init__(...)` 构造函数直接初始化这些对象。

`SubmitOrder` 或 `SubmitOrderList` 命令具体流向哪个组件执行，取决于以下条件：

- 如果指定 `emulation_trigger`，命令会*首先*发送到 `OrderEmulator`。
- 如果指定 `exec_algorithm_id` 且没有 `emulation_trigger`，命令会*首先*发送到相应的 `ExecutionAlgorithm`。
- 否则，命令会*首先*发送到 `RiskEngine`。

以下示例提交一个用于模拟执行的 `LIMIT` BUY 订单（参见[模拟订单](orders/emulated.md)）：

```python
from vibe_trader.model.enums import OrderSide
from vibe_trader.model.enums import TriggerType
from vibe_trader.model.orders import LimitOrder


def buy(self) -> None:
    """
    Users simple buy method (example).
    """
    order: LimitOrder = self.order_factory.limit(
        instrument_id=self.instrument_id,
        order_side=OrderSide.BUY,
        quantity=self.instrument.make_qty(self.trade_size),
        price=self.instrument.make_price(5000.00),
        emulation_trigger=TriggerType.LAST_PRICE,
    )

    self.submit_order(order)
```

:::info
可以同时指定订单模拟和执行算法。此时订单先发送到 `OrderEmulator`，释放后再路由到 `ExecutionAlgorithm`。
:::

以下示例向 TWAP 执行算法提交一个 `MARKET` BUY 订单：

```python
from vibe_trader.model.enums import OrderSide
from vibe_trader.model.enums import TimeInForce
from vibe_trader.model import ExecAlgorithmId


def buy(self) -> None:
    """
    Users simple buy method (example).
    """
    order: MarketOrder = self.order_factory.market(
        instrument_id=self.instrument_id,
        order_side=OrderSide.BUY,
        quantity=self.instrument.make_qty(self.trade_size),
        time_in_force=TimeInForce.FOK,
        exec_algorithm_id=ExecAlgorithmId("TWAP"),
        exec_algorithm_params={"horizon_secs": "20", "interval_secs": "2.5"},
    )

    self.submit_order(order)
```

#### 取消订单

可以单独取消订单、批量取消订单，或取消某个金融工具的全部订单（可选按方向筛选）。

如果订单已经*关闭*或正等待取消，系统会记录警告。

如果订单当前*未结*，其状态会变为 `PENDING_CANCEL`。

`CancelOrder`、`CancelAllOrders` 或 `BatchCancelOrders` 命令具体流向哪个组件执行，取决于以下条件：

- 如果订单当前由模拟器管理，命令会*首先*发送到 `OrderEmulator`。
- 如果指定 `exec_algorithm_id` 且没有 `emulation_trigger`，并且订单在本地系统中仍有效，命令会*首先*发送到相应的 `ExecutionAlgorithm`。
- 否则，订单会*首先*发送到 `ExecutionEngine`。

:::info
命令离开策略后，任何受管理的 GTD 计时器也会被取消。
:::

取消单个订单：

```python
self.cancel_order(order.client_order_id)
```

批量取消订单：

```python
from vibe_trader.model import ClientOrderId


client_order_ids: list[ClientOrderId] = [
    order1.client_order_id,
    order2.client_order_id,
    order3.client_order_id,
]
self.cancel_orders(client_order_ids)
```

取消全部订单：

```python
self.cancel_all_orders(self.instrument_id)
```

#### 修改订单

模拟订单或交易场所中处于*未结*状态的订单（如果交易场所支持）可以单独修改。

如果订单已经*关闭*或正等待取消，系统会记录警告。如果订单当前*未结*，其状态会变为 `PENDING_UPDATE`。

:::warning
命令至少有一个值必须与原订单不同，才是有效命令。
:::

`ModifyOrder` 命令具体流向哪个组件执行，取决于以下条件：

- 如果订单当前由模拟器管理，命令会*首先*发送到 `OrderEmulator`。
- 否则，订单会*首先*发送到 `RiskEngine`。

:::info
订单一旦由执行算法控制，策略就不能直接修改，只能取消。
:::

以下示例修改交易场所中当前*未结*的 `LIMIT` BUY 订单数量：

```python
from vibe_trader.model import Quantity


new_quantity: Quantity = Quantity.from_int(5)
self.modify_order(order.client_order_id, quantity=new_quantity)
```

:::info
也可以修改价格和触发价格，但仅限订单由模拟器管理或交易场所支持修改时。
:::

#### 市价退出

`market_exit()` 方法提供一种平稳退出方式：平掉某策略的所有持仓并取消其所有订单。退出完成后策略仍继续运行，因此之后仍可根据需要重新建立持仓。

```python
self.market_exit()
```

市价退出流程如下：

1. 取消该策略所有未结和传输中的订单。
2. 使用市价订单平掉所有未平持仓。
3. 按 `market_exit_interval_ms` 定期检查，直到全部订单完成处理且持仓关闭。
4. 持仓归零或达到 `market_exit_max_attempts` 后，调用 `post_market_exit()`。

可使用两个钩子添加自定义逻辑：

- `on_market_exit()` - 退出流程开始时调用。
- `post_market_exit()` - 退出流程完成时调用。

```python
class MyStrategy(Strategy):
    def on_market_exit(self) -> None:
        self.log.info("Beginning market exit...")

    def post_market_exit(self) -> None:
        self.log.info("Market exit complete")
```

市价退出期间，非只减仓订单会被自动拒绝。对于订单列表，只要其中有一个订单不是只减仓订单，就会拒绝整个列表，以保留列表语义（例如包含相互依赖关系的括号订单）。

使用 `is_exiting()` 检查退出是否正在进行，例如跳过订单提交逻辑：

```python
def on_quote(self, tick: QuoteTick) -> None:
    if self.is_exiting():
        return  # Skip order logic during exit
    # ... normal order logic
```

要在策略停止时自动执行市价退出，请设置 `manage_stop=True`：

```python
config = StrategyConfig(manage_stop=True)
```

启用该选项后，调用 `stop()` 会先执行市价退出，持仓归零后再停止策略。

`StrategyConfig` 中的配置选项：

- `manage_stop`（默认：False）- 如果为 True，`stop()` 会在停止前执行市价退出。
- `market_exit_interval_ms`（默认：100）- 两次退出完成状态检查之间的间隔。
- `market_exit_max_attempts`（默认：100）- 完成退出前最多检查的次数。
- `market_exit_time_in_force`（默认：None/GTC）- 平仓市价订单的有效期类型。
- `market_exit_reduce_only`（默认：True）- 平仓市价订单是否只允许减仓。

## 策略配置

独立的配置类使策略的实例化位置和方式具有充分灵活性。配置可以通过网络序列化，从而支持分布式回测和远程实盘交易。

该功能按需使用。可以不定义配置，而把参数直接传给策略构造函数；如果需要分布式回测或远程实盘交易，则应定义配置。

以下是一个配置示例：

```python
from decimal import Decimal
from vibe_trader.model import Bar
from vibe_trader.model import BarType
from vibe_trader.model import InstrumentId
from vibe_trader.trading import Strategy
from vibe_trader.config import StrategyConfig


# Configuration definition
class MyStrategyConfig(StrategyConfig):
    _CUSTOM_FIELDS = (
        "instrument_id",
        "bar_type",
        "fast_ema_period",
        "slow_ema_period",
        "trade_size",
    )

    def __new__(cls, *args, **kwargs):
        for field in cls._CUSTOM_FIELDS:
            kwargs.pop(field, None)
        return super().__new__(cls, *args, **kwargs)

    def __init__(
        self,
        instrument_id: InstrumentId,
        bar_type: BarType,
        trade_size: Decimal,
        fast_ema_period: int = 10,
        slow_ema_period: int = 20,
        **_kwargs,
    ) -> None:
        super().__init__()
        self.instrument_id = instrument_id
        self.bar_type = bar_type
        self.trade_size = trade_size
        self.fast_ema_period = fast_ema_period
        self.slow_ema_period = slow_ema_period


# Strategy definition
class MyStrategy(Strategy):
    def __init__(self, config: MyStrategyConfig) -> None:
        # Always initialize the parent Strategy class
        # After this, configuration is stored and available via `self.config`
        super().__init__(config)

        # Custom state variables
        self.time_started = None
        self.count_of_processed_bars: int = 0

    def on_start(self) -> None:
        self.time_started = self.clock.utc_now()  # Remember time, when strategy started
        self.subscribe_bars(
            self.config.bar_type
        )  # See how configuration data are exposed via `self.config`

    def on_bar(self, bar: Bar):
        self.count_of_processed_bars += 1  # Update count of processed bars


# Instantiate configuration with specific values. By setting:
#   - InstrumentId - we parameterize the instrument the strategy will trade.
#   - BarType - we parameterize bar-data, that strategy will trade.
config = MyStrategyConfig(
    instrument_id=InstrumentId.from_str("ETHUSDT-PERP.BINANCE"),
    bar_type=BarType.from_str("ETHUSDT-PERP.BINANCE-15-MINUTE[LAST]-EXTERNAL"),
    trade_size=Decimal("1"),
    order_id_tag="001",
)

# Pass configuration to our trading strategy.
strategy = MyStrategy(config=config)
```

通过 `self.config` 访问配置值。这样可以清晰地区分：

- 配置数据（通过 `self.config` 访问）：
  - 包含定义策略工作方式的初始设置。
  - 示例：`self.config.trade_size`、`self.config.instrument_id`

- 策略状态变量（直接作为属性）：
  - 跟踪策略的任意自定义状态。
  - 示例：`self.time_started`、`self.count_of_processed_bars`

这种分离方式使代码更易理解和维护。

:::note
虽然通常会让一个策略只交易一种金融工具，但单个策略可处理的金融工具数量只受机器资源限制。
:::

### 托管 GTD 到期

策略可以管理有效期类型为 GTD（*Good 'till Date*，截至指定日期有效）的订单到期。如果交易所或经纪商不支持这种有效期类型，或出于其他原因希望由策略管理到期，就可以使用此功能。

要启用该选项，请向 `StrategyConfig` 传入 `manage_gtd_expiry=True`。提交有效期类型为 GTD 的订单时，策略会自动启动内部时间提醒。到达内部 GTD 提醒时间后，如果订单尚未*关闭*，策略会取消该订单。

部分交易场所（例如 Binance Futures）原生支持 GTD。为避免使用 `managed_gtd_expiry` 时发生冲突，应在执行客户端配置中设置 `use_gtd=False`。

### 多个策略

如果要用不同配置运行同一策略的多个实例（例如交易不同金融工具），每个实例都需要唯一的策略 ID 和订单 ID 标签。

如果未提供 `strategy_id`，平台会根据策略类名和订单 ID 标签构建策略 ID。可以通过 `order_id_tag` 提供标签；否则注册时会分配下一个数字标签，从 `000` 开始。例如，上述配置会生成策略 ID `MyStrategy-001`。

如果同时提供 `strategy_id` 和 `order_id_tag`，Rust 会把标签附加到运行时策略 ID，除非该 ID 已以此标签结尾。例如，`strategy_id=MyStrategy-PRIMARY` 与 `order_id_tag=ABC` 会得到 `MyStrategy-PRIMARY-ABC`。如果省略 `order_id_tag`，Rust 会使用 `strategy_id` 中最后一个以连字符分隔的部分作为订单 ID 标签。

:::note
平台内置了安全措施：如果两个策略使用重复的策略 ID，注册期间会抛出 `RuntimeError`，指出该策略 ID 已注册。
:::

这是因为系统必须能够识别各命令和事件属于哪个策略。订单 ID 标签也能保证同一交易者的不同策略所生成的客户端订单 ID 彼此唯一。

:::info Rust 实现
Rust 将 `StrategyConfig` 视为不可变的构造输入。运行时 `StrategyId` 携带订单 ID 标签，与 Python/Cython 行为一致。这样，参与者注册、客户端订单 ID 生成、订单列表 ID 生成和持仓 ID 生成都会通过 `strategy_id.get_tag()` 保持一致。

如果省略 `strategy_id`，`order_id_tag` 会覆盖生成的后缀，例如 `MyStrategy-ABC`。
:::

更多信息请参阅 [`StrategyId` API 参考](/docs/python-api-latest/model/identifiers.html)。

## 相关指南

- [参与者](actors.md) - 策略所扩展的基类。
- [事件](events/) - 事件类型和处理程序分派。
- [订单](orders/) - 订单类型及策略中的订单管理。
- [回测](backtesting/) - 使用历史数据测试策略。
