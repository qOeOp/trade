# 2026-10-28 换线后在 quotes 补证上空转的研究启动完整审计（Codex 会话 01a17cec，事后独立复审）

本记录按 product-doctor 的全部步骤加 Convergence，对 Codex 研究会话 01a17cec 做完整、独立的审计。
- **独立性**：审计在另一宿主、另一模型族上运行。只读原始 transcript（主会话与四个子会话）、检出、账本与市场的只读命令、CI 日志，以及跟读会话保留的原始证据（`/tmp/doctor-01a17cec/evidence/`，先读 `manifest.md`），未读跟读会话的笔记、PR 正文与它的对话副本（`~/.codex/sessions/2026/10/28/rollout-2026-10-28T00-45-54-01a17e0a-1d1a-…`，内容是跟读会话本身，只核对了其中的用户原话在 #1793 的漏报行里）。跟读会话在 [#1793](https://github.com/qOeOp/trade/pull/1793) 登记的三行（20261027-08、-09、-10）与漏报行在第 1 步当作未结项读入，未交给审查者；本记录沿用这些编号。
- **审查分工**：三个工作流各派一个 fresh 只读子代理，只给证据路径、检出与问题，并要求它们不读宿主记忆、`docs/plans/doctor/`、#1793 与跟读材料。另做账本保真测试：另一个 fresh 子代理只读 transcript 与 schema，抽出会话图。
- **范围**：本记录只做诊断，不改产品；需要授权的项只列出。

