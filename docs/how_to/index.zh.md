# 操作指南

这里提供面向常见任务的目标导向操作指南。每篇指南都假定读者已熟悉 Vibe 的基本概念，并聚焦于一个具体结果。

如果刚接触 Vibe，请先阅读[入门](../getting_started/)路径和[教程](../tutorials/)。

## 数据工作流程

| 指南                                                  | 描述                                   |
| :---------------------------------------------------- | :------------------------------------- |
| [加载外部数据][loading_external_data]                 | 将 CSV 数据加载到 Parquet 数据目录中。 |
| [使用 Databento 构建数据目录][data_catalog_databento] | 使用 Databento 市场数据建立数据目录。  |

## 实盘交易

| 指南                                       | 说明                                      |
| :----------------------------------------- | :---------------------------------------- |
| [配置实盘交易节点](configure_live_trading) | 配置 LiveNodeConfig、执行引擎与交易场所。 |
| [Lighter 入门](get_started_lighter)        | 通过 Rust 或 Python 接入 Lighter。        |

## Rust

| 指南                                         | 描述                                               |
| :------------------------------------------- | :------------------------------------------------- |
| [编写 Actor (Rust)](write_rust_actor)        | 使用订阅和处理程序构建数据 Actor。                 |
| [编写策略 (Rust)](write_rust_strategy)       | 构建具备订单管理能力的策略。                       |
| [运行回测 (Rust)](run_rust_backtest)         | 将 BacktestEngine 或 BacktestNode 与目录一起使用。 |
| [运行实盘交易 (Rust)](run_rust_live_trading) | 使用 LiveNode 连接到交易场所。                     |

[loading_external_data]: https://github.com/qOeOp/trade/blob/main/docs/how_to/loading_external_data.py
[data_catalog_databento]: https://github.com/qOeOp/trade/blob/main/docs/how_to/data_catalog_databento.py
