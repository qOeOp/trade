---
name: binance-aggtrades-fetch
description: OBSERVE 阶段的 Binance aggTrades 原始数据 skill。用于给 liquidation-zone、microstructure 或其他上层分析提供最近一段聚合逐笔成交材料。
capability_class: [R, A]
writes:
  trade_db: false
  evidence_ledger: false
  artifacts: false
  binance: false
requires_preflight: false
---

# Binance AggTrades Fetch

只读 skill。底层原子数据入口，不是默认用户主入口。

## 何时使用

- 需要最近一段聚合逐笔成交做微观结构分析
- 需要给 liquidation-zone 推断提供原始 trade feed
- 需要按 `fromId` 或时间窗回补成交材料

## 不该使用

- 策略解释
- 账户恢复
- 真实执行

## 脚本边界

- 只读，不需要鉴权
- 只支持 USDM 永续（`futuresAggTrades`），不暴露 market 参数
- 输出是原始成交材料的轻度标准化版本
- `takerSide` 只是从 `isBuyerMaker` 推导出的主动方向提示，不等于最终交易结论
- 默认 `limit=500`
- 支持 `--from-id`、`--start-time`、`--end-time`
- 返回 JSON，包含 `request`、`summary`、`trades`
- 本 skill 服务在线近期观察；长期 R&D 的 aggTrades 由 `ohlcv-fetch/market-features.ts --microstructure-days` 从 Binance Vision 校验并聚合，避免把大体积原始成交长期落盘
