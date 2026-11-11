# 2026-11-11 Codex 整仓流程评审的提案逐条审定

用户在 Codex 线程 `01a1c688` 里先后要了整仓流程图、17 条线索复核、节点与接线必要性审查、51 组交互图，以及 43 条产品设计边的重构前后对照，外加一份功能审计。用户希望把其中有用的建议并入这次破坏性重构。本记录在当前代码上逐条证明或证伪这些提案，给出采纳、改写或拒绝，并指定落点。

本记录不实施任何改动。凡涉及拒绝、审计、存储字段或 Live 边界的条目，都要先经用户授权。

| 项 | 值 |
|---|---|
| 被审会话 | Codex（`gpt-6.1-sol`，effort high）。主线程 `rollout-2026-11-11T02-36-59-01a1c688-…jsonl`，从 2026-11-10 17:37Z 到 11-11 00:18Z，共五次用户提问。另有 13 个子代理（`01a1c689-1c06`、`-31c7`、`-4825`、`01a1c68c-0d21`、`01a1c7cc-51fc`、`-7021`、`-89f1`、`01a1c7db-6678`、`-8bfe`、`-b25b`、`01a1c7ed-d58a`、`-f16a`、`01a1c7ee-0f74`） |
| 被审产物 | 四个目录：`/tmp/trade-flow-20261111.xmIfGY`（首轮图、四角色底稿、17 条线索）；`/tmp/trade-flow-r2.1T4Smp`（`第二轮评审.md`、`简化设计.md`）；`/tmp/trade-flow-r3-2cada0e97`（`architecture-review.md`、逐边表）；`/tmp/trade-refactor-review-e33e425a`（`产品重构评审.md`、`功能审计.md`、`boundary-review.md`、`ux-review.md`、`services-review.md`） |
| 审查会话 | Claude Code（Opus 5.5），worktree `adoring-pare-d0988c`，分支 `docs/codex-flow-review`。由父会话 `local_4fecb3e2` 派出，做重点审查（product-doctor 第 3–5 步），不是全量审计 |
| 检出与分支 | 当前产品以 `origin/main` e33e425a7 为准；提交前复核到 48a630a3c（其间合入 #2603、#2606、#2607、#2608，本记录引用的文件中只有 `engine/README.md` 行号后移 3 行，已按新行号改正）。被审线程的锚点在 2cada0e97 和 e33e425a7 上。草稿分支：#2599 `refactor/ledger-schema-new` d720e98ec、#2587 `refactor/paper-own-database` c58b76f43、#2595 `refactor/r1-contract-v8` 40f020fbc。提交前复核到 #2599 2884057c8、#2595 acc69d674：落在这两个分支上的发现（CF-03、CF-04、CF-07–CF-12、CF-20、CF-21）在新的分支头上仍然成立；#2607（`docs/replay-image` 00c936e07）已于审查期间合入 main。没有读写账本 |
| 覆盖 | 读了主线程的时间线和 13 个子代理的最终答复。产物里的每条提案都已列入下面三张表。四个只读子代理按领域核实代码（Paper、Live/引擎、研究/回放、CI/IDE/部署），高优先级的 P2、P3、L1、R2、R8 由我在 main 上亲自复读。用户中途要求加做一遍全仓瘦身与治理补扫，结果见第六节。**缺口**：没有逐条读子代理的完整调用；首轮部署子代理提到的"两处文档与配置表述差异"没有落进任何产物，本次没有追查；补扫只做了机械检查，没有逐个文件通读设计层面的重复 |
| 成本 | 被审线程总输入约 3,338 万 token（其中缓存约 3,268 万），输出约 13.2 万 token，墙钟约 6.7 小时（含等待）。线程里的评估都是静态读源码和隔离探针，**没有生产发生率，也没有实测损失**，所以下表的"后果"都是可触发的后果，不是已观测到的成本。本次审查的四个核实子代理共用约 61 万 token |
| 净变化（全部采纳时） | 存储字段 0、拒绝码 0、skill 词数 0。删去：Live 的 3 份杠杆范围副本、1 次同快照全平检查；Paper 的 1 次重复 gzip 解码、1 次重复权益计算、1 段先压缩后丢弃的工作、1 次多余的资金费读取；报告的 1 次重复登记读取。改写（不增加分支）：Paper 结束分流从"按两个原因字符串判封存"改为"只有暂停才恢复"；回放重试从"只认 interrupted/host_failure"改为"凡无 run 都可重试"（需授权）。新增：探索缓存的原子换入（几行）、各 Overview 任务自带限流宿主（一个参数） |

## 一、采纳或改写（按后果排序）

"后果"只描述可以触发的后果；被审线程和本次审查都没有测到实际发生的次数。"授权"一栏按 AGENTS.md 判断：改拒绝或审计、加存储字段、动 Live 边界都要授权。

### 1. 状态卡死或证据丢失

