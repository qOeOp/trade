# 2026-10-31 研究图的线归属与关系表达

| 项 | 值 |
|---|---|
| 会话 | Codex `rollout-2026-10-31T10-21-15-01a18f8b-f2b7-7b11-937d-a80f36e75777.jsonl`，2026-10-31 01:21Z 起，诊断时（01:38Z）仍在运行：research-start → 用户选 B 继续 Channel BreakOut；只作现场样本，不是整场审计。10-30 的 `01a18ac0`（设计站首页图）不写账本；`rollout-2026-10-31T02-43-59-*` 与 `rollout-2026-10-30T02-43-59-*` 是导入的 Claude Code 会话 |
| 诊断会话 | Claude Code，claude-opus-5-5，会话 7ad4896a-82c3-47c0-9d06-66935c4ed55a，worktree `doctor-graph-20261031`；本会话只写这份记录和索引 |
| 检出 / 账本 | main `8732f5960`，写记录前复核到 `dc1498097`（只多 #1929 市场导入）。账本：上次整场审计止于 `7v7p8mkm0dkj8a44uho0g09hocoq0tv7`（trial 464）；之后到 `drri95fb6cm6rqtembqe47a8fregnehm` 共 8 个提交，全部来自 01a18f8b（4 个 judgment、`channel-breakout-15m-mid80@1/@2`、trial 465 开启与封存） |
| 覆盖 | 聚焦问题：用户指出 IDE 研究图随研究增多而混乱、关系不清；之后又指出一条穿过节点的连线（-06）。读 `report/graph.py`、`ledger/lines.py`、`services/ide/research_graph/layout.py`、`report/seams.py`；在 IDE 容器内（IDE 实际路径、只读账户）对 6 条线各生成 `research graph --at drri95fb…` 并用 `build_view` 生成视图，逐线统计版本归属、状态、轴跨度与行数；IDE 页面目视核对 v7 线。未分派三个工作流子代理，未做账本保真测试；01a18f8b 结束后仍需整场审计 |
| 成本 | 本诊断约 1 h，token 未计。研究会话代价：-05 使 01a18f8b 的 `research state` 两次返回置空的市场篮子度量（01:22Z、01:28Z），对决定的影响未量；其余各项是展示问题，未计量 |
| 净变化 | -02：`_lineage` 遍历加一个条件（不穿过研究运行全在别线的版本），图的 gaps 一句改写；-03：视图 x 从全局 trial 号改为本线 trial 序号，trial 号留作标签，删去无人读的 `axis.ticks`，README 视图表与设计页各一句；-04：视图新增 `revisions`，无父版本的修订以虚线连到同 strategy ID 的上一修订，行不变；-05：`_market_profile` 按库名命中多份时取 active 那份或拒绝歧义，加一个测试；-06：连线路径移入 `geometry.elbowPath`，子节点在左时多一个分支，加一个几何测试。0 个存储字段、0 个拒绝或审计改动、skill 0 词 |

## 发现

