# 可视化

VibeTrader 提供基于 Plotly 构建的可扩展可视化系统，用交互式 HTML 绩效报告分析回测结果。只需少量代码即可生成报告，并添加自定义图表和主题。

## 概述

可视化系统由三部分组成：

1. **图表注册表** - 将图表定义解耦，并支持扩展自定义可视化。
2. **主题系统** - 使用内置或自定义主题保持样式一致。
3. **配置** - 以声明方式指定渲染内容和显示方式。

所有可视化输出都是自包含的 HTML 文件，可以在任何现代浏览器中查看、与相关人员共享，或存档以供日后参考。

:::note
可视化系统需要安装 `visualization` 可选依赖。它会安装 Pandas 以处理 DataFrame、Plotly 以绘制交互式图表，以及 Kaleido 以导出静态图像：

```bash
uv pip install "vibe_trader[visualization]"
```

:::

## 绩效报告

绩效报告（tearsheet）将多个图表和统计数据组合成一个交互式可视化。完成一次回测后即可生成报告，直观地查看策略表现。

### 快速开始

使用默认设置生成绩效报告：

```python
from vibe_trader.analysis import create_tearsheet
from vibe_trader.backtest import BacktestEngine

# After running your backtest
engine.run()

# Generate tearsheet
create_tearsheet(
    engine=engine,
    output_path="backtest_results.html",
)
```

这会生成一个包含全部默认图表、采用浅色主题和自动布局的 HTML 文件。在浏览器中打开 `backtest_results.html` 即可查看交互式绩效报告。

### 回测结果输入

假设 `result` 是已完成回测返回的 `BacktestResult`。只传入结果而不传入节点，即可生成仅包含结果的绩效报告：

```python
create_tearsheet(
    engine=result,
    output_path="backtest_results.html",
)
```

若要包含节点报告中的账户初始余额，需要保留节点状态。配置的绩效报告包含 `bars_with_fills` 等依赖缓存的图表时，也必须提供节点。