| id | 来源 | 主张 | 当前代码的证明 | 结论 | 落点 | 授权 | 机制净变化 |
|---|---|---|---|---|---|---|---|
| CF-01 | 第二轮 NR02/X-01；第四轮"Paper 终态、暂停与封存" | daemon 只认 STOP/DURATION 两个停止原因，TERMS_CHANGED 会被送去恢复 | **成立，且比线程说的更重。** `paper/serve.py:457` 只在有 `STOP` 文件或 `stop_reason ∈ {STOP_FILE, DURATION}` 时封存，其余一律调用 `resume`。runner 在 `engine/paper.py:845` 的 `finally` 里标记 checkpoint 为 dirty，只有 SIGTERM/SIGINT 暂停才会切出干净的 checkpoint（`:853`）。`resume` 因此被 `engine/paper_checkpoint.py:84` 拒绝（"automatic recovery is refused"）。每 15 秒重试一次，永远不封存，失败只打印一次。TERMS_CHANGED、PAPER_EXEC_CLIENT_NOT_SANDBOX 和各种越限停止都走这条路。另外 `on_start`（`engine/paper.py:441-449`）在 `_check_terms` 拒绝后仍继续恢复 recorder、开订阅 | 改写为**重述机制**：只有暂停（SIGTERM/SIGINT，或缺少摘要的中断）才恢复，其余一律封存，删掉原因字符串名单。`on_start` 在已请求停止后直接返回 | 一个新 PR 进 main（`paper/serve.py`）；`engine/paper.py` 的那一半随新执行镜像发布（#2607 拆分后属于执行镜像） | 不需要：拒绝码不变，封存记录沿用现有的 `REFUSED:`/`STOPPED:` 原因 | 删去一份原因名单，换成一条"暂停才恢复"的规则 |
| CF-02 | 第二轮 NR01；第四轮"Paper 声明后到启动前的失败" | 受理先提交，建目录和写输入在捕获 START_FAILED 的 `try` 外面 | **成立，且更重。** `paper/runs.py:315-317` 先写声明；`:321-326` 的 mkdir、写 `strategy.py`/`universe.json`/`terms.json` 和 `bind` 都在 `:327` 的 `try` 外面。600 秒后 daemon 把它当孤儿（`serve.py:450`），找不到 STOP 也找不到摘要，于是走 `resume`（见 CF-01），恢复因缺 `universe.json` 等文件失败，每 15 秒重试一次，永不封存 | 采纳：把 `:321-326` 移进 `try`，失败就按现有 START_FAILED 封存 | 新 PR 进 main（`paper/runs.py`）。#2587 要变基 | 不需要 | 不新增机制，只是把已有的失败出口放到正确位置 |
| CF-03 | 第二轮 DF2；第四轮"Live 准备与本地恢复" | Live 部分准备的恢复漏传必填的 `market_root` | **成立。** `live/control.py:246-250` 的 `resolve()` 调 `runs.prepare_locked` 时没传 `market_root`，而它是必填的仅关键字参数（`live/runs.py:275`），所以会抛 TypeError，外层把它当成 500 `LIVE_RECORD_UNAVAILABLE`。请求停在 `outcome_unknown`，`requests.require_clear`（`live/requests.py:246-260`）随后挡住所有会影响账户的操作，直到有人手工处理。不会下单。缺陷来自 3d37c5a8c（R1 2d）：它给正常路径 `_prepare`（`:194`）加了参数，漏了恢复路径，也没有测试覆盖 `resolve()` 的 prepare 分支。#2595 和 #2599 都原样保留了这个缺陷 | 采纳最小修复：传 `market_root=config.market_root`，补一个 `resolve` 的回归测试。**不采纳**线程提出的"把市场提交冻进请求输入"：manifest 已写入时，恢复是逐字节比对，市场 head 前移会以 `LIVE_RUN_CONFLICT` 安全拒绝；manifest 未写入时，开仓前还有逐单的 `TERMS_CHANGED` 条款比对兜底。所以为它新增一个存储字段不值得 | 新 PR 进 main（`live/control.py`）。#2595 改的是同文件的另一行，变基只是小冲突 | 不需要 | 0 |
| CF-04 | 第二轮 NF2；第四轮"回放 capture 后、经济封存前" | capture 已提交但经济封存失败时，没有续作入口 | **成立，且更重。** `replay/entry.py:319` 在 `finally` 里提交 capture，`:545-549` 再封存。封存失败时工作目录会保留，但执行前的输入指纹 `raw_before`（`:513`）只在内存里，导出目录也在 `run()` 的 `finally` 里删掉了。`registration/register.py:345-357` 的 `retryable` 只放行 outcome 为 interrupted/host_failure 的 capture，所以一次已完成、但封存失败的 capture 会永久占掉一个网格点，既不能重试，也没有命令能补封存：`ingest_run` 的唯一产品调用者就是 `replay/entry.py:548`。#2599 原样保留（`entry.py:522,557-561`、`register.py:335`） | 改写，按**重述机制**的顺序：`retryable` 改为"有 capture 但没有 run 就可重试"，删掉对 outcome 种类的特判。**不采纳**新加 `replay ingest` 命令：执行时的输入指纹已经丢了，补封存无法证明输入没变，而且等于多一条写入路径。**不采纳**把输入指纹存进启动回执：那是新存储字段，而重试本身已经够用 | #2599（`registration/register.py` 正在重写） | **需要**：放宽 `RETRY_NOT_ALLOWED`，即"已完成但没有 run"的尝试从拒绝重试改为允许重试 | 去掉一个特例；没有新命令，也没有新字段 |
| CF-05 | 第二轮 X-03；第四轮"Paper 列表采用同一个账本快照" | 列表读两次，中间有删除就会 KeyError | **成立，且更重。** `paper/runs.py:409-410` 读一次，`paper/serve.py:487-499` 再读一次后按 ID 取值。`seal_found`（`serve.py:427-431`）只捕获 `Refusal`，所以一旦出现 KeyError，`seal_ended` 线程会在 daemon 的整个生命周期里停掉，之后不再自动封存。触发窗口只有毫秒级 | 采纳：`runs.listing` 一次返回带封存信息的行，删掉第二次读取 | 新 PR 进 main（与 CF-06 同属"Paper 读模型"这一个根因） | 不需要 | 删去 1 次重复读取 |
| CF-06 | 第二轮 X-02；第四轮"Paper 活动流的封存交接" | 活动 SSE 一看到 sealed 就发 end，可能漏掉封存尾部 | **成立。** `paper/serve.py:673-706`：运行目录可能已被 `_collect` 清掉，`read_lines` 读不到东西就发 `end`，最终读数和失败记录不会补发；页面收到 `end` 就关闭（`ide/web/src/state/paperStream.ts:113-115`）。#2587/#2599 都原样保留 | 采纳：看到 `sealed` 后，先从封存件里按偏移补发尾部和读数，再发 `end` | 与 CF-05 同一个 PR | 不需要 | 0；补尾和直接订阅封存流共用同一条读取路径 |