| id | 发现 | 证据（会话或规范；当前产品；消费者与决策） | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261031-02 | 线的版本集合沿父链与同 strategy ID 做传递闭包（`report/graph.py:38-58`），一个父链接通两条线就把对方整片版本拉进来，并按“本线无研究运行”画成 unrun / precheck_failed | v7 线 `ema-entryvar-rollingref@1` 登记为 v6 候选的派生（见 20261025-14），两条已关 EMA 线的图因此各画同一组 75 个版本：v7 线 6 个本线版本之外 64 个属 `ema-cross-btc-daily`，视图里 47 个 unrun、22 个 precheck_failed，另画 140 个别线候选的预检/探索 trial 和 22 个别线评审的 `eligibility_change`；IDE Versions 面板把 v6 线起点 `ema-cross-root@2`（在 v6 有研究运行 trial 3，图里只剩它的预检 2 与探索 4）标 Failed。其余 4 条开放线没有跨线父链，此病不发作。读者据此会以为 v6 版本从未运行或被拒 | fix（遍历不穿过研究运行全在别线的版本；本线研究过的、本线起点、以及无任何研究运行且父/同名修订在本线的版本照收；不加存储字段）；用户 2026-10-31 批 | wrong output | fixed 38989265c [#1938](https://github.com/qOeOp/trade/pull/1938) |
| 20261031-03 | 视图 x 用全局 trial 号（`layout.py:7-11`），#1855 允许多线并开后各线 trial 交错，本线运行只占轴的一小段 | `channel-breakout-15m`：26 个研究运行（88 个本线 trial）铺在 215–466 共 251 个单位，360 之后到 465 之间 100 个单位全是别线 trial；`ema-entrybudget-202210` 33 个运行跨 226；`rsi-intraday-15m` 21 个跨 94。IDE Progress 图在同样宽度里只见零星几根柱。“x 是 trial 号”这一契约定于单线时期 | fix（x 取本线 trial 的序号，trial 号作刻度标签；改 `research-graph-view@1` 说明与设计页一句）；用户 2026-10-31 交由诊断会话处理 | unknown | fixed 2e7b4f5bf [#1942](https://github.com/qOeOp/trade/pull/1942) |
| 20261031-04 | 同一 strategy ID 的修订（修缺陷、不改规则）在账本里由 strategy ID 表达，视图只画父边、每个修订各占一行，修复链显示成与原链并列、互不相连的第二棵树 | `channel-breakout-15m@3` 修复 @2 的保护缺陷，按 strategy-authoring 规则仍是根（`parent` 为空），其后 `h20@3`、`wait@3/@4`、`close@2`、`exit40@3` 复制了 @2 下的整条链；图里三个根、33 行对 21 个 strategy ID，被屏蔽的旧链与修复链之间没有边。关系在账本里可推导（同 ID、revision 递增），属读路径缺失 | fix（视图新增 `revisions`：画出的版本没有父版本时，从同 strategy ID 已画出的最近一个更早修订连一条虚线；父边、行与 Versions 树不变。原拟合行：同 ID 修订常只隔几个 trial，同行标签会互相压住，故改连线）；用户 2026-10-31 交由诊断会话处理 | unknown | fixed 8393ccbc1 [#1944](https://github.com/qOeOp/trade/pull/1944) |
| 20261031-05 | 市场日收益按库名找配置时取排序第一份（`report/seams.py:23-38`）；宿主 `market-remote.json`（10-30 07:24Z 远端供给试验留下，只有 remote_url）与 `market.json` 同为库 `market`，按文件名排在前面 | 宿主上 `research graph` 对 6 条线全部 `MARKET_UNREACHABLE`；`research state`、`replay report --trial-id 360`、`hypothesis compare`（trial 360）完成但 18 处市场篮子度量（`up_month_notional@1` 等）置空，`null_reason` 写 `market-remote names no readable service`。01a18f8b 在 01:22Z、01:28Z 两次读到这些空值。IDE 容器只有一份 `market.json`，不受影响 | fix（按库名命中多份时取 role 为 active 的那份，没有则以歧义拒绝；加测试）；宿主上删除或改名 `market-remote.json` 是用户的配置，待定；用户 2026-10-31 批修复 | wrong output | fixed 8bcf1c398 [#1937](https://github.com/qOeOp/trade/pull/1937) |
| 20261031-06 | 子节点只跑过预检、画在父节点左边时，父边沿子节点所在行向左横穿它的名字、徽章和标记，停在它左端，像一条不连任何东西的线（`services/ide/web/src/widgets/lineage/Elbow.tsx`） | 用户 2026-10-31 在 Channel BreakOut 线指出：`channel-breakout-15m-wait@3` 预检 trial 263 早于父版本 `h20@3` 的研究运行 276；6 条线中只有这一条边如此。首版修复从上方落进标记，用户指出插进选中色块、与其他边锚点不齐、4px 圆角像直角，改为沿节点上方空隙绕到左侧、在行中线从左端进入 | fix（只改连线走法，节点位置不动；路径进 `geometry.elbowPath` 由几何测试覆盖） | none | fixed 4e953d7ce [#1939](https://github.com/qOeOp/trade/pull/1939) |

## 现场观察（01a18f8b 仍在运行，不立项）

- 01:31Z 预检在接触行情前被拒：market-supply 容器仍跑 pre-#1921 镜像 `d307b5cabe81`，导出器标识与检出 `8732f5960` 不符（升级按用户 10-31 的话等 aggTrades 导入队列完成）。Agent 写了临时配置 `/tmp/channel-20261031-local-market.json` 直连本机 Dolt 服务导出，登记的导出内容指纹与对照 trial 339 一致，活动配置未改。整场审计时核对：这条绕行是否该由 readiness 写明，以及部署漂移是否应在 research-start 开头读出。
- `channel-breakout-15m-mid80@1` 发布 45 s 后只改源码头注释发布 @2，@1 永久成为没有 trial 的版本；全账本同类 2 例（另一例 `rsi-intraday-15m-persist@1`，63 s）。这类版本是展示噪音，不另立项。
- 新线的 judgment 多不带 `supersedes`（channel 17 条推荐只 2 条带）；`judgment add` 帮助写明独立结论是新 judgment，单值种类读最新一条，不是缺陷。

## 移除清单

无。

## 决定

用户 2026-10-31：先修 -05 与 -02（#1937、#1938）；-06 由用户截图指出后修（#1939）；其余交由诊断会话处理（-03 #1942、-04 #1944）。`market-remote.json` 留在宿主未动：#1937 后同名库取 active 配置，它不再被误读，删除或改名仍是用户的配置。编号：#1935 先占用 20261031-01，本记录各项顺延一位；#1937、#1938 的说明按旧编号写作 -04、-01。
