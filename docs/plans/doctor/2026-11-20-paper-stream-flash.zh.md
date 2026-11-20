# 2026-11-20 Paper 续跑链净值图在流重连或切页时闪现“运行未启动”与历史截点

用户发来生产环境正在运行的 Paper 页面（`price-action-trend-second-entry` / `pa-trend-second-entry@52`，顶部工具栏显示 `4d 2h · last bar 35s ago`、`Equity 99,880.38 USDT Return -0.12%`）瞬时闪现的截图，询问是否是 Paper 故障停机。经对当前 `origin/main` 代码核查，后台容器中的 Paper 运行正常，该画面是前端在续跑链（Run 3）的 SSE 流断开/重连或视图切换窗口内，因 `current.readings` 为空将整条链净值抹成空数组而触发的误导性空状态。

| Item | Value |
|---|---|
| Sessions | Google Antigravity，会话 `788827a2-0dd7-4f13-98f6-9fe578379779`（Gemini 4 Argon），2026-11-20 |
| Audit session | 同一会话；聚焦诊断（Paper 页面续跑链 SSE 重连与净值图过渡状态），只写本记录与 `docs/plans/doctor/index.zh.md` |
| Checkout / ledger | `origin/main` `dadab781a` |
| Coverage | `ide/web/src/state/{paperStream,paperChain,runData,stretches}.ts`、`ide/web/src/model/{joined,stretches,observation,recovery}.ts`、`ide/web/src/widgets/paper/{ChartCard,EquityChart,Observation,equityStretches}.tsx` |
| Cost | 聚焦诊断约 10 分钟；未写账本或跑回放，0 个无效试验 |
| Net change | 本记录不改代码与 skill；拒绝码 249，skill 词数 28,094 |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261120-14 | Paper 续跑链在 SSE 流闪断重连或切换 `Equity` / 合约视图期间，若最新运行（如 `Run 3`）的 `readings` 尚未送达或为空，`joined()` 将整条链的 `readings` 置为 `null`，导致正在运行且顶部已显示实时净值与 `last bar 35s ago` 的页面瞬时闪现 `No equity yet: the run has not started`，同时右侧用前序已封存运行的最后 bar 时间显示 `Historical data through ... Stream disconnected`，易被误判为 Paper 故障停机 | **用户指出**（`Product contracts and delivery`）：生产上在跑的 Paper 闪了一下该截图，询问是不是 Paper 故障都停了。<br>**当前产品**：① `ide/web/src/model/joined.ts:85-94` 拼接续跑链时，虽然 `const equity = all.flatMap(...)` 已算出前序运行（`earlier`）缩放后的净值序列，但第 89 行 `const readings: Readings \| null = current.readings && { ... }` 以 `current.readings` 为门控——只要最新运行的 `readings` 尚未到达（例如 `ide/web/src/state/paperChain.ts:21-38` 的 `usePieces` 在首次挂载或未命中缓存重新打开 `EventSource` 等待 `readings` 事件，或 `follow()` 切换 `symbol` 的间隙），整条链拼接出的 `piece.readings` 即为 `null`；② `ide/web/src/widgets/paper/ChartCard.tsx:51` 的加载骨架屏条件 `!stretches.some((x) => x.chain.some((r) => r.paper_id === run.paper_id))` 在 `stretches` 已生成但 `piece.readings` 为 `null`（或 `continuous()` 因 `path` 为空跳过该段，`ide/web/src/widgets/paper/equityStretches.ts:52,104`）时直接放行渲染 `EquityChart`，触发 `ide/web/src/widgets/paper/EquityChart.tsx:193` 显示 `"No equity yet: the run has not started"`；③ 与此同时，已合并进 `s.closes` 的前序运行历史收盘价仍在 `s` 中，`ide/web/src/model/observation.ts:18-21` 的 `observedThrough(s.bars, s.closes)` 取到前序运行结束时刻（`2026-11-17 10:41 GMT+9`），因距当前超过 `LAG_MS`（2 分钟）且 `!s.connected`，`ide/web/src/widgets/paper/Observation.tsx:13,24-25` 同屏渲染黄字 `Historical data through 2026-11-17 10:41 GMT+9 Stream disconnected`。<br>**消费者**：在 IDE 查看生产 Paper 续跑链运行状态的操作员（瞬时空白图与“运行尚未启动 / 历史数据停在数天前”组合提示造成停机误判） | fix（① `paperChain.ts` / `paperStream.ts` 在切换 `symbol`（`Equity` ↔ 合约）或流重连时保留该运行已收到的最新 `readings`；② `joined.ts` 在前序运行已有 `equity` 或 `run.readings` 摘要已存在时不因 `current.readings` 尚未推送而将整条链净值置空；③ `ChartCard.tsx` 在运行已有 `run.readings` 但流里的 `piece.readings` 尚未就绪时保持 `ChartSkeleton` 过渡，不渲染 `"No equity yet: the run has not started"`） | minutes | open |

## Removal list

无。

## Decisions

- 2026-11-20 用户确认只将该问题记录到 Doctor finding 并提交 PR。