### 2. 给研究决定的读数有误

研究会在新账本上从零开始，所以下面这些读侧缺陷最好在第一批研究之前修好。这几处代码 #2599 都在重写，而且都原样保留了缺陷，因此落点都是 #2599（由 L5 负责）。

| id | 来源 | 主张 | 当前代码的证明 | 结论 | 落点 | 授权 | 机制净变化 |
|---|---|---|---|---|---|---|---|
| CF-07 | 第二轮 R2-R01；第四轮"研究图把实际 trial 对回登记" | 研究图用首次登记配最新成功的试验，重试后报 RUN_NOT_IN_GRID，比较就丢了 | **成立。** `report/graph.py:377-378` 取首个有 attempt 的试验的登记，`:423-424` 却配 `research[-1]`；`_comparison`（`:94-99`）吞掉拒绝，图上的比较就不见了。#2599 原样保留（`graph.py:368-372,417-418`） | 采纳：直接用最新运行自己的登记（#2599 上是 `trial.research_registration_id`） | #2599 | 不需要 | 删去"挑两份记录再猜对应关系"的代码 |
| CF-08 | T03；第四轮"历史推荐与当前资格独立显示" | 推荐后来失格，界面仍显示为当前推荐 | **成立。** `report/graph.py:423-426` 和 `ide/research_graph/layout.py:53` 都先判"recommended"，再判"masked"；摘要取的是最新推荐（`layout.py:182,192`）。#2599 原样保留。某个推荐写入后能否真的被遮蔽（例如之后补了一条失败的源码审查），没有在账本上实际复现过 | 采纳：先判 masked，或用"曾推荐、现已失格"这一个状态。只改显示，用现有的 judgment 和 trial，不新增字段 | #2599（`report/graph.py`）；IDE 部分（`layout.py`、`RecommendationWidget.tsx`）放第 4 阶段 | 不需要 | 0 |
| CF-09 | T02；第四轮"暴露与复现共用身份读取" | 暴露计数的同镜像捷径不比有效配置，杠杆不同的探索会被当成复现去重 | **成立。** `report/status.py:189-198` 第一分支的身份只有源码、镜像、品种、窗口和输入键（`_input_key`），不含配置也不含结果。探索的 `--leverage`、`--starting-balance` 直接传给 runner（`registration/seams.py:33` 没有保留它们），所以只改杠杆的探索会被算成复现、不计入试验数。登记侧的 `SOURCE_ALREADY_EXPOSED`（`register.py:448`）和原件认证（`reproduction.py:146`）都比较配置和指纹。#2599 的 `status.py:172-180` 用了 `export_sha256`，但没用新 `trial` 行里已有的 `comparable_config_sha256` | 采纳：把可比配置哈希加进身份元组。这会让计数更保守（多计，不会少计）；新账本从零开始，没有历史数字会变 | #2599 | 不改拒绝和字段，按 AGENTS.md 不属于必须授权的事项。但它改变了试验计数，也就是多重检验的分母，PR 里要写明 | 0 |
| CF-10 | T04 + R2-R02 + R2-R03；第四轮"换法所需比较历史和读取失败" | 有界比较读会先被规模候选截断；环境故障被当成"不可比"；还算了没人用的归因 | **部分成立。** 环境故障这一半成立：`report/status.py:~763-779` 遇到任何 `Refusal` 都记为 `crossing=None → "uncompared"`，读服务失败也会凑满 `REVIEW_EVERY` 次而截断。白算这一半也成立：`compare()` 默认 `bootstrap=True`，会算交互、归因和区块敏感度（`report/comparison.py:405-430`），而 `intervals_cross_zero`（`:435`）只读三个区间。"遇到规模候选就停"是文档写明的设计，docstring 说 Agent 会把它打折扣，**不算缺陷**。#2599 原样保留 | 改写：环境类拒绝照 `graph._environment_failure` 的做法重新抛出，并改走一个只算区间的轻量路径。停止规则不动 | #2599 | 不需要；停止规则不改，改的话属于复审政策，另议 | 删去一段没人消费的计算 |
| CF-11 | 第四轮"回放报告一次固定一个主快照" | 省略 `--at` 时，`replay report` 一次响应里分四次解析账本 head | **成立。** `cli/main.py:754,763,766,769` 分别解析 head。`report/runs.py:113,159,226` 里有几处是有意按当前 head 读，用来做"当时资格对照现在资格"的比较。#2599 原样保留（`cli/main.py:~741-750`） | 采纳：主报告只解析一次提交，再往下传；有意读当前 head 的那几处单独标明 | #2599 | 不需要 | 删去 3 次重复解析 |
| CF-12 | T05；第二轮研究底稿 | 样本外的技术重试被追加进原 Holm 族；没有 p 的旧行仍占族；重试按自己的时间查暴露 | **成立。** `registration/validation.py:199-205` 允许重试，`report/comparison.py:~638-641` 把同窗口、同全集的全部登记（含重试）都算作族成员，所以原登记和它的重试是两个成员，原登记若没有 p 还会以 FAMILY_PROVISIONAL 留在族里。`window_read_before_binding`（`:~633-637`）从重试自己的 `created_at` 开始查，原登记到重试之间那一段查不到。#2599 原样保留（`comparison.py:670-679`）。`retry_of` 列已经存在 | 采纳：每条原登记只算一个成员（`retry_of IS NULL`），p 取这条链上最新的成员，窗口检查从原登记的 `created_at` 起算 | #2599 | **需要**：改变样本外验证的多重检验族口径，也就是验证结论的判定规则。改后会少算一个"成员"，Holm 校正会变宽松；窗口检查的起点提前，会多拒绝（`window_read_before_binding`） | 0 |