| 项 | 值 |
|---|---|
| 会话 | **宿主**：local Codex Desktop（cli 0.164.0-alpha.11.1，gpt-6.1-sol，effort high，上下文窗口 475K）。<br>**transcript**：`rollout-2026-10-27T19-33-44-01a17cec-4fdb-74d0-8ba7-a108b0ee2fd4.jsonl`，读时 3,141 行，SHA-256 `d6433e5b…`。<br>**时间**：2026-10-27T10:33:57Z–2026-10-28T00:30:04Z，19 轮、19 条用户消息；会话 01:16Z 空闲，**审计覆盖止于 2026-10-28T00:30:04Z**（跟读证据止于 17:17Z，第 19 轮只有 transcript）。<br>**子会话**：4 个，都在第 5 轮以 `fork_turns: all` 派出（`01a17d13-2caf`、`-6abd`、`-b824`、`01a17d19-7a55`，11:16–11:26Z），按 `parent_thread_id` 搜 10-27、10-28 两个目录无其他。<br>**工作目录**：`~/.codex/worktrees/2b27/trade`，检出 `76a8f9b5f`，另有三处 IDE 前端未提交改动与未跟踪 `.codex/` |
| 审计会话 | Claude Code desktop，claude-opus-5-5，worktree `fix-same-identity-compare-021b98`（会话 id 宿主未显示）。四个 fresh 子代理（行为与决策、数据与成本、产品契约、会话图抽取），同一模型 |
| 检出 / 账本 | **会话检出**：`76a8f9b5f`（在 origin/main 上）。**当前产品**：`88f82aeba`；其间只改 `services/ide/web`、`paper/serve.py` 与其测试，会话读到的 skill、CLI、市场与引擎代码与当前相同。<br>**活动账本 `research`**：自 `odeo1h7mc6e429dohb6qrjt6vd89eusi` 至 `odeo1h7mc6e429dohb6qrjt6vd89eusi`，会话内 0 个提交（`dolt_log`、`dolt_branches` 只读核对）。<br>**市场**：活动 `market` main `gc305h705ocn5fm3lcjjerln283gek2t`，前后不变；线钉 `l1kfbo4b2of54ijpjnpn02ijdm175aqd`（经 #1787 可解析）；会话内未写 |
| 覆盖 | **行为与决策**：19 轮全部对话；第 1–4、16–17 轮逐调用，其余按退出码、记忆读取、CLI 使用 grep；第 2–3 轮的策略设计按因果、定量、费用、保护、可比性逐项看；子会话派出后的行为。<br>**数据与成本**：账本与市场写入；会话所需数据与产品命令的对照（quotes 覆盖、资金费完整性、合约规格、quote 导入路径）；逐轮与子会话 token、时长、压缩、重复读、轮询、脚本、外部下载与 /tmp 占用。<br>**产品契约**：readiness、执行环境、换线与首问规则逐条分类并做删除测试；`market coverage/bars/import-quotes`、`research state/status`、`replay explore` 的 help 与代码、skill、设计站对照；7 个 skill 对照 Anthropic 规范与字数；ruff、mypy、compileall，本地单测两次（Dolt 2.4.2 不在 PATH，273 项跳过）与 main CI 40609218231（596 项无跳过）；无 key 文献检索（OpenAlex、Crossref；Semantic Scholar 429 记未检索）。<br>**保真测试**：账本图与会话图均过 `ide.py check`，差异逐条分类。<br>**未查**：<br>- 第 6–14 轮爬取调用多数被截断的输出；/tmp 报告正文；BBO 误差统计与 L2 重建本身是否正确；供应商许可条款。<br>- 部分 quotes 覆盖下 quote 回放的实际行为（不得回放）；拟议设计的真实保证金距离（未读源码，策略未写成）。<br>- 两次压缩（12:28Z、14:08Z）对后续行为的影响；Codex 推理多为加密，无摘要。<br>- Dolt 集成测试未在本地跑（CI 已跑过）；`claude plugin eval` 未运行 |
| 用时构成 | **会话墙钟**：13 h 56 min；**主动时间** 11,638 s（3 h 14 min），其余 38,529 s 等用户。<br>**研究**：第 1–3 轮读账本、六份报告与五份比较、设计新根，573 s。<br>**就绪核对**：第 4 轮 450 s，其中约 6 min 用自写脚本读 quotes 覆盖（产品无读面）。<br>**补证**：第 5–19 轮 10,616 s，全部是产品外的来源调查（报价来源与价格、69 个月首 BBO、L2 重建、tick 规格、公告目录、Wayback、Common Crawl 重试）。<br>**修复**：0。**回放**：0 |
| 产品导致的无效试验 | 0（会话未登记、未回放） |
| 新发现按动作 | skill+authority 2（-01、-02）/ skill 1（-04）/ fix+authority 1（-03）/ fix 2（-05、-06）/ authority 2（-07、-08，只列出）/ none 2（子会话分叉、AGENTS.md 与 skill 的重复规则）；另更新既有项 20261027-08、-09、-10、-04、-05、-07 |
| 复发项 | 20261025-24（第四次：首问选项不是可登记的线，由 20261027-09 跟踪）；20261021-26（宿主记忆每轮读、每轮引用） |
| 用户先发现 | 1：20261027-09（用户 10-27 跟读时指出“goal 设定前动不动就停，要用户推一步走一步”） |
| skill 体积 | 各 skill 目录 `.md` 空白分词（与上份记录同口径）：<br>- research-start 3,389（+162：#1790 写明线钉的市场提交不在活动库时只给能跑的线）<br>- research-round 8,744、research-sources 1,963、product-doctor 3,369、nautilus-report-analysis 2,125、video-evidence 4,831、research-graph 315（均不变） |

## 经过

**第 1 轮（10:33:57–10:37:21Z）**：用户只调用 research-start。
- Agent 读账本：线 `research-line-20261025-ema-entryvar-rollingref-v7`（BTCUSDT `[2025-10-01, 2026-10-01)`，钉 `l1kfbo4…`），priority judgment 271 写“换线已到期”。六个 v7 候选的读数与五个比较对照报告全对。
- 它还对活动 `gc305h7…` 读了 2021 年以来的 BTC 覆盖（LAST/MARK 无缺口、资金费 6,297 个八小时时槽“齐全”），并说明冻结源码不能换窗重跑（`SOURCE_ALREADY_EXPOSED`）。
- 首问两个选项：**A** 保留方向，“先判断更长历史范围下可注册的新实质问题”；**B** 离开 EMA 候选另选方向。两者都不是可登记的线，都不带 Goal 目标。

