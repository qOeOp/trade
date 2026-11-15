# Live 证据包的资金费历史行和 metrics 行、Paper 日志的 FUNDING 预热事件：存储字段审阅

2026-11-15。涉及三个存储值：

- 前两个随 #3016（资金费预热历史）合并，当时没有做独立审阅；
- 第三个是新提出的。

用户在 2026-11-15 授权（"授权"，并选了"#3016 的两项"和"Live 记录 metrics"）。按 AGENTS.md 的要求，先由一个独立子代理审阅这三项，再记录在这里。审阅只读代码，基于 `origin/main` 8b89b1a1b。

## 结论

| 存储值 | 审阅结论 | 改动 |
|---|---|---|
| Live 证据包 `historical_funding` 行 | 需要 | 去掉 `ts_init`，因为它恒等于 `ts_event` |
| Paper 日志 `warmup` 事件，周期 `FUNDING` | 需要，保持原样 | 无 |
| Live 证据包 `metrics` 行（新） | 需要；比较代码必须同时上线 | 不存 `ts_init`，因为它恒等于 `ts_event + 5 分钟` |

三项都只在执行记录里：

- Live 的私有目录 `evidence/market.jsonl`；
- 远端主机的 Paper 数据库。

它们不进研究账本、DoltHub 或 Git。

## 1. Live `historical_funding` 行

字段：`wall_ns`、`kind`、`instrument_id`、`ts_event`、`rate`。

- **谁读它**：
  - `live/compare.py` 的 `run_record` 把这些行交给 `replay.comparison.received_warmup`，按合约算出 FUNDING 摘要；
  - 这个摘要有三个用处：
    - 决定比较回放从哪一刻开始导出（`history_start`，用 `first_ts_event`）；
    - 与档案的同一段结算比对（`archive_funding`、`warmup`）；
    - 作为差异原因 `warmup` 的依据；
  - IDE 的比较视图显示这个结果。
  - `wall_ns` 也有人读：`segment()` 靠它让每次重新预热只用自己的行。
- **独立事实**：源在预热时实际收到的结算，来自 Binance REST `fapi/v1/fundingRate`。回放读的是市场档案，只有这一行能说明两者是否一致。
- **为什么现有数据推不出来**：
  - WARMUP 声明只给条数；
  - 日志的 `warmup` 事件只有计数；
  - 事后重读 REST 得到的是那时的答案，不是源当时收到的。
- **改动**：去掉 `ts_init`。
  - `funding_update` 的所有时间戳都是结算时刻，`received_warmup` 也只读 `instrument_id`、`ts_event` 和 `rate`。
  - 每次预热只有几十行，与 `historical_bar` 相当，所以存行而不只存摘要。

## 2. Paper 日志 `warmup` 事件，周期 `FUNDING`

- **谁读它**：`paper/compare.py` 读每个合约每个周期的 `bars`、`first_ts_event`、`last_ts_event`、`sha256`，之后走和第 1 项相同的比较路径。
- **其他读者**：
  - IDE 只读比较结果里的 `warmup.same`；
  - `ledger/paper.py` 只把日志封存在 Paper 数据库，不进研究账本。
- **独立事实**：这个 Paper 进程从 REST 收到的结算的摘要。
- **改动**：无。它是已有事件类型的一个新周期值，每个字段都有人读，摘要已经是最窄的形式。计数字段沿用 `bars` 这个名字。

## 3. Live `metrics` 行（本次新增）

字段：

- `wall_ns`、`kind`；
- `instrument_id`、`ts_event`；
- `sum_open_interest` 和三个多空比，以十进制文本或 null 保存。

**记录点**：`engine/live_source.py` 的 `_gated("on_data")`。

- 先过停止门：停止意图生效后，这一行既不交给源，也不记录。
- 再交给源：源没有定义 `on_data` 也照样记录。

**谁读它**：本次一并上线的比较代码。

- `replay.comparison.compare_metrics` 按合约比对收到的行和档案的行。档案行就是回放按规则 `binance-metrics-visible-v2` 送的行，由 `archive_metrics` 经 `market.export.metrics_rows` 和 `shown_ratio` 读出。比对结果分五类：
  - 缺失；
  - 只有 Live 有；
  - 数值不同（按 Decimal 比较）；
  - 晚到（`wall_ns` 晚于送达时刻超过 2 秒）；
  - 两边的行数。
- 比对的时间范围：从这一段收到的第一行起，到比较窗口结束为止。这样每次重启后 Feed 从下一行开始，不会被算成缺失。
- 结果的三个去处：
  - 每个合约的 `inputs.<symbol>.metrics`；
  - 汇总里的 `missing_metrics`、`late_metrics`、`differing_metrics`；
  - 新的差异原因 `metrics`，排在 K 线三类原因之后、`warmup` 之前；只有 Live 有的行不算原因。
- IDE 加了这个原因的文字。同时补上了一直缺的 `entry_gate` 文字。

**独立事实**：Feed 实际交给源的东西。REST 和档案都给不出这些：

- 到截止还缺、因而为 None 的比值；
- 因为没有持仓量而跳过的行，现在只在节点日志里有一条警告；
- 重启后的第一行；
- 停止后被挡住的行；
- 送达的迟早。

**考虑过的其他做法**：

- 比较时再从 REST 重建：REST 只保留 30 天，而 Live 连续运行不结束；REST 给的也是最终值，不是截止时收到的值。
- 只存摘要：找不到具体缺哪一行、哪一行不同，也量不出迟早；永不结束的运行也没有写摘要的时点。
- 不存：留下 `binance-metrics-rest-parity.zh.md` 里写明的缺口。

**大小**：每个合约每天约 288 行。

## 仍然留下的

- 源中途退订 metrics（`_metrics_unfollow`）不会留下记录，退订之后的行会被算成缺失。已由 `live-evidence-metrics-unsubscribe-field-review-20261115.zh.md` 补上。
- Paper 日志不记录 metrics，所以 `paper compare` 查不到 Paper 收到的 metrics。已由 `paper-journal-metrics-field-review-20261115.zh.md` 补上：Paper 日志记录同样的 `metrics` 行和 `metrics_unsubscribed` 行。
- 档案里头部持仓比落在第 4 位中点的行（约 1/100），曾会显示为差 0.0001 的不同值，并可能成为差异原因 `metrics`。已由 `binance-metrics-rest-parity.zh.md` "中点行的比较容差"一节补上：比较对这些行另外接受中点的 half-down 值。
