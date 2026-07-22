# strategy-review

## 职责

- 追加策略证据、生成策略复核报告、执行策略状态晋级门禁。
- 只治理策略证据与策略文档状态，不负责研发新候选、交易执行、交易所写入或数据抓取。

## 输入

- 策略文档：`--strategy <path>`。
- 证据 ledger：`--ledger <path>`，缺省由策略路径推导。
- 可选 data catalog：`--catalog-db <path>`。
- 可选本地交易事件库：`--db <path>`，只读用于从 review 事件生成 shadow evidence 或辅助 live-small 门禁。
- Legacy replay fingerprint：通过 `research.legacy-replay-fingerprint` 只读 owner surface 重算。
- JSON payload：`--json <payload>` 或 `--input <file>`。

## 输出

- JSON envelope：`strategy-review.script-response.v1`。
- Evidence record：`strategy-evidence-record.schema.json`。
- Review report：`strategy-review-report.schema.json`。
- Promotion result：`strategy-promote-result.schema.json`。

## 边界

- 可以写 strategy evidence ledger、data catalog、策略文档状态。
- 不写 `trade.db`；只读消费 `trade.db`。
- 不调用 Binance，不触发订单，不运行 R&D。
- 不直接 import 研发域 replay engine；只消费明确标记为 legacy 的 fingerprint owner surface 与稳定 evidence。
- 不把 legacy replay fingerprint 当作 native Trial Replay authority。
- 不直接写 RD program memory；RD 模块应自行消费 review report。

## 测试

- `bun run check`
- 真实功能烟测：用仓库内策略运行 `--strategy-review`，验证可独立从策略与 catalog 生成报告。
