# 报告

本指南介绍 `ReportProvider` 类提供的投资组合分析与报告能力，
以及这些报告如何用于盈亏核算和回测运行后的分析。

## 概述

VibeTrader 中的 `ReportProvider` 类会根据交易数据生成结构化分析报告，
把原始订单、成交、持仓和账户状态转换为 pandas DataFrame，供分析与可视化使用。
这些报告可帮助你评估策略表现、分析执行质量并验证盈亏核算。

报告可通过两种方式生成：

- **Trader 辅助方法**（推荐）：使用 `trader.generate_orders_report()` 等便捷方法。
- **直接使用 ReportProvider**：可以更精细地控制数据选择与筛选。

报告在回测和实盘交易环境中提供一致的分析能力，
从而支持可靠的表现评估与策略比较。

## 可用报告

`ReportProvider` 类提供多个静态方法，可根据交易数据生成报告。
每份报告都返回具有特定列与索引的 pandas DataFrame，便于分析。

### 订单报告

生成所有订单的完整视图：

```python
# Using Trader helper method (recommended)
orders_report = trader.generate_orders_report()

# Or using ReportProvider directly
from vibe_trader.analysis import ReportProvider

orders = cache.orders()
orders_report = ReportProvider.generate_orders_report(orders)
```

**返回 `pd.DataFrame`。主要列包括：**

| 列                | 说明                            |
| ----------------- | ------------------------------- |
| `client_order_id` | 索引--唯一订单标识符。          |
| `instrument_id`   | 交易标的。                      |
| `strategy_id`     | 创建订单的策略。                |
| `trader_id`       | 交易器标识符。                  |
| `account_id`      | 账户标识符（若已分配）。        |
| `venue_order_id`  | 场所分配的订单 ID（若已接受）。 |
| `side`            | BUY 或 SELL。                   |
| `type`            | MARKET、LIMIT 等。              |
| `status`          | 当前订单状态。                  |
| `quantity`        | 原始订单数量（字符串）。        |
| `filled_qty`      | 已成交数量（字符串）。          |
| `price`           | 限价价格（取决于订单类型）。    |
| `avg_px`          | 平均成交价格（若已成交）。      |
| `time_in_force`   | 有效期指令。                    |
| `ts_init`         | 订单初始化时间戳（Unix 纳秒）。 |
| `ts_last`         | 最后更新时间戳（Unix 纳秒）。   |

其他列会随订单类型而变化（例如止损订单的 `trigger_price`、
GTD 订单的 `expire_time`）。完整字段列表请参阅 `Order.to_dict()`。

### 订单成交汇总报告

提供已成交订单的汇总（每个订单一行）：

```python
# Using Trader helper method (recommended)
fills_report = trader.generate_order_fills_report()

# Or using ReportProvider directly
orders = cache.orders()
fills_report = ReportProvider.generate_order_fills_report(orders)
```

该报告仅包含 `filled_qty > 0` 的订单，列与订单报告相同，
但只保留已执行订单。请注意，为便于分析，本报告中的 `ts_init` 和 `ts_last`
会转换为 datetime 对象。

### 成交报告

详细列出每个成交事件（每次成交一行）：

```python
# Using Trader helper method (recommended)
fills_report = trader.generate_fills_report()

# Or using ReportProvider directly
orders = cache.orders()
fills_report = ReportProvider.generate_fills_report(orders)
```

**返回 `pd.DataFrame`。主要列包括：**

| 列                | 说明                           |
| ----------------- | ------------------------------ |
| `client_order_id` | 索引--订单标识符。             |
| `trade_id`        | 唯一交易/成交标识符。          |
| `venue_order_id`  | 场所分配的订单 ID。            |
| `instrument_id`   | 交易标的。                     |
| `strategy_id`     | 创建订单的策略。               |
| `account_id`      | 账户标识符。                   |
| `position_id`     | 关联的持仓 ID（如适用）。      |
| `order_side`      | BUY 或 SELL。                  |
| `order_type`      | 订单类型（MARKET、LIMIT 等）。 |
| `last_px`         | 成交执行价格（字符串）。       |
| `last_qty`        | 成交执行数量（字符串）。       |
| `currency`        | 成交使用的货币。               |
| `liquidity_side`  | MAKER 或 TAKER。               |
| `commission`      | 佣金金额与货币。               |
| `ts_event`        | 成交时间戳（datetime）。       |
| `ts_init`         | 初始化时间戳（datetime）。     |

完整字段列表请参阅 `OrderFilled.to_dict()`。

### 持仓报告

包含快照的持仓分析：

```python
# Using Trader helper method (recommended)
# Automatically includes snapshots for NETTING OMS
positions_report = trader.generate_positions_report()

# Or using ReportProvider directly
positions = cache.positions()
snapshots = cache.position_snapshots()  # For NETTING OMS
positions_report = ReportProvider.generate_positions_report(
    positions=positions, snapshots=snapshots
)
```

