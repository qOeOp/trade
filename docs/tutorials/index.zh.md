# 教程

通过分步教程演示具体功能和工作流程。

:::info
大多数 Python 教程是文档 [tutorials 目录](https://github.com/qOeOp/trade/tree/main/docs/tutorials)中的 Jupytext percent-format 文件。您可以直接将其作为脚本运行，也可以通过 Jupytext 以 notebook 形式打开。Rust 教程请使用对应页面给出的命令。
:::

## 推荐顺序

初次使用 VibeTrader？建议按以下顺序学习：

1. [快速入门](../getting_started/quickstart) - 使用合成数据，在五分钟内运行首次回测
2. [回测（底层 API）](../getting_started/backtest_low_level) - 直接使用 `BacktestEngine`、真实市场数据和执行算法
3. [回测（高层 API）](../getting_started/backtest_high_level) - 使用 `BacktestNode` 和 Parquet 数据目录进行配置驱动的回测
4. [加载外部数据][loading_external_data] - 将 CSV 或其他外部数据载入 `ParquetDataCatalog`（操作指南）
5. [使用外汇柱数据回测][backtest_fx_bars] - 使用展期利息模拟进行外汇柱回测
6. 从下方选择一个特定主题的教程

## 回测

| 教程                                                            | 说明                                  | 数据     |
| :-------------------------------------------------------------- | :------------------------------------ | :------- |
| [使用外汇柱数据回测][backtest_fx_bars]                          | 外汇柱上的 EMA 交叉策略，并模拟展期。 | 随附数据 |
| [使用订单簿深度数据回测（Binance）][backtest_orderbook_binance] | 深度数据上的订单簿不平衡策略。        | 用户提供 |
| [使用订单簿深度数据回测（Bybit）][backtest_orderbook_bybit]     | 深度数据上的订单簿不平衡策略。        | 用户提供 |

## 数据工作流程

面向具体任务的数据处理方法，请参阅[操作指南](../how_to/)：

| 指南                                                  | 说明                                  | 数据               |
| :---------------------------------------------------- | :------------------------------------ | :----------------- |
| [加载外部数据][loading_external_data]                 | 将外部数据载入 `ParquetDataCatalog`。 | 用户提供           |
| [使用 Databento 构建数据目录][data_catalog_databento] | 使用 Databento schema 配置数据目录。  | Databento API 密钥 |

## 策略模式

| 教程                                                                | 说明                                           | 数据               |
| :------------------------------------------------------------------ | :--------------------------------------------- | :----------------- |
| [使用代理外汇数据进行均值回归（AX Exchange）](fx_mean_reversion_ax) | EURUSD‑PERP 上的布林带均值回归。               | TrueFX 代理数据    |
| [黄金永续合约订单簿不平衡（AX Exchange）](gold_book_imbalance_ax)   | XAU‑PERP 上的订单簿不平衡策略。                | Databento API 密钥 |
| [使用失联保护开关进行网格做市（BitMEX）](grid_market_maker_bitmex)  | 在 XBTUSD 上运行带服务器端保护的网格做市策略。 | Tardis.dev         |
| [使用短期订单进行链上网格做市（dYdX）](grid_market_maker_dydx)      | dYdX v4 永续合约上的网格做市策略。             | 用户提供           |

## 期权

| 教程                                                         | 说明                                         | 数据     |
| :----------------------------------------------------------- | :------------------------------------------- | :------- |
| [期权数据与 Greeks（Bybit）](options_data_bybit)             | 流式接收 Greeks 与期权链快照。               | 实时 API |
| [Delta 中性期权策略（Bybit）](delta_neutral_options_bybit)   | 使用永续合约对冲 Delta 的空头宽跨式组合。    | 实时 API |
| [Delta 中性期权策略（Derive）](delta_neutral_options_derive) | 使用权利金入场的 Derive ETH 宽跨式对冲策略。 | 实时 API |

## Rust

| 教程                                                                                   | 说明                                           | 数据                |
| :------------------------------------------------------------------------------------- | :--------------------------------------------- | :------------------ |
| [订单簿不平衡回测（Betfair）](backtest_book_imbalance_betfair)                         | Betfair L2 数据上的订单簿不平衡 Actor。        | 用户提供            |
| [使用 Databento EQUS NVDA 数据在 Lighter RWA 上进行组合做市](lighter_rwa_composite_mm) | NVDA-PERP 上由信号调整偏斜的做市策略。         | Databento + Lighter |
| [Hurst/VPIN 方向性策略（Kraken Futures）](hurst_vpin_kraken)                           | PF_XBTUSD 上经过市场状态过滤的知情订单流策略。 | Tardis.dev          |

[backtest_fx_bars]: https://github.com/qOeOp/trade/blob/main/docs/tutorials/backtest_fx_bars.py
[backtest_orderbook_binance]: https://github.com/qOeOp/trade/blob/main/docs/tutorials/backtest_orderbook_binance.py
[backtest_orderbook_bybit]: https://github.com/qOeOp/trade/blob/main/docs/tutorials/backtest_orderbook_bybit.py
[loading_external_data]: https://github.com/qOeOp/trade/blob/main/docs/how_to/loading_external_data.py
[data_catalog_databento]: https://github.com/qOeOp/trade/blob/main/docs/how_to/data_catalog_databento.py
