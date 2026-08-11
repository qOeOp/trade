# 入门

## 1. 安装

设置 Python 3.12-3.14 环境，并从仓库根目录构建包：

```bash
make build-debug
```

有关前置条件和源代码构建选项，请参阅[安装](installation)指南。

## 2. 运行快速入门

[快速入门](quickstart)使用合成数据，让你在五分钟内完成第一次回测，无需下载或设置 catalog。

入门教程都使用简单的 EMA 交叉策略。这是有意的安排：重点不在交易逻辑，而在教授引擎如何运作，
包括数据加载、场所模拟、订单生命周期和报告。当你理解引擎机制后，[教程](../tutorials/)会介绍
不同策略，包括均值回归、订单簿不平衡和网格做市。

## 3. 选择路径

- **回测**--先学习下方两个 API 层级，再阅读[教程](../tutorials/)中的策略模式演练。
- **实盘交易**--参阅[配置实盘交易节点](../how_to/configure_live_trading.md)操作指南，以及列出受支持
  场所的[集成](../integrations/)。
- **数据工作流**--参阅[操作指南](../how_to/)，了解如何加载外部数据并设置 Parquet 数据 catalog。
- **构建适配器**--参阅[开发者指南](../developer_guide/)。

## 回测 API 层级

VibeTrader 提供两个回测 API 层级：

| API 层级                        | 入口             | 最适合                                   |
| :------------------------------ | :--------------- | :--------------------------------------- |
| [低级 API](backtest_low_level)  | `BacktestEngine` | 直接访问组件、开发库                     |
| [高级 API](backtest_high_level) | `BacktestNode`   | 生产工作流、更容易迁移到实盘交易（推荐） |

高级 API 需要基于 Parquet 的数据 catalog。低级 API 可以使用内存数据，但没有实盘交易迁移路径。

:::warning[每个进程一个节点]
由于存在全局单例状态，不支持在同一进程中并发运行多个 `BacktestNode` 或 `LiveNode` 实例。
每次运行之间正确释放资源后，可以顺序执行。

详情请参阅[进程与线程](../concepts/architecture.md#processes-and-threads)。
:::

有关选择 API 层级的帮助，请参阅[回测](../concepts/backtesting/)概念指南。

## 仓库中的示例

在线文档只展示部分示例。完整集合请参阅 GitHub 上的仓库：

| 目录                                                           | 内容                             |
| :------------------------------------------------------------- | :------------------------------- |
| [examples/](https://github.com/qOeOp/trade/tree/main/examples) | 按环境组织的可运行 Python 示例   |
| [docs/tutorials/](../tutorials/)                               | 演示常见工作流的教程             |
| [docs/concepts/](../concepts/)                                 | 用代码片段说明关键功能的概念指南 |
| [python/tests/unit/](../../python/tests/unit/)                 | 覆盖核心功能和边界情况的单元测试 |