**第 2–3 轮（10:52–11:02Z）**：用户选 A，并限定“不写账本、不建 Goal”。Agent 提出新根：固定 40,000 USDT 入场预算（初始 100,000 USDT）、去掉 0.4 BTC 上限，加一个按方差比缩量的变体，窗口 `[2021-01-01, 2026-10-01)`。第 3 轮它据 research-round 的执行环境规则断言“取消币数上限后名义敞口可能超过权益，需 quotes 执行”，方案“不能视为可运行”。

**第 4 轮（11:06–11:13Z）**：用户要只读核对 quotes 覆盖与清算适用性。没有产品命令给 quotes 覆盖，Agent 写 7 段脚本导入 `market.store` 直查：2021-01..2025-09 缺 57 个月 quotes，已有一年 467,914,411 行与导入凭证一致。它引 readiness 的“取得缺失证据或改变研究范围”提问：一年范围（仍附“需补独立报价与原生配对证据”）或保留 2021 全范围先制定补证方案。没有提 `market import-quotes` 能导入这 57 个月，也没有提有界名义敞口的设计可在 bars 上全窗口运行。

**第 5 轮（11:14–11:27Z）**：用户选保留 2021 全范围、只读制定补证方案。四个分叉子会话查来源：Binance aggTrades 1,735 组 ZIP 约 34.7 GB、Tardis 全史 36,000 美元/年、CryptoStruct 每合约日 €1。方案四层验收，其中“完整转换”层重复了导入命令自带的检查，另加了产品没有的商用许可门槛。

**第 6–19 轮（11:34Z–00:30Z）**：每轮由用户逐条指定下一步并重复“保留 2021 完整范围、只放 /tmp、不采购、不导入、不写账本、不建 Goal”。
- 第 6 轮：69 个月首日 BBO 共约 12.1 亿行，5 处采集断连；Agent 自己写明其余 2,030 天不能由月首样本外推。
- 第 7–8 轮：2021-07-01 交叉报价、五处断连的免费补证、以真实快照从 L2 重建 2026-05-01 一段 12.37 s 缺口内的 238 条 BBO 候选。
- 第 9–19 轮：为这 238 条候选证 0.1 tick：两份 Wayback `exchangeInfo`、官方公告目录 11,158 条、公告历史版本、Common Crawl 反复失败（第 13–19 轮只剩重试；第 16 轮建了 24 h 后的宿主定时任务，第 17 轮用户取消）。
- 每轮结尾都以“验收结论 v2…v7，规则链仍未闭合”收束，第 4 轮之后没有一轮把数据/范围或设计选择再交给用户。

## Findings