### 3. Paper 的读数与对账

| id | 来源 | 主张 | 当前代码的证明 | 结论 | 落点 | 授权 | 机制净变化 |
|---|---|---|---|---|---|---|---|
| CF-13 | 第二轮 DF3；第四轮"Paper 对账重建执行输入" | 对账手拼回放参数，漏传原杠杆和原市场提交 | **成立。** `paper/reconcile.py:303-304` 的 argv 里没有 `--leverage`，于是按默认的 3 倍回放；市场提交取的是 `at` 或最新（`:300`），不是 `row.market_commit`。前一半（3d37c5a8c 之前声明的旧运行会报 LEVERAGE_MISMATCH）只影响旧 Paper 库，新 Paper 库从零开始，**不采纳** | 采纳后一半：传运行自己的杠杆和 `row.market_commit` | 新 PR 进 main（`paper/reconcile.py`，两行），与 CF-14、CF-15 合为一个"对账输入"PR。也写进 R3.2 的验收清单 | 不需要 | 0 |
| CF-14 | 第二轮 NR05 | 缺事件表时当作空表 | **成立。** `paper/reconcile.py:309-310` 把缺失的 `order_events.jsonl.gz` 当成 `[]`；`Reconcile.tsx:118` 显示 invalid，但计数照画 | 采纳：文件缺失时标"成交不可用"，不显示计数 | 同 CF-13 | 不需要；只改临时的 reconcile.json | 0 |
| CF-15 | 第二轮 NR14 | 差异样本截到 50 条，IDE 把样本长度当成数量 | **成立。** `paper/reconcile.py:35,253-257` 截取样本；`Reconcile.tsx:100` 把样本长度加起来当数量，而 `summary.missing_bars`/`differing_bars`（`:248-249`）里本来就有完整计数 | 采纳：按品种给出计数，界面直接用 | 同 CF-13（reconcile.json 的 `FORMAT` 要加一） | 不需要 | 0 |
| CF-16 | 第二轮 NR06、NR07 | 贪心配对造成孤儿，单边差异被标成疑似偷看未来；实际预热摘要没人用 | **成立。** `paper/reconcile.py:96-113` 按 Paper 顺序贪心取最近的成交，手算例子：两组本可配对，结果只配成一组，多出两个孤儿；`classify`（`:198-202`）把第一个落单的回放成交标成疑似偷看。`engine/paper.py:271-276,741-743` 记了预热摘要，`reconcile.py` 里没有任何地方读它 | 改写：并入 R3.2，不单独修。R3.2 已经规定"先比输入，再比决策"，也规定"排除已知原因后才标疑似偷看"；cross-line-fusion 第 7 点也已规定按入场订单配对 | R3.2（执行路径重规划第 4 步） | 已在 R3.2 的授权项里："reconcile 的归因顺序和疑似偷看未来的判定"，不新增授权 | 0 |
| CF-17 | 第二轮 NR04 | 仓位非零、缺 MARK 的资金费行仍记为金额 0、结算 1 次 | **成立。** `ledger/paper.py:166-173` 没有 MARK 就记 0，`:181` 照样计数，`:281` 报告 `funding_settlements`。没有收到 MARK 时，引擎会写 `mark: None`（`engine/paper.py:501-503`） | 改写：并入 R4.1（封存时改用交易所公布的结算费率）。实施时把"缺价无法估算"和"真实为零"分开计数 | R4.1 | 已在 R4.1 的授权项里："资金费封存读数的改变"。这里改的是 Paper 库的 seal.json，不是研究账本 | 0 |
| CF-18 | 第四轮"Paper 恢复的条款身份"（NR03） | checkpoint 钉住了市场提交，恢复时却重读 `terms.json`，没有核对它是否仍对应那次提交 | **成立。** `paper/recovery.py:55-60` 的身份包含行字段和 universe 的 sha256，不含 `terms.json`；只核对 `strategy.py` 的哈希（`:110`）；`engine/paper.py:817` 每次启动都重读 `args.terms`。这个文件在 `runs.py:325` 写一次之后，只有宿主手工改动才会变 | 改写：R1 规定"三处的条款都用市场目录导出的那份"。恢复时按 `row.market_commit` 重新导出条款并比较，不一致就拒绝恢复。不新增存储字段 | #2587（恢复代码），排在 #2595 之后 | **需要**：收紧恢复的拒绝条件，"条款与原市场提交不一致"时从照常恢复改为拒绝恢复。Paper 库在切换时会重建，不影响已有运行 | 0；不新增字段 |
| CF-19 | 第二轮 AF1；第四轮"Paper 启动意图和受理回执" | 浏览器查不到回执就重发启动，daemon 按"现在"的默认值解析；HTTP 出错时丢掉了写入状态 | **成立。** `ide/web/src/state/paper.ts:104` 对每个未确认的启动都重新 POST；待办意图（`lib/pendingStarts.ts:36`，存在 sessionStorage 里）只有候选和范围，没有时间。daemon 按此刻解析合约、研究提交、成员资格（`runs.py:304`）和杠杆。`Failure.refused`（`serve.py:68-73`）只保留 code 和 message，PAPER_START_FAILED 的 `write_status`/`missing` 丢了。op_id 判了三次（`serve.py:259,294-301`；`runs.py:281-290`；`:316-320`），daemon 那次判定不看杠杆 | 改写：刷新后只查 `/starts`，查不到受理就显示"未受理"，由用户再点一次，不再自动重发。HTTP 错误体带上 `write_status`/`missing`。去掉 daemon 那次 op_id 判定，交给 `runs` 判 | 与 doctor 20261107-132（Paper 普通点击直接启动无确认）合并为一个 PR 进 main（`paper/serve.py` 加 IDE） | 不需要 | 删去 1 次 op_id 判定和 1 条自动重发路径 |

