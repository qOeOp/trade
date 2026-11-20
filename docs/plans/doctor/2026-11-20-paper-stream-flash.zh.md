# 2026-11-20 Paper 续跑链首次打开时净值图闪现“运行未启动”

用户发来生产环境正在运行的 Paper 页面（`price-action-trend-second-entry` / `pa-trend-second-entry@52`，续跑链的第 3 段）瞬时闪现的截图：净值图写 `No equity yet: the run has not started`，旁边写前序运行截点的 `Historical data through ... Stream disconnected`，询问是否 Paper 故障停机。运行本身正常；这是页面在首次打开（或切到）一条运行、服务器还没送来该运行的 `readings` 之前的过渡画面。

| Item | Value |
|---|---|
| Sessions | Google Antigravity，会话 `788827a2-0dd7-4f13-98f6-9fe578379779`（Gemini 4 Argon），2026-11-20；起止时刻 unknown |
| Audit session | 同一会话，写 PR [#3203](https://github.com/qOeOp/trade/pull/3203)；按评审更正触发条件由 Claude Code（Claude Opus 5.5）完成，同一 PR |
| Checkout / ledger | `origin/main` `dadab781a`；未读账本 |
| Coverage | `ide/web/src/state/{paperStream,paperChain}.ts`、`ide/web/src/model/{joined,observation}.ts`、`ide/web/src/widgets/paper/{ChartCard,EquityChart,Observation}.tsx`、`paper/serve.py`（流的事件次序）。缺口：没有在页面上复现，过渡窗口的时长没有计量 |
| Cost | unknown；未写账本或跑回放，0 个无效试验 |
| Net change | 本记录不改代码与 skill；拒绝码 249，skill 词数 28,094 |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261120-14 | 首次打开或切到一条在跑的续跑链运行时，服务器先送 `lines` 后送 `readings`，其间整条链的净值被置空，页面显示 `No equity yet: the run has not started` 与前序运行截点的 `Stream disconnected` | **用户指出**（Product contracts and delivery）：生产上在跑的 Paper 页面闪出该画面，问是否停机。<br>**当前产品**：`paper/serve.py` 的运行流每轮先发 `lines`、`closes`，读数有变才发 `readings`；`ide/web/src/state/paperStream.ts:77-83` 的 `follow()` 换到另一条运行时没有可沿用的 `readings`（同一运行换合约时沿用 `kept.readings`，`onerror` 重连也保留读数，这两种情形不触发）。`ide/web/src/model/joined.ts:89` 以 `current.readings &&` 门控整条链的 `readings`，前序运行已有的净值也一并成 `null`；`ide/web/src/widgets/paper/ChartCard.tsx:51` 只在链未读到时显示读取中，随后 `EquityChart.tsx:193` 显示 `No equity yet`；连接未建立时 `Observation.tsx` 以前序运行最后的收盘时刻显示 `Stream disconnected`。<br>**消费者**：在 IDE 查看在跑 Paper 的操作员，过渡画面像停机 | fix（`joined.ts` 不因当前运行的 `readings` 尚未送达而清空前序运行的净值；当前运行的流读数未到时 `ChartCard` 保持读取中，不显示 `No equity yet`） | unknown | open |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| 本次无 | | | | |

## Decisions

- 2026-11-20 用户确认只将该问题记录为 Doctor 发现并提交 PR。