**返回 `pd.DataFrame`。主要列包括：**

| 列                 | 说明                              |
| ------------------ | --------------------------------- |
| `position_id`      | 索引--唯一持仓标识符。            |
| `instrument_id`    | 交易标的。                        |
| `strategy_id`      | 管理该持仓的策略。                |
| `trader_id`        | 交易器标识符。                    |
| `account_id`       | 账户标识符。                      |
| `opening_order_id` | 建立持仓的订单 ID。               |
| `closing_order_id` | 平仓的订单 ID。                   |
| `entry`            | 开仓方向（BUY 或 SELL）。         |
| `side`             | 持仓方向（LONG、SHORT 或 FLAT）。 |
| `quantity`         | 当前持仓规模。                    |
| `peak_qty`         | 曾达到的最大规模。                |
| `avg_px_open`      | 平均入场价格。                    |
| `avg_px_close`     | 平均离场价格（若已平仓）。        |
| `commissions`      | 已支付佣金列表。                  |
| `realized_pnl`     | 已实现盈亏。                      |
| `realized_return`  | 收益率百分比。                    |
| `ts_init`          | 持仓初始化时间戳。                |
| `ts_opened`        | 开仓时间戳（datetime）。          |
| `ts_last`          | 最后更新时间戳。                  |
| `ts_closed`        | 平仓时间戳（datetime 或 NA）。    |
| `duration_ns`      | 以纳秒表示的持仓时长。            |
| `is_snapshot`      | 是否为历史快照。                  |

### 账户报告

跟踪账户余额与保证金随时间的变化：

```python
# Using Trader helper method (recommended)
# Requires venue parameter
from vibe_trader.model.identifiers import Venue

venue = Venue("BINANCE")
account_report = trader.generate_account_report(venue)

# Or using ReportProvider directly
account = cache.account(account_id)
account_report = ReportProvider.generate_account_report(account)
```

**返回 `pd.DataFrame`。列包括：**

| 列              | 说明                            |
| --------------- | ------------------------------- |
| `ts_event`      | 索引--账户状态变化的时间戳。    |
| `account_id`    | 账户标识符。                    |
| `account_type`  | 账户类型（例如 SPOT、MARGIN）。 |
| `base_currency` | 账户的基础货币。                |
| `total`         | 总余额（字符串）。              |
| `free`          | 可用余额（字符串）。            |
| `locked`        | 被订单锁定的余额（字符串）。    |
| `currency`      | 余额对应的货币。                |
| `reported`      | 余额是否由场所报告。            |
| `margins`       | 保证金信息（列表，如适用）。    |
| `info`          | 场所特有的附加信息。            |

每一行表示一项余额记录；含多种货币的账户会在每个账户状态事件中产生多行。

## 盈亏核算注意事项

准确的盈亏核算需要仔细考虑以下因素：

### 基于持仓的盈亏

- **已实现盈亏**：在持仓部分或全部平仓时计算。
- **未实现盈亏**：使用当前价格按市值计价。
- **佣金影响**：仅当佣金币种与持仓成本货币相同时计入。

:::warning
盈亏计算取决于 OMS 类型。在 `NETTING` OMS 中，持仓重新建立时，
持仓快照会保留历史盈亏。生成报告时始终包含快照，才能准确计算总盈亏。
在 `HEDGING` OMS 中，由于每个持仓都有唯一 ID 且不会重新开启，因此不使用快照。
:::

### 多币种核算

处理多种货币时：

- 每个持仓都以其成本货币跟踪盈亏：线性合约使用报价货币，反向合约使用基础货币，
  quanto 合约使用结算货币。
- 投资组合聚合需要进行货币转换。
- 佣金币种可能与持仓成本货币不同。

```python
# Accessing PnL across positions
for position in positions:
    realized = position.realized_pnl  # In the position's cost currency
    unrealized = position.unrealized_pnl(last_price)

    # Handle multi-currency aggregation (illustrative)
    # Note: Currency conversion requires user-provided exchange rates
    if realized.currency != base_currency:
        # Apply conversion rate from your data source
        # rate = get_exchange_rate(realized.currency, base_currency)
        # realized_converted = realized.as_double() * rate
        pass
```

### 快照注意事项

对于 `NETTING` OMS：

```python
from vibe_trader.model.objects import Money

# Include snapshots for complete PnL (per currency)
pnl_by_currency = {}

# Add PnL from current positions
for position in cache.positions(instrument_id=instrument_id):
    if position.realized_pnl:
        currency = position.realized_pnl.currency
        if currency not in pnl_by_currency:
            pnl_by_currency[currency] = 0.0
        pnl_by_currency[currency] += position.realized_pnl.as_double()

# Add PnL from historical snapshots
for snapshot in cache.position_snapshots(instrument_id=instrument_id):
    if snapshot.realized_pnl:
        currency = snapshot.realized_pnl.currency
        if currency not in pnl_by_currency:
            pnl_by_currency[currency] = 0.0
        pnl_by_currency[currency] += snapshot.realized_pnl.as_double()

# Create Money objects for each currency
total_pnls = [Money(amount, currency) for currency, amount in pnl_by_currency.items()]
```

