---
title: "快速入门"
---

在五分钟内运行您的第一次回测。

[在 GitHub 上查看源代码](https://github.com/qOeOp/trade/blob/main/docs/getting_started/quickstart.py)。

## 先决条件

- Python 3.12+
- 在本地构建 Vibe Trader 源码（`make build-debug`）

## 写策略

策略通过继承 `Strategy` 基类并重写事件处理器来响应市场数据。本例采用 EMA 交叉逻辑：快速指数移动平均线上穿慢速均线时买入，下穿时卖出。

```python
from decimal import Decimal

from vibe_trader.config import StrategyConfig
from vibe_trader.indicators import ExponentialMovingAverage
from vibe_trader.model import Bar
from vibe_trader.model import BarType
from vibe_trader.model import InstrumentId
from vibe_trader.model import OrderSide
from vibe_trader.trading import Strategy


class EMACrossConfig(StrategyConfig):
    _CUSTOM_FIELDS = (
        "instrument_id",
        "bar_type",
        "trade_size",
        "fast_ema_period",
        "slow_ema_period",
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


class EMACross(Strategy):
    def __init__(self, config: EMACrossConfig):
        super().__init__(config)
        self.fast_ema = ExponentialMovingAverage(config.fast_ema_period)
        self.slow_ema = ExponentialMovingAverage(config.slow_ema_period)

    def on_start(self):
        self.register_indicator_for_bars(self.config.bar_type, self.fast_ema)
        self.register_indicator_for_bars(self.config.bar_type, self.slow_ema)
        self.subscribe_bars(self.config.bar_type)

    def on_bar(self, bar: Bar):
        if not self.indicators_initialized():
            return

        if self.fast_ema.value >= self.slow_ema.value:
            if self.portfolio.is_flat(self.config.instrument_id):
                self.buy()
            elif self.portfolio.is_net_short(self.config.instrument_id):
                self.close_all_positions(self.config.instrument_id)
                self.buy()
        elif self.fast_ema.value < self.slow_ema.value:
            if self.portfolio.is_flat(self.config.instrument_id):
                self.sell()
            elif self.portfolio.is_net_long(self.config.instrument_id):
                self.close_all_positions(self.config.instrument_id)
                self.sell()

    def buy(self):
        instrument = self.cache.instrument(self.config.instrument_id)
        order = self.order_factory.market(
            self.config.instrument_id,
            OrderSide.BUY,
            instrument.make_qty(self.config.trade_size),
        )
        self.submit_order(order)

    def sell(self):
        instrument = self.cache.instrument(self.config.instrument_id)
        order = self.order_factory.market(
            self.config.instrument_id,
            OrderSide.SELL,
            instrument.make_qty(self.config.trade_size),
        )
        self.submit_order(order)

    def on_stop(self):
        self.close_all_positions(self.config.instrument_id)
```

`on_start` 注册两个 EMA 指标，使引擎在每根新 K线到来时自动更新它们。`on_bar` 会先等待指标完成预热，再根据交叉信号建立或反转持仓。

## 生成合成数据

为使本快速入门示例可以独立运行，这里通过随机游走生成 10,000 根 EUR/USD 一分钟合成 K线。在实际使用中，应从数据供应商或 Parquet 数据目录加载真实市场数据。

```python
import numpy as np
import pandas as pd

from vibe_trader.backtest import BacktestEngine
from vibe_trader.common import LogLevel
from vibe_trader.config import BacktestEngineConfig
from vibe_trader.config import LoggerConfig
from vibe_trader.model import AccountType
from vibe_trader.model import Currency
from vibe_trader.model import CurrencyPair
from vibe_trader.model import Money
from vibe_trader.model import OmsType
from vibe_trader.model import Price
from vibe_trader.model import Quantity
from vibe_trader.model import Symbol
from vibe_trader.model import Venue


# Create a EUR/USD instrument on the SIM venue
EUR = Currency.from_str("EUR")
USD = Currency.from_str("USD")
EURUSD = CurrencyPair(
    instrument_id=InstrumentId.from_str("EUR/USD.SIM"),
    raw_symbol=Symbol("EUR/USD"),
    base_currency=EUR,
    quote_currency=USD,
    price_precision=5,
    size_precision=0,
    price_increment=Price.from_str("0.00001"),
    size_increment=Quantity.from_int(1),
    ts_event=0,
    ts_init=0,
    lot_size=Quantity.from_int(1_000),
    margin_init=Decimal("0.03"),
    margin_maint=Decimal("0.03"),
)

# Generate synthetic 1-minute bars (random walk around 1.10)
rng = np.random.default_rng(42)
n = 10_000
price = 1.10 + np.cumsum(rng.normal(0, 0.0002, n))
spread = np.abs(rng.normal(0, 0.0003, n))
bars_df = pd.DataFrame(
    {
        "open": price,
        "high": price + spread,
        "low": price - spread,
        "close": price + rng.normal(0, 0.00005, n),
    },
    index=pd.date_range("2024-01-01", periods=n, freq="1min", tz="UTC"),
)
bars_df["high"] = bars_df[["open", "high", "close"]].max(axis=1)
bars_df["low"] = bars_df[["open", "low", "close"]].min(axis=1)

bar_type = BarType.from_str("EUR/USD.SIM-1-MINUTE-LAST-EXTERNAL")
bars = [
    Bar(
        bar_type=bar_type,
        open=Price(row.open, precision=EURUSD.price_precision),
        high=Price(row.high, precision=EURUSD.price_precision),
        low=Price(row.low, precision=EURUSD.price_precision),
        close=Price(row.close, precision=EURUSD.price_precision),
        volume=Quantity.from_int(1_000_000),
        ts_event=int(timestamp.value),
        ts_init=int(timestamp.value),
    )
    for timestamp, row in bars_df.iterrows()
]
```

每一行都会转换为一个 `Bar`，并采用该金融工具的价格精度。K线类型字符串编码了金融工具、聚合周期、价格来源与数据来源。

## 配置并运行引擎

创建 `BacktestEngine`，添加一个使用保证金账户的模拟外汇交易场所，接入金融工具、数据与策略，然后运行引擎。引擎会按时间戳顺序处理所有 K线，并提供确定性的执行语义。

```python
engine = BacktestEngine(
    config=BacktestEngineConfig(
        logging=LoggerConfig(stdout_level=LogLevel.ERROR),
    ),
)

# Add a simulated FX venue
SIM = Venue("SIM")
engine.add_venue(
    venue=SIM,
    oms_type=OmsType.NETTING,
    account_type=AccountType.MARGIN,
    starting_balances=[Money(1_000_000, USD)],
    base_currency=USD,
    default_leverage=Decimal(1),
)

# Add instrument, data, and strategy
engine.add_instrument(EURUSD)
engine.add_data(bars)

strategy = EMACross(
    EMACrossConfig(
        instrument_id=EURUSD.id,
        bar_type=bar_type,
        trade_size=Decimal(100000),
    ),
)
engine.add_strategy(strategy)

# Run the backtest
engine.run()
```

引擎按时间戳顺序处理全部 10,000 根 K线。每根 K线都会先更新已注册指标，再触发 `on_bar`；模拟交易所则按当前价格成交市价订单。

## 审核结果

回测完成后，引擎会生成报告：账户报告展示余额随时间的变化，持仓报告列出每笔完整开平仓交易及其已实现盈亏，订单成交报告则列出每一笔成交。

```python
engine.generate_account_report(venue=SIM)
```

```python
engine.generate_positions_report()
```

```python
engine.generate_order_fills_report()
```

## 后续步骤

- [回测（低级 API）](backtest_low_level)，介绍如何结合真实市场数据与执行算法直接使用 `BacktestEngine`。
- [回测（高级 API）](backtest_high_level)，介绍如何使用 `BacktestNode` 与 Parquet 数据目录进行配置驱动的回测。
- [教程](../tutorials/)提供策略模式演练，涵盖做市、均值回归、订单簿不平衡等主题。

```python
engine.dispose()
```
