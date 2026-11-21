# 2026-11-21 导出把带尾随零的 tick 当成更细的精度

| Item | Value |
|---|---|
| Sessions | 无研究会话；来自 Paper 诊断：`币安人生USDT` 市场导出的合约 tick 为 0.0000001，exchangeInfo 为 0.0001 |
| Audit session | Claude Code（Claude Opus 5.5），0.5.0 清理的 D2–D5 会话；修复 PR 见索引 |
| Checkout / ledger | `origin/main` `a9f0f7928`；未读写账本、活动市场或 `market-full`，只用 scratchpad 里的临时市场 |
| Coverage | `market/instrument.py`（`decimals`、`build_instrument`）、`market/export.py`（`price_grid` 与精度选择）、`replay/comparison.py`（`traded_terms`、`_places`）；Binance 公开归档的 1m K 线 2025-10 至 2026-10 与 2026-11-21 的 exchangeInfo。缺口：没有跑 Paper 或回放 |
| Cost | unknown；价格不在 tick 网格上的导出，合约步长比历史价格所需细 10^(写出位数 − 所需位数) 倍 |
| Net change | 不增拒绝码；放宽 `PRECISION_NARROWED` 的判定（按 tick 的数值位数，不按写出位数）；不增存储字段，不改 skill |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261121-28 | 导出把 tick 字符串的尾随零算作小数位：`币安人生USDT` 的 tick `"0.0001000"` 在价格不在网格上时放宽到 0.0000001，而历史价格只需 0.00001 | **tick 历史**（Binance 归档 1m K 线，按 0.0001 网格逐分钟核对）：2025-10-20 上线至 2026-06-09 每天约 1,437 分钟不在 0.0001 网格上，价格都是 5 位小数（tick 0.00001）；2026-06-10 起改为 0.0001（当天 521 分钟，此后每天 9–65 分钟），2026-07 至 2026-10 每月仍有 275–453 分钟不在网格上；exchangeInfo：tickSize `0.0001000`、pricePrecision 7。<br>**写法普遍**：2026-11-21 的 exchangeInfo 里 956 个合约有 836 个的 tickSize 或 stepSize 带尾随零（如 BTCUSDT `0.10`、ZILUSDT `0.0000010`），即按 pricePrecision 写出。<br>**当前产品**：`market.instrument.decimals` 数字符串小数位（7），`market/export.py` 取精度 max(7, 历史所需 5) = 7，`build_instrument` 在不在网格上时放宽到 10^-7。复现：`build_instrument` 以 `"0.0001000"`、精度 7、`on_grid=False` 得 `0.0000001`；临时市场导入 2026-10 后导出 2026-10-05..12（市场日 2026-10-30），修复前回执 `price_precision` 7、目录合约 tick `0.0000001`，修复后 5、`0.00001`。<br>**消费者**：回放撮合（Nautilus 按合约 tick 接受限价与止损价）与 `replay/comparison.traded_terms`（按 10^-price_precision 还原放宽后的 tick） | authority（改 `PRECISION_NARROWED` 的判定；Claude 按用户委托决定） | unknown | 见索引 |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|

## Decisions

- 2026-11-21 用户把需要定夺的事项交给 Claude（「需要我定的部份最后也是一样由你决定按推荐做」），0.5.0 清理协调会话据此选修法 A：
  - tick 的位数是去掉尾随零后的小数位（`market.instrument.tick_decimals`）；`PRECISION_NARROWED` 只在导出精度少于这个位数时拒绝（原先按写出位数，`0.10` 精度 1 也被拒）。
  - 价格不在 tick 网格上时，导出精度取历史价格所需的位数（不少于 tick 的位数），放宽后的步长随之是 10^-所需位数；在网格上的合约照旧按写出位数，导出不变（ZILUSDT 2025-10-05..12、市场日 2025-10-30 的 `export_sha256` 修复前后相同）。
  - 未选修法 B（保留写出精度、只改放宽步长）：`traded_terms` 只能从回执的 `price_precision` 还原步长，要么算错，要么给回执加存储字段。