## 回测运行后分析

回测完成后，可通过结果统计与生成的报告进行分析。

### 访问回测结果

```python
# After backtest run
engine.run(start=start_time, end=end_time)

# Access result statistics
result = engine.get_result()

# Generate reports from the backtest engine
fills_report = engine.generate_fills_report()
venue = engine.list_venues()[0]
account_report = engine.generate_account_report(venue=venue)

# Or access data directly for custom analysis
orders = engine.cache.orders()
positions = engine.cache.positions()
snapshots = engine.cache.position_snapshots()
```

### 投资组合统计

回测结果会提供表现指标：

```python
# Access backtest result statistics
result = engine.get_result()

# Get different categories of statistics
stats_pnls = result.stats_pnls
stats_returns = result.stats_returns
stats_general = result.stats_general
```

:::info
有关可用统计指标的详细信息，请参阅
[投资组合指南](portfolio.md#portfolio-statistics)。投资组合指南涵盖：

- 内置统计类别（基于盈亏、收益、持仓和订单）。
- 投资组合报告上下文。

:::

### 可视化

VibeTrader 通过 Plotly 提供交互式绩效报告和图表：

```python
from vibe_trader.analysis import create_tearsheet

# After backtest run
engine.run()

# Generate interactive HTML tearsheet
create_tearsheet(engine, output_path="tearsheet.html")
```

这会创建一份交互式 HTML 报告，其中包含：

- 权益曲线
- 回撤分析
- 月度收益热力图
- 表现统计表
- 收益分布

如需更精细的控制，可以单独生成图表：

```python
import pandas as pd

from vibe_trader.analysis import create_equity_curve

returns = pd.Series(
    [0.01, -0.005, 0.002],
    index=pd.date_range("2024-01-01", periods=3, tz="UTC"),
)
fig = create_equity_curve(returns, title="My Strategy Equity")
fig.show()  # Display in browser
fig.write_image("equity.png")  # Export to PNG (requires kaleido)
```

安装可视化依赖：

```bash
uv pip install "vibe_trader[visualization]"
```

## 报告生成模式

### 实盘交易

在实盘交易期间，定期生成报告：

```python
import pandas as pd

from vibe_trader.common import DataActor


class ReportingActor(DataActor):
    def on_start(self):
        # Schedule periodic reporting
        self.clock.set_timer(
            name="generate_reports",
            interval=pd.Timedelta(minutes=30),
            callback=self.generate_reports,
        )

    def generate_reports(self, event):
        # Generate and log reports
        positions_report = self.trader.generate_positions_report()

        # Save or transmit report
        positions_report.to_csv(f"positions_{event.ts_event}.csv")
```

### 表现分析

对于回测分析：

```python
import pandas as pd

# Run the backtest
engine.run(start=start_time, end=end_time)

# Collect results
positions_closed = engine.cache.positions_closed()
result = engine.get_result()
stats_pnls = result.stats_pnls
stats_returns = result.stats_returns
stats_general = result.stats_general

# Create summary dictionary
results = {
    "total_positions": len(positions_closed),
    "pnl_total": stats_pnls.get("USD", {}).get("PnL (total)"),
    "sharpe_ratio": stats_returns.get("Sharpe Ratio (252 days)"),
    "profit_factor": stats_general.get("Profit Factor"),
    "win_rate": stats_general.get("Win Rate"),
}

# Display results
results_df = pd.DataFrame([results])
print(results_df.T)  # Transpose for vertical display
```

:::info
报告根据内存中的数据结构生成。对于大规模分析或长期运行的系统，
可考虑将报告持久化到数据库，以提高查询效率。
持久化选项请参阅[缓存指南](cache.md)。
:::

## 与其他组件的集成

`ReportProvider` 会与多个系统组件协同工作：

- **缓存**：报告所需全部交易数据（订单、持仓、账户）的来源。
- **投资组合**：使用报告进行表现分析和指标计算。
- **BacktestEngine**：使用报告进行运行后分析与可视化。
- **持仓快照**：在 `NETTING` OMS 中生成准确盈亏报告所必需。

## 总结

`ReportProvider` 会根据订单、成交、持仓和账户状态生成结构化 DataFrame，
用于分析与可视化。在 `NETTING` OMS 中，为准确计算总盈亏，
生成报告时应包含持仓快照。

## 相关指南

- [可视化](visualization.md) - 根据回测结果生成交互式绩效报告和图表。
- [投资组合](portfolio.md) - 投资组合统计和表现指标。
- [回测](backtesting/) - 运行能够生成报告的回测。
- [缓存](cache.md) - 存储报告数据的缓存系统。