| id | 发现 | 证据（会话或规范；当前产品；消费者与决策） | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261028-01 | 执行环境规则以“源码能持有超过权益的名义敞口”为 quotes 触发条件，没有判据，也没有出口；它不说名义上限是 Agent 自己的设计变量，`strategy-authoring.md` 反而劝阻另设名义上限。Agent 自己去掉 0.4 BTC 上限，于是把方案判为非 quotes 不可、quotes 又缺 57 个月 | **会话**：11:01:19Z（L231）、11:02:29Z（L235）“取消币数上限后，长期持仓可能令名义敞口超过权益，按现有技能需使用 quotes 执行”。该上限原本只限入场数量，从不限持仓名义；200/207 在 bars 上登记（`default_leverage 1`），峰值名义 50,440 对权益 100,000。<br>**算术**：入场名义 N、权益 E、维持保证金率 m 的空头，要逆向涨 (E/N−m)/(1+m) 才强平：N=0.4E 时约 +249%，N=E 时约 +99%；会话实测推算报价与观测 BBO 的 p99 差约 1.2 bps，在 ≤1 倍敞口下强平输入的精度几乎不影响结果。<br>**当前产品**：`research-round/SKILL.md:56-61`（“Use `quotes` when the source can hold notional beyond account equity…”，“`bars` otherwise” 只挂在低敞口分支）；`AGENTS.md:32-33`（名义上限是 Agent 的设计变量）；`research-round/references/strategy-authoring.md:141-150`（“Do not add a separate notional cap to imitate it”）；评测 `research-round/execution-mode-for-margin-exposure` 只有 3 倍敞口且 quotes 就绪一例。<br>**消费者与决策**：执行环境选择 → 第 4 轮就绪结论 → 此后全部补证轮 | skill（执行环境按设计的强平距离对报价误差的量级判断，不按“能否超过权益”；写明名义上限是源码里的设计变量，可用它留在 bars；bars 的出口是报告强平未建模并给出最小保证金距离；与 strategy-authoring 的“不另设名义上限”对齐；加 ≤1 倍敞口、quotes 缺失的评测）+ authority（改变 quotes 触发条件即改 skill 检查，需用户定） | **实测**：第 4–19 轮 11,065 s（184 min）、输入 82.67M（未缓存 1.73M）、输出 338K，子会话另 20.17M；此后无一步推进到登记。**估计**：大部分在此之下游，与 -02 共享，未拆分 | open |
| 20261028-02 | readiness 的“推算报价与低活跃度”一节对清算适用性只要证据、不给够的标准：要独立观测 BBO“where available”、其覆盖与缺口、只换报价输入的原生配对回放，又禁止阈值与“安全”分类，唯一出口是“取得证据或改范围”；不说缺适用性证据是挡住回放还是只限制强平结论，也不要求在取证前说明它能改变哪项决定。Agent 因此在注定无法闭合的取证上连跑 14 轮，每轮以“仍未闭合”收束而不再交还选择 | **会话**：<br>- 11:13:37Z（L382）“即使只选上述一年，也仍需补独立报价与同策略、同配置的原生配对证据”——连已有 quotes 的一年也判为受阻。<br>- 第 6 轮 69 个月首样本按 `readiness.md:102`（不把抽样日外推到未抽样期）不能证明全窗口，Agent 写明“其余 2,030 天不能由月首样本外推”，仍以“未验收”收束。<br>- 第 7–19 轮只关乎 2026-05-01 一段 12.37 s 内 238 条参考行是否附“0.1 网格条件”；这些行不会进市场库（市场不存合成行，`readiness.md:20-21`），也不改变可运行范围、采购或登记。<br>- 第 4 轮后只有第 1、4 轮以问题结尾（逐轮机械核对）。<br>**当前产品**：`research-start/references/readiness.md:100-121`；`readiness.md:52-58`（“保留选择、取得证据”选项无代价与停止条件）；`nautilus-report-analysis/SKILL.md:57-62` 却是“报告未验证的强平结论”而非停下；评测 `research-start/inferred-quotes-scope-evidence` 的判据要求提出独立 BBO 与配对回放，没有一例检验“证据已够或无法取得时继续/交还选择”。产品内也没有命令能把替换报价输入的原生配对跑在研究账本之外（`replay explore` 只读市场、记暴露）。<br>**规范**：Sargent《Verification and validation of simulation models》（WSC 2010，pp.166-167，https://www.informs-sim.org/wsc10papers/016.pdf）：有效性相对于模型用途判断，所需精度应在开始前规定，检验到足够置信为止；Howard 1966 信息价值理论（doi:10.1109/tssc.1966.300074）；Wang & Strong 1996 情境数据质量（doi:10.1080/07421222.1996.11518099）。<br>**消费者与决策**：就绪结论与用户此后每轮“继续补证”的选择 | skill（取证前写出它能改变的决定与够用的结果；按设计的强平距离对已测报价误差判断适用性，远大于误差时报告限制并继续；参考源自身的缺口只在决策变量接近阈值的区间才查；某一步结果改变不了处置时一句说明并重新交还数据/范围或设计选择；不提供无法取得结果的“取得证据”选项；补评测）+ authority（把“缺适用性证据挡住回放”改为“只限制强平结论”是放宽 skill 检查，需用户定） | **实测**：第 5–19 轮 10,616 s（177 min）、主会话输入 79.63M、子会话 20.17M；第 6–19 轮 9,873 s；/tmp 新占约 12 GiB（月首原件 11 GiB）。研究零推进。**估计**：修后第 4 轮即可在 bars 上全窗口或在已有 quotes 的一年上登记首份报告 | open |
| 20261028-03 | quote 回放的 `QUOTES_MISSING` 只在窗口内零条 quotes 时拒绝；2021–2026 窗口只有最后 12 个月有 quotes 也能通过，而 quotes 环境关闭了 bar 撮合 | **会话**：11:13:37Z Agent 自己提醒“不能用没报 `QUOTES_MISSING` 证明完整 2021 窗口已覆盖”。<br>**当前产品**：`engine/run.py:855-859`（`if not row["counts"].get("quote")`）；`engine/README.md:80`；`engine/config.py:131`（quotes 下 `bar_execution False`）。缺 quotes 月份内实际行为未验证（不得回放）。<br>**消费者与决策**：选 quotes 环境的回放，其封存读数会把无 quote 输入的月份当作已建模 | fix（按月核对 quotes 覆盖 `[trade_start, end)`）+ authority（收紧拒绝；`engine/` 改动经新镜像） | 无会话代价（未回放）；潜在错误读数 | open |
| 20261028-04 | readiness 与 recommendation 只为 bar 月份写了导入路径，没写缺失 quote 月份经 `market import-quotes` 导入（更早月份照收、自带校验与连续性检查、每月一个公开市场提交、需用户同意、需新市场提交与新线）。第 4 轮的数据/范围提问因此漏了导入这一能跑的路线，第 5 轮方案把导入放在最后，把导入自带的检查另立一层验收，并加了产品没有的商用许可门槛 | **会话**：11:06:13Z（#20）读过 `import-quotes --help`；11:13:37Z 提问只给一年范围与补证方案；11:27:18Z 方案（`/tmp/trade-2b27-quotes-plan/…补证方案.md` 41、45 行）；11:17:44Z 许可说法；线钉 `l1kfbo4…` 没有 quote 表（#24 输出），会话未告诉用户。<br>**当前产品**：`market import-quotes --help`（“any earlier month is accepted, in any order”、checksum-verified、publishes the market）；`market/store.py:970-974`（`MONTH_EXISTS` 只在该合约该月已有 quotes 时拒）；`market/quotes.py:10-13,38-53`（序号缺口、跨日、时间倒序都拒）；`rg import-quotes .agents/` 无结果；`readiness.md:51-61`、`recommendation.md:25-26` 只讲 `market import`。<br>**消费者与决策**：第 4 轮的数据/范围提问与第 5 轮用户选择 | skill（readiness 写 quotes 月份的导入路线与其检查即转换验收、属用户决定的公开市场写入、需新市场提交与新线；许可不是就绪门槛；这一路线列入数据/范围提问） | **实测**：第 5 轮 742 s、输入 10.47M，子会话 20.17M（与 -02 重叠） | open |
| 20261028-05 | quote 导入对每个历史月份都用最新存的合约规格推算（BTCUSDT 现为 0.10），help 只说“contract terms”；2021 年 BTCUSDT 价格在 0.01 网格上（2021-01-01 首小时 60/60 分钟不在 0.1 网格），回补 2021 时交叉的陈旧侧会被推开 0.10 而非当时的 tick | **当前产品**：`market/store.py:979-983`（“The newest stored terms… like the bar import”）；`market/README.md:170-173` 声明回放用最新规格；`market import-quotes --help` 未说。对强平读数的影响未验证。<br>**消费者与决策**：回补早年 quotes 的人与读其强平结果的人 | fix（help 与 README 写明 quotes 推算对所有月份用最新存的规格） | 无会话代价 | open |
| 20261028-06 | 没有命令返回已存的合约规格（tick、数量步长、最小名义、观测时间）；会话两次直查 `instrument` 表 | **会话**：13:08:10Z（#156）、13:14:12Z（#169）直接 SQL，得 BTCUSDT 一行（2026-10-26T05:31:13Z 观测，tick 0.10），结论正确且未外推到历史。<br>**当前产品**：`market bars --help` 读 `instrument` 但不返回；`market/coverage.py:74` 只查有无规格行。<br>**消费者与决策**：核对回放所用规格的 Agent；第 9–19 轮的 tick 史调查由用户逐轮指定，不归因于此 | fix（`market coverage` 或 `market bars` 带出所用规格行） | 实测：2 次调用，<2 s | open |
| 20261028-07 | 清算适用性证据的保管规则互相冲突：AGENTS.md 让来源原件进公开账本，research-sources 要先留存所读文件再引用，readiness 要报告与比较只放 /tmp，而 Tardis 条款禁止公开再分发原始报价；本次约 12 GiB 证据只在 /tmp，重启即失，下次会话按 readiness“只在已证范围内复用”也无物可复用 | **当前产品**：`AGENTS.md`（“Where things go”）；`research-sources/SKILL.md` 第 8 步；`readiness.md:109-110`。**会话**：11:19:25Z Tardis 条款；第 7 轮复用的 12 份旧 BBO 来自更早会话的 /tmp 与 `docs/plans/monthly-quote-liquidation-validation.zh.md`。<br>**消费者与决策**：此后任何要复用就绪证据的会话 | authority（用户定这类证据存不存、存在哪；只列出，不提议新增字段） | 无直接代价；复用失败的代价未发生 | open |
| 20261028-08 | AGENTS.md 说工程试验只写隔离 Dolt 库、不写活动账本，research-round 却称 `replay explore` 是 engineering，而它默认写入并发布活动账本的 explore 试验（`replay reproduce` 同样） | **当前产品**：`AGENTS.md:35`；`research-round/SKILL.md:49`；`replay explore --help`。会话未走到 | authority（措辞或边界由用户统一；只列出，不解决） | 无会话代价 | open |
| — | 四个子会话以 `fork_turns: all` 分叉，继承父会话的框定（含 quotes 前提与记忆输出），用的是用户级 deep-research skill；它们是来源调查，不是独立审查，不能当作独立印证 | **会话**：11:16–11:26Z；Hubble 输出直接交给 Faraday。没有仓库规则要求此角色独立 | none | 子会话 20.17M 输入（宿主分叉费用） | — |
| — | AGENTS.md 与 skill 有若干重复的同义规则（目标不自改、已存历史替换需授权、不问仓位与预算、不把策略放进 Git、配对重放的指引链） | 产品契约审查列出；互不冲突，只是重复 | none（只记，不改） | — | — |