### 4. 机械清理和小修

| id | 来源 | 主张 | 当前代码的证明 | 结论 | 落点 | 授权 |
|---|---|---|---|---|---|---|
| CF-20 | 第四轮"Live 首启同快照全平检查" | 同一快照查了两次全平 | **成立。** `engine/live.py:146-147` 在 `require_admission` 之后又调 `require_flat`，而前者默认（`flat=True`）已经调过它（`engine/live_venue.py:265-266`）。#2595 原样保留 | 采纳：删掉 `:147` | #2595（引擎改动随 v8 镜像发布） | 不需要；拒绝不变 |
| CF-21 | 第二轮 R2-L02 | Binance 杠杆范围校验写了四份 | **成立。** `engine/config.py:432`（`leverage_of`）、`live/configuration.py:18,62`、`live/runs.py:293`、`engine/live.py:73`；Paper 已经复用 `leverage_of`。两个草稿都保留了这四份 | 采纳：三处 Live 改为调用 `engine.config.leverage_of`，各层保留自己的错误包装 | #2595（R1 账户契约 A9 一带） | 不需要；拒绝的范围和阶段都不变 |
| CF-22 | 第二轮 NF1 | Live 入场说明过时 | **部分成立。** main 已改写 `engine/README.md:553-555`（大概是 #2588）。仍然过时的有（行号按 48a630a3c）：`:566` 说"原生订单历史阻止第二次入场"，`:569` 写"在空仓账户上"，`:575` 的"声明里的源码审查标记"已被 #2605 删除，`engine/live_venue.py:211-213` 的注释还写着"每次入场都在空仓账户上复查"。`:623` 的版本号 #2595 已改 | 采纳：改文字 | #2595（它本来就在改 `engine/README.md`） | 不需要 |
| CF-23 | 第四轮功能审计"首装/部署" | About 页说实单只走操作员的 `live` 命令 | **成立。** `ide/web/src/components/About.tsx:88-89` 说实单"只通过操作员的 `live` 命令，从不经过本页"，而实际上 Live 页的启动向导（`LiveLaunchWizard.tsx:88-113`）在用户确认后启动实单。重构计划 D5/P2 删掉操作员 Live 命令行后，这句话就完全错了 | 采纳：改成"用户确认后从 Live 页启动实单" | 第 4 阶段（IDE） | 不需要 |
| CF-24 | 第二轮 NR08、NR09、NR10、NR11、NR13 | Paper 封存的重复工作：先压缩后丢弃、重复 gzip 解码、两次权益计算、读日志时整包重哈希（含 RDB）、对账多读资金费 | **都成立。** 分别在 `ledger/paper.py:323-331`、`reconcile.py:262-268` 对 `serve.py:511-518`、`serve.py:116-117` 对 `ledger/paper.py:249`、`serve.py:507-509` 经 `evidence.py:172-185`、`reconcile.py:275` 经 `market/read.py:124`。#2587 把解码改成走 `paper_files`（`ledger/paper.py:127`），不再重哈希，但仍然 `SELECT content` 每个文件，RDB 也在内 | 采纳：按路径只取 `events/%`、`runtime_failures.jsonl` 和 `*.log`；共用一个解码函数；`readings` 直接返回路径；先判断 `recovery/` 再编码；对账改用只读 bars 的函数。输出字节不变 | #2587（这些函数它正在改名重写） | 不需要 |
| CF-25 | 第二轮 X-05 | Paper 历史链每个运行开一个 EventSource，没有清理 | **成立。** `ide/web/src/state/paperChain.ts:17-32`，没有 `onerror`；`:37` 的 effect 没有 cleanup；`stretches.ts:19-21` 先加载全部运行，再按品种过滤 | 采纳：先按品种过滤，effect 加 cleanup，出错就关闭 | 第 4 阶段（IDE） | 不需要 |
| CF-26 | 第二轮 R2-R04 | compare 和 gather 在同一连接上重复读同一登记 | **成立。** `report/comparison.py:405` 和 `:372`；#2599 在 `:427`、`:389` 保留 | 采纳：把已读的计划传给 `gather` | #2599 | 不需要 |
| CF-27 | 第二轮 NR12 | 缓存键相同的两个探索进程会原地删除、重建同一目录 | **成立，仅限 explore。** `market/export.py:447-449` 先 `rmtree` 再 `mkdir`，`:599-613` 用 `complete()` 判断命中，没有锁；research 和 precheck 用 `fresh=True` 的临时目录，探索用共享缓存（`replay/entry.py:387`）。`EXPORT_CHANGED_BEFORE_EXECUTION`/`INPUTS_CHANGED` 能否兜住这种覆盖，**未核实** | 采纳：在临时兄弟目录里建好，再 `os.rename` 换入 | 新 PR 进 main（`market/export.py`，几个分支都不碰这个文件） | 不需要 |
| CF-28 | 第二轮 QF1、X-06；第四轮"制品输入与触发、新鲜度一致" | Pages 新鲜度检查不看字体；IDE 镜像的路径过滤漏了协议夹具 | **成立。** `.github/scripts/docs-pages-current.sh:8-10` 没有 `ide/web/fonts`，而 `docs-pages.yml:10,45` 列了它（#2297 加的），站点构建也用它（`docs-site/scripts/prepare-content.mjs:67`）。先提交文档 A、再只改字体 B 时，两次运行都报 current，部署任务又没有共用的并发组，A 的部署后完成就会把站点退回旧字体。`deploy/Dockerfile:34` COPY 了 `tests/live/protocol-*.json`，`ide-image.yml:12-32,59-79` 没列它；影响接近零，因为 ide-web 会跑同一测试 | 采纳：在脚本的路径里加上 `ide/web/fonts`，在两份 ide-image 路径列表里加上夹具。两处合为一个"制品输入清单"PR | 新 PR 进 main（CI） | 不需要 |
| CF-29 | 第四轮功能审计 Overview | `every` 调度给每个任务都加了 Binance 的限流等待 | **成立。** `ide/overview/src/main.ts:51-53` 调了 `binance.wait()`，只在 Binance 429/418 暂停时（至少 60 秒）不为零；非 Binance 的任务（`:97,208,234,239,273,277,286`）也会跟着等 | 采纳：`every` 加一个 `host` 参数，缺省不等，只在 `:55,59,299` 传 `binance` | 新 PR 进 main（`ide/overview`） | 不需要 |
| CF-30 | 第二轮 X-04 | 比较失败的结果被缓存，同一个 drawn_commit 不再重试 | **成立，限当前页面生命周期。** `ide/web/src/state/comparison.ts:20,25`；刷新页面就会重试 | 采纳：失败时不缓存 | 第 4 阶段（IDE） | 不需要 |
| CF-31 | 功能审计"Shell/部署"、services 附录 | 手机端看不到研究同步状态 | **成立。** 轮询只在 `useResearchSync`（`components/ResearchSync.tsx:16-31`）里，只由桌面的 `LedgerWidget.tsx:13` 挂载；`shell/phone/` 下没有任何地方用到它 | 改写：手机研究页加一行只读的同步状态，复用同一个 hook；不在手机上加同步操作 | 第 4 阶段（IDE），低优先 | 不需要 |

