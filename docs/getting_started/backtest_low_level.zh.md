---
title: "回测（低级API）"
---

使用 `BacktestEngine` 可以直接访问各个组件：加载市场数据、接入策略与执行算法，并在完全掌控每个步骤的情况下运行回测。本教程将使用历史成交 tick 数据，在模拟的 Binance 现货交易所中，通过 TWAP 执行算法回测 EMA 交叉策略。

[在 GitHub 上查看源代码](https://github.com/qOeOp/trade/blob/main/docs/getting_started/backtest_low_level.py)。

## 先决条件

- Python 3.12+
- 在本地构建 Vibe Trader 源码（`make build-debug`）

```python
from decimal import Decimal

from vibe_trader.config import BacktestEngineConfig
from vibe_trader.backtest import BacktestEngine
from vibe_trader.examples.algorithms.twap import TWAPExecAlgorithm
from vibe_trader.examples.strategies.ema_cross_twap import EMACrossTWAP
from vibe_trader.examples.strategies.ema_cross_twap import EMACrossTWAPConfig
from vibe_trader.model import BarType
from vibe_trader.model import Money
from vibe_trader.model import TraderId
from vibe_trader.model import Venue
from vibe_trader.model.currencies import ETH
from vibe_trader.model.currencies import USDT
from vibe_trader.model.enums import AccountType
from vibe_trader.model.enums import OmsType
from vibe_trader.persistence.wranglers import TradeTickDataWrangler
from vibe_trader.test_kit.providers import TestDataProvider
from vibe_trader.test_kit.providers import TestInstrumentProvider
```

## 加载数据

加载随项目提供的测试数据（来自 Binance 的 ETHUSDT 成交数据），初始化相应的金融工具，并将原始 CSV 整理为 Vibe `TradeTick` 对象。

```python
# Load stub test data
provider = TestDataProvider()
trades_df = provider.read_csv_ticks("binance/ethusdt-trades.csv")

# Initialize the instrument which matches the data
ETHUSDT_BINANCE = TestInstrumentProvider.ethusdt_binance()

# Process into Vibe objects
wrangler = TradeTickDataWrangler(instrument=ETHUSDT_BINANCE)
ticks = wrangler.process(trades_df)
```

数据处理管线的详细信息请参阅[数据](../concepts/data/index.md)概念指南。

## 初始化引擎

向引擎传入 `BacktestEngineConfig` 进行配置。这里通过设置自定义 `trader_id` 来演示这一用法。

```python
# Configure backtest engine
config = BacktestEngineConfig(trader_id=TraderId("BACKTESTER-001"))

# Build the backtest engine
engine = BacktestEngine(config=config)
```

## 添加交易场所

设置一个与市场数据相匹配的模拟交易场所。这里配置的是使用现金账户的 Binance 现货交易所。

```python
# Add a trading venue (multiple venues possible)
BINANCE = Venue("BINANCE")
engine.add_venue(
    venue=BINANCE,
    oms_type=OmsType.NETTING,
    account_type=AccountType.CASH,  # Spot CASH account (not for perpetuals or futures)
    base_currency=None,  # Multi-currency account
    starting_balances=[Money(1_000_000.0, USDT), Money(10.0, ETH)],
)
```

## 添加数据

将金融工具与成交 tick 添加到引擎中。

```python
# Add instrument(s)
engine.add_instrument(ETHUSDT_BINANCE)

# Add data
engine.add_data(ticks)
```

:::note
可以添加多种数据类型（包括自定义类型），并跨多个交易场所进行回测。
:::

## 添加策略

使用 TWAP 执行参数配置并添加 EMA 交叉策略。

```python
# Configure your strategy
strategy_config = EMACrossTWAPConfig(
    instrument_id=ETHUSDT_BINANCE.id,
    bar_type=BarType.from_str("ETHUSDT.BINANCE-250-TICK-LAST-INTERNAL"),
    trade_size=Decimal("0.10"),
    fast_ema_period=10,
    slow_ema_period=20,
    twap_horizon_secs=10.0,
    twap_interval_secs=2.5,
)

# Instantiate and add your strategy
strategy = EMACrossTWAP(config=strategy_config)
engine.add_strategy(strategy=strategy)
```

策略配置引用 TWAP 参数，但执行算法本身是一个单独的组件。

## 添加执行算法

向引擎添加 TWAP 执行算法。

```python
# Instantiate and add your execution algorithm
exec_algorithm = TWAPExecAlgorithm()  # Using defaults
engine.add_exec_algorithm(exec_algorithm)
```

## 运行回测

调用 `.run()` 处理所有可用数据。引擎按时间戳顺序重放事件，并提供确定性的执行语义。

```python
# Run the engine (from start to end of data)
engine.run()
```

## 运行后分析

引擎会将数据对象与执行对象保留在内存中，以便生成报告；同时还会记录一份包含默认统计指标的绩效概览。自定义统计指标请参阅[投资组合统计](../concepts/portfolio.md#portfolio-statistics)指南。

```python
engine.trader.generate_account_report(BINANCE)
```

```python
engine.trader.generate_order_fills_report()
```

```python
engine.trader.generate_positions_report()
```

## 重复运行

如需重复运行，请重置引擎。金融工具、数据与已加载组件会在重置后保留，但这些组件的内部状态会被重置。

```python
# For repeated backtest runs, reset the engine
engine.reset()

# Clear or remove loaded components before adding replacements.
```

可按需移除或添加单个组件（Actor、策略、执行算法）。

可用方法的完整说明请参阅 [Trader](../api_reference/trading.md) API 参考。

```python
# Once done, good practice to dispose of the object if the script continues
engine.dispose()
```
