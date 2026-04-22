---
name: binance-liquidation-zones
description: OBSERVE 阶段的 Binance USDM liquidation-like zone 推断 skill。优先消费 aggTrades 与 symbol snapshot，再用 liquidator-indicator 从公开数据估计最近的 liquidation cluster。
---

# Binance Liquidation Zones

实验型只读 skill。回答“最近这段公开成交里，有没有明显像 liquidation cluster 的价格区”。

## 何时使用

- 当前轮处于 `OBSERVE`
- 需要补 liquidation-like 证据，而不是直接执行
- 已有或准备好 `aggTrades` 与 `snapshot`

## 不该使用

- 真实 liquidation 校验
- 单独作为下单依据
- 真实执行

## 输入口径

- 当前只支持 `usdm`
- 优先消费 `--aggtrades-file` 与 `--snapshot-file`
- 缺输入时才退回 `--symbol` 直连 Binance 补数
- 当前接入只用 `aggTrades`、`premiumIndex`、`openInterest` 快照

## 输出口径

- 返回 `engine`、`marketContext`、`sample`、`zones`、`warnings`
- `request.sources` 会标出输入来自 `file` 还是 `network`
- `dominantLiquidationSide` 表示更可能是哪一边被清算
- `qualityLabel`、`qualityScore`、`strength` 只适合做相对排序