## 二、已在别处跟踪（不重复记录）

| Codex 条目 | 已有位置 | 当前代码 |
|---|---|---|
| Agent 工具的默认 `line`/`at` 没有绑定页面快照（services 附录） | doctor 20261029-118（open） | 仍然成立：`ide/agent/src/chat.ts:40-47` 只把上下文写进 prompt，`tools.ts:17-18` 缺省用 head |
| Market 快照失败后，旧热力图不显示数据的时间（services 附录） | doctor 20261107-133（open，空状态文案） | "切换后迟到的响应覆盖新标的"**不成立**：`state/market.ts:68` 早已检查 `data.symbol`。失败只打一个点（`MarketPage.tsx:80`、`Stripe.tsx:33`），这一半并入 -133 |
| Research 摘要/样本外证据入口、Runs 诊断、Paper 手机控制、Live 通知回到原运行（功能审计） | doctor 20261107-121、20261031-09、20261031-15、20261107-132、20261107-120 | 只是扩展的假设，没有用户任务证据。研究会在新账本上从零开始，先等首批研究跑起来再按这几条 doctor 记录评估 |
| Web 发布与 Paper 发布的 journal I/O 重复（QF2、services 附录） | 重构计划 D4（部署重复约 140 行，第 1 阶段） | 成立，约 12 行几乎逐行重复（`deploy/release.py:287-299` 与 `deploy/paper_release.py:15-25`），按 D4 抽一个共用的 journal 小函数 |
| IDE 同一输入重复做图差分（AF2） | 未结清单 E5（IDE 每个请求都起一个 CLI 进程）旁边 | 成立：`ide/research_graph/serve.py:399-422`，每次 head 前移多起一个 CLI 子进程。没测过，并入 E5 一起量 |
| Live 首启准入与研究证据（T06） | R2（Live 预检要求同源码的已封存回放）；doctor 20261107-121 | 是设计如此：`live/runs.py:431-443` 展示登记和 `VALIDATION_NOTE`（"不设门槛，也不下结论"） |
| 三种模式的经济口径不同（T08） | R4.1（Paper 资金费）、R5（回撤刹车含手续费和资金费） | 文档已写明的模式差异，不是读错数：`engine/live_session.py:142-146` 自己说明了排除项 |

## 三、拒绝