## 既有项回读

- **20261027-09**（首问选项不是可登记的线）：本次第 1 轮复现：换线到期、现有候选在新窗口都会被 `SOURCE_ALREADY_EXPOSED` 拒，选项 A/B 都是调查方向，没有一个能直接 `line select`，也不带 Goal 目标；此后 18 轮一直无线。`recommendation.md:17-24` 的“不给不能登记的选项”本身够用，缺的是这一情形下的出口：Agent 在第 2–3 轮被要求时设计出了完整新根，说明首问时就能给。并入 20261025-24 作为第四次复发，由本行跟踪。
- **20261027-10**（quotes 覆盖无读面）：两位审查者独立复现，当前 `market/coverage.py:68-95` 无 quote 字段，`market coverage` 输出无 “quote” 键或值，`store.quote_imports`（`market/store.py:906`）只有导入调用；`readiness.md:6` 仍让用 `market coverage` 读覆盖，`research-round/SKILL.md:68` 又禁止对市场包写脚本。第 4 轮 7 段自写脚本、1 次 Dolt `SHOW INDEX … AS OF` 语法错误（11:07:08Z，`ledger-server.log`）。部分覆盖的拒绝缺口另立 -03。
- **20261027-08**（资金费不报缺失结算与间隔）：复现，并在当前活动库量到 WIFUSDT（2024-02..2026-10）5,837 次结算，5,835 个间隔为 4 h、1 个为 8 h（2026-06-24T00:00→08:00Z）；按 8 h 时槽会读成齐全。BTCUSDT 6,297 次全为 8 h，本次结论无误。
- **20261027-01、-02**：已由 #1785（0e41b8b99）、#1790（4f0d9abc4）与 #1787（04ba9927b）修复，三者都在会话检出内。本次线钉 `l1kfbo4…` 可解析，`UNKNOWN_REF` 与不可解析门槛的路径都未走到：unobserved。
- **20261027-04、-05、-07**：仍在。设计站 `design-skill-research-start(.zh).mdx` 的 W.3.3.2 仍说开发窗口内或策略输入上的异常都要问用户，而 `readiness.md:45-50` 只问所列阻塞情形；未被设计页引用的评测：research-start 2、research-round 6、product-doctor 5、research-sources 1、research-graph 2、video-evidence 8。skill 结构另见 `nautilus-report-analysis/references/depth.md:7` 链到别的 skill 的 reference（两层）。CI 40609218231 仍有 `paper/serve.py:379→475→300→runs.py:256` 之后的 `BrokenPipeError` 回溯（`tests/paper/test_serve.py::StreamTests` 的流处理线程活过 `service.close()`），本地偶见 research_graph serve 测试的 `ConnectionResetError`。
- **20261027-03**（CI ffmpeg 步骤卡住）：最近一次 main 质量检查该步 15 s；未重查取消运行的原因。
- **20261021-26**（宿主记忆）：recurred：主会话 22 次 `rg` 宿主 `MEMORY.md`，19 轮回答全带记忆引用；读到的条目含以往会话的“用户偏好”、本会话自身的自动摘要（12:32Z 起可见）与一条已过时的说法（历史回补被 `MONTH_INVALID`/`IMPORT_SCOPE` 拒，与 `import-quotes --help` 相反，第 3 轮 #19）。对决定的影响未证明；用户自己的消息每轮重复全窗口约束。
- **20261025-18**（上下文与 token）：主会话 353 次请求、输入 84.75M（缓存 97.8%）、输出 355K（推理 160K）、最大上下文 449,593、两次压缩（12:28:34Z、14:08:55Z）；子会话 62 次请求、输入 20.17M。
- **20261023-07**（压缩后重读）：`readiness.md` 读 14 次、research-start `SKILL.md` 5 次、research-sources `SKILL.md` 3 次；有两次压缩，重读与压缩的对应未逐一核对。
- **20261025-15**（bars/quotes 怎么选）：路径走到，skill 有规则且被引用，原失败（没有指引）未复发：verified；规则本身的问题另立 -01。
- **20261026-05**（`bun.lock`）：干净检出检查执行，`git status` 只列三处 IDE 文件与 `.codex/`，`bun.lock` 未再出现：verified。
- **20261026-04**（已存月份缺源时的数据/范围提问）：本次缺的是未导入的 quote 月份，不是已存月份内的缺源，路径不同：unobserved（第 4 轮确实先列了已有 quotes 的一年，但该范围本身被附上补证条件，见 -02）。
- 其余已修项（20261026-01、-06、-08，20261020-21，20261025-23、-29、-36、-37、-12、-22、-14、-16、-06、-01、-11、-08、-34、-1686，20261023-02、-06，20261020-38，20261021-13..-22）：会话未走到，unobserved。20261025-30：会话没读 README，但产品状态仍在，`README.md:93` 仍称活动库自 2025-01 起。

