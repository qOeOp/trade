---
name: binance-liquidation-zones
description: 基于 Python 包 liquidator-indicator 和 Binance USDM 公开数据推断 liquidation-like price zones。当前接入只喂 aggTrades、premiumIndex 和 openInterest 快照，不依赖真实 liquidation feed。
---

# Binance Liquidation Zones

这是一个实验型只读 skill，回答“最近这段公开成交里，有没有明显像 liquidation cluster 的价格区”。

当前推荐由 agent 先协调上游只读 skill 拉数，再把 JSON 结果喂给这里的 Python 分析器。

## 快速开始

```bash
python3 -m pip install -r .agents/skills/binance-liquidation-zones/requirements.txt
./scripts/build-skills.sh
./.agents/skills/binance-aggtrades-fetch/scripts/binance-aggtrades-fetch --symbol BTCUSDT --market usdm --limit 500 > /tmp/btc-agg.json
./.agents/skills/binance-symbol-snapshot/scripts/binance-symbol-snapshot --symbol BTCUSDT --market usdm > /tmp/btc-snapshot.json
./.agents/skills/binance-liquidation-zones/scripts/binance-liquidation-zones --aggtrades-file /tmp/btc-agg.json --snapshot-file /tmp/btc-snapshot.json

# 手动直跑 fallback 仍然保留
./.agents/skills/binance-liquidation-zones/scripts/binance-liquidation-zones --symbol BTCUSDT
./.agents/skills/binance-liquidation-zones/scripts/binance-liquidation-zones --symbol ETHUSDT --lookback-minutes 60 --limit 1000 --zone-pct 0.0025
```

## 使用边界

- 当前只支持 `usdm`。
- 当前版本底层直接使用 Python 包 `liquidator-indicator`。
- 当前版本是公开数据推断，不是真实 liquidation feed。
- 输入主要来自：
  - 上游 `binance-aggtrades-fetch` 提供的 `aggTrades`
  - 上游 `binance-symbol-snapshot` 提供的 `premiumIndex`
  - 上游 `binance-symbol-snapshot` 提供的 `openInterest` 快照
- 当前优先消费 `--aggtrades-file` 与 `--snapshot-file`。
- 缺少输入时，才会退回 `--symbol` 直连 Binance 补数。
- 当前接入不会测量 OI 的连续变化，也不会做真实 liquidation 校验。
- 更适合当作观察层证据，不适合单独当下单依据。

## 输出约定

- 返回 `engine`、`marketContext`、`sample`、`zones`、`warnings`。
- `request.sources` 会标出 `aggTrades` / `snapshot` 是来自 `file` 还是 `network`。
- `dominantLiquidationSide=LONG` / `SHORT` 表示更可能是哪一边被清算。
- `qualityLabel`、`qualityScore`、`strength` 来自 `liquidator-indicator` 内部评分，只适合做相对排序。