| Codex 条目 | 理由（当前代码） |
|---|---|
| T01 `minimum_effect` 改为非必填 | 是设计如此：doctor 20261107-21 已选方案 A（写明单位和用法，#2350），#2599 的 schema 把它保留为必填列（`ledger/schema.sql:112`）。改为非必填会放宽 `DESIGN_INVALID`，要用户授权，而现在没有证据说明有这个必要 |
| T07 来源事前性、源码版本校验 | 来源件按内容哈希命名，"版本"已经隐含在里面；适不适用是 Agent 的判断。doctor 20261031-14 已经定了"skill 加读时派生"的做法。要收紧 `SOURCES_REQUIRED` 就得授权，而现在没有证据 |
| DF1 旧镜像复现时总传 `--leverage` | 只影响要退役的旧账本。新账本的首个试验必然跑在 v8 镜像上（3d37c5a8c 之后的镜像都认这个参数），C9/C10 也会让旧镜像路径整体退役 |
| R2-R05 `research status` 读两遍 manifests | #2599 已修：`_manifests` 被删掉，改为读 trial 和 capture 行（`status.py:44,119`） |
| R2-R06 样本外绑定与 `control_trial` | #2599 改写后行为相同，且只会多拒、不会放过；C10/B3（跨契约要求完全相等）会让两条规则一致 |
| R2-L01 Live 时长和品种直到 runner 才拒绝 | 修了也是白修：多品种只能从 CLI 进来，而 D5/P2 删掉了操作员命令行；时长上限由连续运行第 4 步（R5，已授权）移除。现在把拒绝提前，就是改拒绝的阶段 |
| 发布 tick 里 Paper 恢复两次（W511） | 恢复是幂等的，每次 tick 只多读几个文件；`paper_release.py:29` 的注释说明了"没有待办也解冻"是有意的。去掉它要先证明两次之间不会出现新状态，收益不值这个证明的成本 |
| IDE 三个 npm 任务共用一个 changed（X-07） | 实测 run 42868467112：web 40 秒、agent 10 秒、overview 9 秒，三者并行，每次只多耗 10–50 个 runner 秒，不增加墙钟时间 |
| release-ready 先分页取全部运行（X-08） | 实测共 96 个运行，只有一页；release-ready 全程 11–48 秒，昂贵的逐项检查本来就会提前停 |
| 第二轮的 51 组和接线简化（删 3 条误连、改标 121 条） | 改的是图，不是产品。线程自己也说"折叠数只代表图的层级" |
| 功能审计里的新模块：高级行情卡片、资讯、本地翻译的扩展或退役，命令面板整合，复制和交接链接 | 没有使用证据，线程自己也写着"先测再定"。这是个人工具，不是 SaaS（反馈记忆《Evaluation lens》），没有消费者证据就不新增模块 |

## 四、需要用户授权的事项

| id | 改什么 | 现在 | 改后 | 不授权时的替代 |
|---|---|---|---|---|
| CF-04 | `RETRY_NOT_ALLOWED`（`registration/register.py` 的 `retryable`） | 已完成执行、但经济封存失败的尝试不能重试，网格点被永久占用 | 有 capture、没有 run 的尝试都可以重试；原 capture 留着当作失败记录 | 不改：这类尝试只能放弃那个网格点；重新登记又会多占一次暴露 |
| CF-12 | 样本外验证的 Holm 族和窗口检查（`report/comparison.py` 的族成员、`window_read_before_binding`） | 技术重试单独算一个族成员；没有 p 的原登记仍以 provisional 占位；窗口检查从重试时间起算 | 一条原登记只算一个成员，p 取链上最新的成员；窗口检查从原登记时间起算（会多拒绝"原登记到重试之间读过窗口数据"的情形） | 不改：一旦有人重试，族就会被重复成员撑大，结论更保守但口径与设计站 `validation.zh.mdx` 所写的"登记族事后不增减"不一致 |
| CF-18 | Paper 恢复的身份核对（`paper/recovery.py`） | 恢复时不核对 `terms.json` 是否仍对应原市场提交 | 按原市场提交重新导出条款，比对不一致就拒绝恢复 | 不改：宿主上的条款文件被改时，恢复会悄悄用上新条款 |

CF-16 和 CF-17 都落在执行路径重规划已经列出的授权项里（R3.2 的归因顺序、R4.1 的资金费读数），不另行申请。

## 五、落点汇总

- **新 PR 进 main（不改 schema，按"一个根因一个 PR"，照常合入；#2587、#2595 要变基）：** CF-01（Paper 结束分流，含 `engine/paper.py` 的 `on_start`）、CF-02（Paper 启动前失败封存）、CF-03（Live 恢复漏传 `market_root`）、CF-05 + CF-06（Paper 读模型：列表一次读取、封存尾部交接）、CF-13 + CF-14 + CF-15（对账输入与计数）、CF-19（Paper 启动意图，与 doctor -132 合并）、CF-27（探索缓存原子换入）、CF-28（制品输入清单）、CF-29（Overview 限流宿主）。
- **#2599（L5）：** CF-04（需授权）、CF-07、CF-08 的读侧、CF-09、CF-10、CF-11、CF-12（需授权）、CF-26。
- **#2587（L5）：** CF-18（需授权，排在 #2595 之后）、CF-24。
- **#2595（R1）：** CF-20、CF-21、CF-22。
- **#2607：** 无。
- **R3.2 / R4.1（执行路径重规划）：** CF-16、CF-17，以及 CF-13 的验收用例。
- **第 4 阶段（IDE）：** CF-08 的界面部分、CF-23、CF-25、CF-30、CF-31。
- **随计划 D5：** CF-32。
- **仓库外，由用户确认：** CF-33（worktree 和分支清单）、CF-34（未跟踪的计划文档）。

