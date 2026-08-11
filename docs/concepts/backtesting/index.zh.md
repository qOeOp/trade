# 回测

回测使用历史数据模拟交易，并复用实盘交易中的相同核心系统组件：内置引擎、`Cache`、
[MessageBus](../message_bus.md)、`Portfolio`、[Actor](../actors.md)、[策略](../strategies.md)、
[执行算法](../execution.md)和用户定义模块。

`BacktestEngine` 处理历史数据流。当数据流耗尽时，引擎会生成供分析使用的结果和绩效指标。
VibeTrader 为回测提供两个 API 层级：

| API 层级 | 适用场景                                                 |
| -------- | -------------------------------------------------------- |
| 高级     | 需要 `BacktestNode`、配置对象、数据 catalog 和批量运行。 |
| 低级     | 需要直接控制 `BacktestEngine` 并手动设置组件。           |

本章节的页面介绍当前 Rust 回测引擎及其 Python 包根 API。

## 阅读指南

生成的侧边栏可能按字母顺序排列这些页面。从头到尾阅读本章节时，请使用以下顺序：

| 步骤 | 页面                                          | 用途                                |
| ---- | --------------------------------------------- | ----------------------------------- |
| 1    | [API 与重复运行](apis-and-runs.md)            | 选择 API 层级、加载数据并运行批次。 |
| 2    | [数据与场所](data-and-venues.md)              | 使数据粒度与场所 `book_type` 匹配。 |
| 3    | [执行流程](execution-flow.md)                 | 理解顺序、定时器和成交 ID。         |
| 4    | [成交价格与撮合](fill-prices-and-matching.md) | 理解确定性的撮合行为。              |
| 5    | [成交执行](trade-execution.md)                | 使用成交 tick、主动方和队列。       |
| 6    | [K 线执行](bar-execution.md)                  | 使用 K 线、OHLC 顺序和 K 线时点。   |
| 7    | [成交模型](fill-models.md)                    | 配置滑点和概率成交。                |
| 8    | [账户与保证金](accounts-and-margin.md)        | 配置资金结算、余额和保证金模型。    |

## 相关指南

- [策略](../strategies.md)：开发用于回测的策略。
- [可视化](../visualization.md)：从回测结果生成 tearsheet。
- [报告](../reports.md)：分析回测绩效数据。