## 保真测试

- **两张图**：账本图 `research graph --at odeo1h7… --since odeo1h7…`，75 个版本、37 个事件；会话图 6 个 v7 版本、7 个试验（含 judgment 270 点名的复现 trial 201）、4 个事件。两者都过 `ide.py check`。
- **比较**：`ide.py compare --until 2026-10-28T00:30:04`。只在账本的 69 个 v6 版本、`ema-entryvar-rollingref@1` 的父版本、6 组预测、6 组源码审阅与 5 个状态：会话都没有读出或为保持引用有效置空，全部是 extraction miss。读数、资格、对照与推荐在两边一致。没有 ledger gap。
- **只在会话的事实**：
  - 用户两次方向选择（10:52Z 选 A 扩到 2021、11:14Z 保留全范围补证）：都不是线，research-start 只在选定线时 `line select`，是 not a record。
  - 第 2–3 轮的新根设计与预测：未发布的草稿，not a record。
  - 2021 年以来的覆盖读数：由市场库可推出（derivable），quotes 部分正是 20261027-10 要补的读面。
  - 第 5–19 轮的来源与 BBO 证据：AGENTS.md 归为 /tmp 工作副本；它能否、该不该持久保存是 -07 的授权问题，不在本次提议新增字段。

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| `SOURCE_ALREADY_EXPOSED` | 在更多开发数据上重测已选规则 | 无 | 第 1 轮正确拦住“200/207 换窗重跑” | 保留 |
| 换线到期（priority judgment） | 线内无尽分叉 | 无 | 第 1 轮触发，有用 | 保留 |
| `RUNTIME_UNSUPPORTED` | 给出跑不了的线 | 无 | 69 个 v6 候选被正确排除 | 保留 |
| `MARKET_COMMIT_UNRESOLVED` 门槛（#1790） | 不可解析的线钉 | 登记拒绝（更晚） | 未触发，唯一保护 | 保留 |
| `QUOTES_MISSING` | quotes 环境无报价输入 | 无 | 部分覆盖时不触发（-03） | 收紧，需授权 |
| `MONTH_EXISTS`（import-quotes） | 市场只追加 | 无 | 未走到 | 保留 |
| 覆盖处置 1–3 部分 | 把缺口读成策略失败 | 无 | 第 1、2、4 轮正确 | 保留 |
| 覆盖处置第 4 部分“保留选择、取得证据”选项 | 用户想保留范围时的出路 | 无 | 被连选 15 轮，无代价与停止条件 | 收窄（-02） |
| readiness“推算报价与低活跃度” | 用推算报价夸大强平结论 | 引擎 limitations 文字（`engine/README.md:80-84`）、nautilus 的“报告未验证强平结论” | 驱动了 14 轮无决策价值的取证 | 改写为按决策定够用标准（-02，需授权） |
| research-round 执行环境规则 | 高敞口下不建模强平 | 无 | 以代理条件触发，无出口（-01） | 改写（需授权） |
| strategy-authoring“不另设名义上限” | 用名义上限冒充保证金 | Nautilus 保证金 | 与 AGENTS.md 的设计变量规则相抵（-01） | 对齐 |
| nautilus-report-analysis 的 quote 就绪指针（`SKILL.md:57-62`） | 读 quote 回放前读就绪规则 | readiness 本身 | 未走到；与 readiness 重复，且是两层引用 | 并入或删去，与 -05 一起 |
| nautilus depth 检查 | 成交量超过盘口 | 无 | 未走到 | 保留 |
| 干净检出检查（readiness） | 封存读数的修订身份 | 验证登记的 `STALE_CHECKOUT` | 第 1 轮正确报出脏检出 | 保留 |
| 首问“列线并等待” | 未选就写账本 | 无 | 阻止了未选前的写入 | 保留；选项内容见 -09 |
| 评测 `inferred-quotes-scope-evidence` | 推算报价的适用性夸大 | 无 | 只奖励提出取证 | 补“证据够或无法取得”的对照例（-02，单独 PR） |

## Convergence

- **代价**：本次研究零推进，主动 3 h 14 min、主会话 84.75M 输入加子会话 20.17M，其中第 4–19 轮 82.67M 落在 -01/-02 的下游（实测，两项共享，未拆分）。上份记录（01a17bd9）是 927 s、5.10M，同为零推进；本次主动时间约为其 13 倍、输入 token 约 17 倍，原因是这次用户愿意逐轮推进取证，而产品与 skill 没有一处让它停下。
- **无效试验**：0（连续三次会话都没有回放）。
- **复发**：20261025-24 第四次（-09）；20261021-26 再次。
- **用户先发现**：1（-09）。
- **已修项**：-01、-02、-15、20261026-05 的修复在本次路径上成立或未走到；没有证据说明消费者因此做出了更有依据的决定——会话仍未登记。
- **skill 体积**：research-start +162 词，其余不变。本记录的补救都落在既有段落的改写（-01、-02、-04），不是加新规则；是否净增要等实施时量。