## 六、全仓瘦身与治理补扫（本次审查自做）

用户 11-11 在审查中途要求：在结尾自己再做一遍全盘扫描，专找瘦身、垃圾清理、不一致统一和歧义消除。这次扫描以 e33e425a7 为准，先扣掉重构计划已列的项目（`new-ledger-redesign-20261110` 的 C1–C11、N1–N5、M1–M7、D1–D5、第 6 节 S，执行路径重规划的 R1–R5）、未结清单和并行覆盖扫描（`coverage/parts`），再看还剩什么。

### 机械检查：代码层已经干净

| 检查 | 做法 | 结果 |
|---|---|---|
| 拒绝码 | `shared/refusals.py` 的 254 个代码，逐个在 `tests/` 之外的产品 Python 里找 | 全部有产品调用者，没有死码 |
| CLI 命令 | 从 `cli/main.py` 的 `_parser()` 取出 15 组共 67 个命令，在代码、skill、文档、部署和 IDE 里找引用 | 每个命令都被引用两次以上，没有无人用的命令 |
| 文档里的代码名 | skill、设计站、各 README 里用反引号写的大写代码名，对照拒绝码目录和 Python 字符串 | 除环境变量和 Nautilus 枚举外全部存在；过时的 `NO_ECONOMIC_EVIDENCE` 已在计划 S 节 |
| Python 顶层定义 | AST 列出产品包的顶层函数、类、大写常量和方法，在产品、部署、IDE、skill 和文档里数引用 | 只剩 4 个：两个是框架钩子覆盖（`engine/live_venue.py:61` 的 `redirect_request`、`engine/order_rules.py:160` 的 `modify_orders`），`engine/warmup.py:20` 的 `EXPORTED` 用在同文件里；真正没人调用的只有 `live/credentials.py:25` 的 `new_ref` |
| 完全相同的函数体 | AST 哈希比较产品包里较长的函数 | 只有两对：`registration/seams.py:239`/`replay/seams.py:79` 的 `use`（M7 已列）、两个 HTTP 服务的 `log_message`（各 2 行，不值得合并） |
| 前端导出 | `ide/web`、`ide/agent`、`ide/overview`、`docs-site` 中被 `export` 的名字，在本包其他文件里数引用 | `ide/web` 有 10 个只给测试脚本用，`ide/agent`/`ide/overview` 有约 25 个类型只在本文件内用；都只是多了一个 `export` 关键字，不是死代码。计划 S 节已列的 `LiveActions.tsx`、`LiveRefresh.tsx` 等仍成立 |

结论：可删的死代码已由 20261105-20、-21、-24 等几轮清理扫掉，**代码层没有计划之外的大块垃圾**。这次重构的瘦身量来自计划已列的几块（估计产品代码减 1,000–1,300 行、测试减 600 行以上、部署减 250 行以上、计划文档和 doctor 记录减数千行、设计站去掉演练叙述），加上本记录的 CF-20、CF-21、CF-24、CF-26 等合计约百行。计划的估算要在第 3 阶段合入后，用 `git diff --stat` 实测核对，不要只凭估算宣称"大幅瘦身"。

### 计划之外的新增治理项

| id | 发现 | 证明 | 结论 | 落点 | 授权 |
|---|---|---|---|---|---|
| CF-32 | `live/credentials.py:25` 的 `new_ref()` 没有调用者 | 全仓只有定义这一处出现这个名字 | 删除 | 随 D5（删操作员 Live 命令行）一起 | 不需要 |
| CF-33 | 仓库外堆积：主检出登记了 124 个 worktree（其中 55 个在 `/private/tmp`，包括被审 Codex 线程自建的 `/private/tmp/trade-flow-*` 快照 worktree），本地有 213 个分支，其中 142 个已并入 `origin/main` | `git worktree list`、`git branch --merged origin/main` | 新账本开张后，按 11-07 的仓库清理做法：先列出名字和末端 SHA，再归档到 `refs/archive/`，最后删除已合入的分支和不再使用的 worktree | 仓库外，不进 PR | **需要用户确认清单**：按反馈记忆《Branch deletion needs a listing》，删除前要先给出清单 |
| CF-34 | 主检出里有 6 份未跟踪的计划文档：`open-items-20261111`、`r1-handoff-20261111`、`cross-line-research-experience`、3 份 `live-gtd-*-20261108`。只存在一份工作副本，没有 git 历史，其他会话读到的版本可能不同 | 主检出的 `git status --short` | 开张前逐份决定：仍在用的作为计划提交（例如 open-items 作为切换清单），已过时的删掉。11-10 已删除 Live 测试历史，3 份 live-gtd 文档大概率可以删 | 用户决定；需要的那几份走 docs PR | 删文档由用户决定（与计划 P6 同类） |

### 歧义与不一致：已在计划里，只需确认实施时不要漏掉

扫描里看到的命名和表述问题，都已经有计划条目：`market_commit` 实际存的是日期（N1），profile 的 `kind`/`role` 含义互换（N2），版本后缀 `@N`、`-v6`（N3），`research status`/`research state` 这类容易混的命令名（N4），过时注释（N5），设计站的旧码名和 Dolt 2.4.2 说法（S 节、L8）。本记录又补了两处表述错误：CF-22（Live 入场说明）和 CF-23（About 页）。

## 七、决定

（留给用户填写授权结果和日期。）