按照完整的 [`BacktestNode` 设置](backtesting/apis-and-runs.md#high-level-api)，在其 `BacktestRunConfig` 中设置 `dispose_on_completion=False`，然后传入已完成的结果和保留的节点：

```python
create_tearsheet(
    engine=result,
    node=node,
    output_path="backtest_results.html",
)
```

如果匹配的运行配置启用了节点释放，传入该节点会抛出 `ValueError`，因为其缓存和报告已不可用。

### 自定义

控制显示哪些图表以及它们的样式：

```python
from vibe_trader.config import TearsheetConfig
from vibe_trader.analysis import TearsheetDrawdownChart
from vibe_trader.analysis import TearsheetEquityChart
from vibe_trader.analysis import TearsheetRunInfoChart
from vibe_trader.analysis import TearsheetStatsTableChart

config = TearsheetConfig(
    charts=[
        TearsheetRunInfoChart(),
        TearsheetStatsTableChart(),
        TearsheetEquityChart(),
        TearsheetDrawdownChart(),
    ],
    theme="vibe_dark",
    height=2000,
)

create_tearsheet(
    engine=engine,
    output_path="custom_tearsheet.html",
    config=config,
)
```

### 货币过滤

对于多货币回测，可以将统计数据筛选到特定货币：

```python
from vibe_trader.model.currencies import USD

create_tearsheet(
    engine=engine,
    output_path="usd_only.html",
    currency=USD,  # Currency object, shows only USD statistics
)
```

当 `currency` 为 `None`（默认值）时，报告会分别显示所有货币的统计数据。只有在账户使用同一种货币时，系统才会根据账户报告重建收益率图表；多货币回测应传入 `currency`，使收益率图表使用所选货币。

对于 `BacktestResult` 输入，`currency` 会筛选 PnL 统计数据和账户余额，但结果中存储的收益率序列保持不变。

## 可用图表

绩效报告可以任意组合以下内置图表：

| 图表名称          | 类型   | 描述                                      |
| ----------------- | ------ | ----------------------------------------- |
| `run_info`        | 表格   | 运行元数据和账户余额。                    |
| `stats_table`     | 表格   | 绩效统计（PnL、收益率和一般指标）。       |
| `equity`          | 折线图 | 随时间变化的累计收益率，可选叠加基准。    |
| `drawdown`        | 面积图 | 相对净值峰值的回撤百分比。                |
| `monthly_returns` | 热力图 | 按年份排列的月度投资组合收益率。          |
| `distribution`    | 直方图 | 单期收益率值的分布。                      |
| `rolling_sharpe`  | 折线图 | 60 日滚动夏普比率。                       |
| `yearly_returns`  | 柱状图 | 年度收益率。                              |
| `bars_with_fills` | 蜡烛图 | 价格 K 线（OHLC），并以标记叠加订单成交。 |

所有图表都注册在图表注册表中，并通过 `TearsheetConfig.charts` 中的图表对象配置；每个图表对象对应一个内置图表名称。

### 运行信息表

`run_info` 图表显示回测运行的关键元数据：

- 运行 ID、开始时间、结束时间
- 回测期间（开始/结束日期）
- 处理的迭代总数
- 事件、订单和持仓计数
- 账户起始余额和期末余额（每种货币）

该表默认显示在左上角。

### 性能统计表

`stats_table` 图表按以下部分显示绩效指标：

- **PnL 统计**（按货币）：总 PnL、胜率、盈利因子等。
- **收益率统计**：夏普比率、索蒂诺比率、最大回撤等。
- **通用统计**：交易总量、平均交易持续时间等。

该表默认显示在右上角。

### 权益曲线

`equity` 图表绘制回测期间的累计收益率。向 `create_tearsheet()` 提供 `benchmark_returns` 后，会叠加基准序列以供比较。

```python
import pandas as pd

# Load benchmark returns (e.g., from a market index)
# Index should be datetime, aligned with strategy returns timeframe
benchmark_returns = pd.read_csv("sp500_returns.csv", index_col=0, parse_dates=True)["return"]

create_tearsheet(
    engine=engine,
    output_path="with_benchmark.html",
    benchmark_returns=benchmark_returns,
    benchmark_name="S&P 500",
)
```

基准序列会按原样绘制；请确保其索引与策略收益率日期对齐，以便准确比较。

### 月度和年度回报

`monthly_returns` 和 `yearly_returns` 图表默认显示复合（时间加权）收益率：每个单元格以该期起始余额衡量期间收益，各期间再复合为总收益率。

设置 `compounding=False` 可报告以固定初始资本衡量的简单非复合收益率。此时，每个单元格以初始资本的百分比衡量期间收益，因此各期间之和等于总收益率，而不是通过复合得到总收益率。这是名义收益率，也是采用固定交易规模并提取利润的恒定资本策略所使用的惯例。

```python
config = TearsheetConfig(
    charts=[
        TearsheetMonthlyReturnsChart(compounding=False),
        TearsheetYearlyReturnsChart(compounding=False),
    ],
)
create_tearsheet(engine=engine, config=config)
```

独立的 `create_monthly_returns_heatmap()` 和 `create_yearly_returns()` 函数接受相同的 `compounding` 参数。若要让非复合数值准确表示恒定资本，应按固定数量而非当前净值比例确定持仓规模；否则，后期数值会随运行余额增长而膨胀。

## 主题

主题控制图表的颜色、字体和背景等视觉样式。VibeTrader 提供四种内置主题：

| 主题名称       | 说明                               | 使用场景         |
| -------------- | ---------------------------------- | ---------------- |
| `plotly_white` | 带深灰色标题的简洁浅色主题。       | 默认的专业报告。 |
| `plotly_dark`  | 使用标准 Plotly 配色的深色背景。   | 弱光环境。       |
| `vibe`         | 使用 VibeTrader 品牌色的浅色主题。 | 官方浅色模式。   |
| `vibe_dark`    | 使用青绿/青色标志色的深色主题。    | 官方深色模式。   |

### 选择主题

在 `TearsheetConfig` 中指定主题：

```python
config = TearsheetConfig(theme="vibe_dark")
create_tearsheet(engine=engine, config=config)
```

### 自定义主题

注册自定义主题以在所有可视化中保持一致的品牌：

```python
from vibe_trader.analysis import register_theme

register_theme(
    name="corporate",
    template="plotly_white",  # Base Plotly template
    colors={
        "primary": "#003366",  # Navy blue
        "positive": "#2e8b57",  # Sea green
        "negative": "#c41e3a",  # Cardinal red
        "neutral": "#808080",  # Gray
        "background": "#ffffff",  # White
        "grid": "#e5e5e5",  # Light gray
        # Optional table colors (defaults will be provided if omitted)
        "table_section": "#e5e5e5",
        "table_row_odd": "#f8f8f8",
        "table_row_even": "#ffffff",
        "table_text": "#000000",
    },
)

# Use the custom theme
config = TearsheetConfig(theme="corporate")
```

主题系统会根据 `background` 和 `grid` 颜色，自动为 `table_*` 颜色提供合理默认值，从而兼容在引入表格专用颜色之前注册的主题。

## 配置

`TearsheetConfig` 类以声明方式控制绩效报告生成：

```python
from vibe_trader.analysis import GridLayout
from vibe_trader.config import TearsheetConfig
from vibe_trader.analysis import TearsheetDrawdownChart
from vibe_trader.analysis import TearsheetEquityChart
from vibe_trader.analysis import TearsheetStatsTableChart

config = TearsheetConfig(
    charts=[
        TearsheetEquityChart(),
        TearsheetDrawdownChart(),
        TearsheetStatsTableChart(),
    ],
    theme="vibe_dark",
    title="Q4 2024 Strategy Performance",
    height=1800,
    include_benchmark=True,
    benchmark_name="SPY",
    layout=GridLayout(
        rows=2,
        cols=2,
        heights=[0.60, 0.40],
        vertical_spacing=0.08,
        horizontal_spacing=0.12,
    ),
)
```

### 配置参数

| 参数                | 类型                   | 默认值           | 说明                     |
| ------------------- | ---------------------- | ---------------- | ------------------------ |
| `charts`            | `list[TearsheetChart]` | 内置图表         | 按顺序包含的图表。       |
| `theme`             | `str`                  | `"plotly_white"` | 样式的主题名称。         |
| `layout`            | `GridLayout`           | `None`           | 自定义子图网格布局。     |
| `title`             | `str`                  | 自动生成         | 绩效报告标题。           |
| `include_benchmark` | `bool`                 | `True`           | 显示提供的基准。         |
| `benchmark_name`    | `str`                  | `"Benchmark"`    | 基准的显示名称。         |
| `height`            | `int`                  | `1500`           | 总高度（以像素为单位）。 |
| `show_logo`         | `bool`                 | `True`           | 保留用于将来的徽标渲染。 |

当 `layout` 为 `None` 时，系统会根据图表数量自动计算网格尺寸和行高。默认的 8 个图表使用 4x2 网格，行高为 `[0.50, 0.22, 0.16, 0.12]`，为顶行表格留出更多空间。

## 自定义图表

注册表模式允许添加自定义图表。图表是将轨迹渲染到 Plotly 图形对象上的函数。

### 注册自定义图表

```python
from vibe_trader.analysis.tearsheet import register_chart
import plotly.graph_objects as go


def my_custom_chart(returns, output_path=None, title="Custom Chart", theme="plotly_white"):
    """
    Create a custom visualization.

    This function signature matches the built-in chart functions for consistency.
    """
    from vibe_trader.analysis.themes import get_theme

    theme_config = get_theme(theme)

    # Create your visualization
    fig = go.Figure()
    fig.add_trace(
        go.Scatter(
            x=returns.index,
            y=returns.cumsum(),
            mode="lines",
            name="Custom Metric",
            line={"color": theme_config["colors"]["primary"]},
        )
    )

    fig.update_layout(
        title=title,
        template=theme_config["template"],
        xaxis_title="Date",
        yaxis_title="Value",
    )

    if output_path:
        fig.write_html(output_path)

    return fig


# Register the chart for standalone use (via `get_chart()` / `list_charts()`)
register_chart("my_custom", my_custom_chart)
```

### 绩效报告集成

若要按正确的网格位置集成绩效报告，请使用 `register_tearsheet_chart`。`register_chart` 注册的是返回独立图形的函数；绩效报告渲染器则直接把轨迹绘制到共享子图网格单元，因此函数签名接收目标 `fig`，以及用于确定渲染位置的 `row` 和 `col`。

```python
from vibe_trader.config import TearsheetConfig
from vibe_trader.analysis import TearsheetCustomChart
from vibe_trader.analysis import TearsheetEquityChart
from vibe_trader.analysis import TearsheetStatsTableChart
from vibe_trader.analysis import register_tearsheet_chart


def _render_my_metric(fig, row, col, returns, theme_config, **kwargs):
    """
    Render custom metric directly onto a subplot.

    Parameters
    ----------
    fig : go.Figure
        The figure to add traces to.
    row : int
        Subplot row position.
    col : int
        Subplot column position.
    returns : pd.Series
        Strategy returns series supplied to the renderer.
    theme_config : dict
        Theme configuration dictionary.
    **kwargs : dict
        Additional parameters (stats_pnls, stats_returns, benchmark_returns, etc.).
    """
    metric_values = returns.rolling(30).std() * 100  # Example metric

    fig.add_trace(
        go.Scatter(
            x=returns.index,
            y=metric_values,
            mode="lines",
            name="30-Day Volatility",
            line={"color": theme_config["colors"]["neutral"]},
        ),
        row=row,
        col=col,
    )

    fig.update_xaxes(title_text="Date", row=row, col=col)
    fig.update_yaxes(title_text="Volatility (%)", row=row, col=col)


# Register for tearsheet use
register_tearsheet_chart(
    name="volatility",
    subplot_type="scatter",
    title="Rolling Volatility (30-day)",
    renderer=_render_my_metric,
)

# Now "volatility" can be used in TearsheetConfig.charts:
config = TearsheetConfig(
    charts=[
        TearsheetStatsTableChart(),
        TearsheetEquityChart(),
        TearsheetCustomChart(chart="volatility"),
    ],
)
```

渲染器函数接收全部必要数据（收益率、统计数据和主题配置），并直接渲染到指定的子图位置。

## 离线分析

如果已经有预先计算的统计数据，但没有 `BacktestEngine` 实例，请使用低级 API：

```python
import pandas as pd

from vibe_trader.analysis.tearsheet import create_tearsheet_from_stats

# Load precomputed data. The structure matches BacktestResult stats fields.
stats_pnls = {"USD": {"PnL (total)": 1500.0, "Win Rate": 0.55, ...}}  # Per-currency
stats_returns = {"Sharpe Ratio (252 days)": 1.2, "Max Drawdown": -0.15, ...}
stats_general = {"Avg Winner": 100.0, "Avg Loser": -50.0, ...}
returns = pd.Series(...)  # Daily returns with datetime index

create_tearsheet_from_stats(
    stats_pnls=stats_pnls,
    stats_returns=stats_returns,
    stats_general=stats_general,
    returns=returns,
    output_path="offline_analysis.html",
)
```

字典键应与 `engine.get_result().stats_pnls`、`engine.get_result().stats_returns` 和 `engine.get_result().stats_general` 返回的键一致。

此方法适用于：

- 分析分别存储的多次回测结果。
- 使用预先计算的指标比较策略。
- 与外部分析管道集成。

## 最佳实践

### 图表选择

- 使用默认图表进行探索性分析以查看所有可用指标。
- 当您知道哪些指标对您的策略很重要时，可以自定义图表。
- 删除不相关的图表以减少视觉混乱和文件大小。

### 主题使用

- 使用 `plotly_white` 制作专业报告和演示材料。
- 使用 `vibe_dark` 制作官方材料或在弱光环境中查看。
- 创建自定义主题以符合内部准则或个人喜好。

### 性能考虑

- 绩效报告 HTML 文件以内联方式包含全部数据，长时间回测生成的文件可能达到数 MB。
- 可考虑为不同分析时间范围分别生成绩效报告。
- 对于非常大的数据集，应使用独立图表函数，而不是完整绩效报告。

### 自定义统计集成

自定义图表最好与内置绩效报告图表所使用的同一组 `stats_pnls`、`stats_returns` 和 `stats_general` 字典配合。使用实时 `BacktestEngine` 时，这些值来自 `engine.get_result()`；离线分析时，则将兼容字典直接传给 `create_tearsheet_from_stats()`：

```python
stats_returns = {
    "Sharpe Ratio (252 days)": 1.2,
    "Custom Volatility Score": 0.42,
}
```

## API 层级

可视化系统提供两个 API 层级：

### 高级 API

推荐用于大多数用例：

```python
create_tearsheet(engine=engine, config=config)
```

自动从 `BacktestEngine` 或 `BacktestResult` 提取数据，生成全部已配置图表，并输出完整的 HTML 绩效报告。

### 低级 API

对于高级定制或离线分析：

```python
create_tearsheet_from_stats(
    stats_pnls=stats_pnls,
    stats_returns=stats_returns,
    stats_general=stats_general,
    returns=returns,
    run_info=run_info,
    account_info=account_info,
    config=config,
)
```

提供对数据输入的细粒度控制，并允许分析预先计算的统计数据。

### 独立图表函数

各图表函数可以独立使用，生成单一用途的 HTML 可视化或 Plotly 图形，以支持自定义分析流程。

#### 带成交标记的价格 K 线

`create_bars_with_fills` 函数生成叠加订单成交标记的蜡烛图，便于直观分析价格走势中的策略执行。它可以独立使用，也可以包含在绩效报告中：

```python
from vibe_trader.analysis import create_bars_with_fills
from vibe_trader.analysis import create_tearsheet
from vibe_trader.analysis import TearsheetBarsWithFillsChart
from vibe_trader.config import TearsheetConfig
from vibe_trader.analysis import TearsheetEquityChart
from vibe_trader.analysis import TearsheetStatsTableChart
from vibe_trader.model.data import BarType

# Standalone usage
bar_type = BarType.from_str("ESM4.XCME-1-MINUTE-LAST-EXTERNAL")
fig = create_bars_with_fills(
    engine=engine,
    bar_type=bar_type,
    title="ES Futures - Entry/Exit Analysis",
)
fig.show()  # Display in Jupyter
fig.write_html("bars_with_fills.html")  # Or save to file

# Include in tearsheet
config = TearsheetConfig(
    charts=[
        TearsheetStatsTableChart(),
        TearsheetEquityChart(),
        TearsheetBarsWithFillsChart(
            bar_type="ESM4.XCME-1-MINUTE-LAST-EXTERNAL",
            title="Bars with Fills",
        ),
    ],
)
create_tearsheet(engine=engine, config=config)

# Multiple bars-with-fills charts in one tearsheet
config = TearsheetConfig(
    charts=[
        TearsheetStatsTableChart(),
        TearsheetEquityChart(),
        TearsheetBarsWithFillsChart(
            bar_type=f"{instrument.id}-5-MINUTE-MID-INTERNAL",
            title=f"Bars with Order Fills - {instrument.id}",
        ),
        TearsheetBarsWithFillsChart(
            bar_type=f"{other_instrument.id}-5-MINUTE-MID-INTERNAL",
            title=f"Bars with Order Fills - {other_instrument.id}",
        ),
    ],
)
create_tearsheet(engine=engine, config=config)
```

该可视化用蜡烛图显示 OHLC 价格走势，并用三角形标记表示订单成交（绿色向上三角形表示买入，红色向下三角形表示卖出）。需要额外配置的图表（例如 `bar_type`）直接通过图表对象接收这些参数（例如 `TearsheetBarsWithFillsChart(bar_type=...)`）。

其他独立图表函数包括 `create_equity_curve`、`create_drawdown_chart`、`create_monthly_returns_heatmap` 等。完整列表请参阅 API 参考。

## 相关指南

- [回测](backtesting/) - 了解如何运行生成绩效报告的回测。
- [报告](reports.md) - 了解绩效报告中显示的底层统计数据。
- [投资组合](portfolio.md) - 了解投资组合跟踪和绩效指标。
