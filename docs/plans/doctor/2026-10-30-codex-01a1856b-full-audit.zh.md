# 2026-10-30 Codex 会话 01a1856b 整场审计

| 项 | 值 |
|---|---|
| 会话 | Codex，`rollout-2026-10-29T11-09-19-01a1856b-3b36-7503-a066-1922397920cc.jsonl`，2026-10-29 02:09:20–2026-10-30 03:45:36 UTC；子会话 51 个（40 个预检审查、9 个纠正审查、1 个换人后的审查、1 个关线），无孙会话；attach 原始证据 `/tmp/doctor-01a1856b/evidence`（只用 `evidence/`） |
| 诊断会话 | Claude Code，claude-opus-5-5，会话 e67f2035-eab5-4995-a0c2-2a21450d0aba，worktree `cool-poincare-64d634`；三个只读工作流子代理加一个只读会话图提取子代理；本会话不写 PR 以外的东西 |
| 检出 / 账本 | **会话检出**：先 `9a19` worktree，03:25 起 `research-entrynotional` worktree，04:17 后停在 `773ac59b4`，缺随后合入的 #1874（07:58 Z）、#1889（09:10 Z）、#1867、#1868、#1870，结束时落后 main 35 个提交。**当前产品**：main `e8b09ce34`。**账本**：`l4kb2mgsqdq28tvi65o0se44df99us5a`..`ltjorrnoj5gsbc5vut8g0c9n6pl2c0kl`，范围内 1,118 个提交，本会话约 444 个；同期另有 channel-breakout 与 rsi-intraday 两条线写入 |
| 覆盖 | **行为与决策**：主线全部用户/Agent 消息、04:20 后全部失败调用、51 个子会话的角色与 token、审查 24/29/32/47 全文与 299 的 api/activity 说明、judgment 314–478 正文、run_return 原跑与重跑对照、Nautilus rc7 存根与运行时探针。**数据与成本**：`dolt_log` 全范围、trial/registration/capture/run/judgment/bundle、导出哈希与身份字段、指纹/blob 大小、`ledger review` 与备份、报告与比较在 main 上的耗时（含 cProfile）、token/上下文/压缩/发现读/轮询/拒绝。**产品契约**：会话碰到的每条拒绝、审计、资格与 skill 规则；#1849、#1856 的全部消费者；skill 对 Anthropic 规范；ruff、mypy（94 文件）；main CI quality 40892641562（680 个测试 OK、无警告）；文献（OpenAlex、Crossref 免 key）。**保真度**：两条线各一张账本图与仅凭转录的会话图，`ide.py check` 均通过后比较。**未覆盖**：本机全量测试、docs-site 构建、Semantic Scholar 只部分检索、多数子会话审查全文只做 grep 与抽样、IDE 与 paper 日志、各数据库物理大小（卷共享 66.65 GB）、trial 224 原生阶段 17.6 分钟的原因、nautilus-report-analysis 的逐项遵循 |
| 成本 | **会话**：活动 17.65 h，另因宿主“model at capacity”停 7.95 h（10-29 17:14:55–10-30 01:12:05）。研究约 13.2 h；发现约 0.58 h；产品引起的修复 93 min（导出 12 min、#1849 48 min、#1856 33 min，其中 CI 约 29 min、等批准约 19 min）；`cancel_order` 纠正与重跑 101–107 min；换窗/换线与 Goal 宿主问题 74 min；工具阻塞等待 2.67 h（宿主 30 s 让出上限）。主会话输入 421.5M（缓存 419.55M）、输出 1.23M，1,813 次模型请求、1,701 次工具调用；子会话输入 100.2M、输出 0.48M。每个研究版本约 14.1M token、中位周期约 20 min，其中回放本身 1.9 min。产品造成的无效试验 0（trial 218 被 #1856 前的规则屏蔽后已恢复）；源码缺陷使 9 个运行失去经济证据（见 -02）。**本审计**：约 03:51–04:40 UTC；四个子代理合计约 41 万 token，主会话 token 未计量 |
| 净变化 | 提议合计：-01 去掉图里一份重复的失败评审推导（改用已有的 `availability.source_reviews`），不加规则；-02 research-round 一句加约 15 词，转述设计站已有的“api 是源码属性”；-03 重述一句换线到期条件，词数持平；-04、-05、20261025-24 只计量（后者加一个评测案例，grader 单独 PR）。skill 词数（各 skill 目录 `.md` 空白分词，与 01a18327 记录同口径）：research-start 3,835→3,285，research-round 9,194→9,137，product-doctor 3,369→3,225；本记录的提议约 +15 词，增长理由见 -02 |

## 发现

| id | 发现 | 证据（会话；当前产品；消费者与决策） | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261030-01 | 研究图的 `eligibility_change` 事件自己推导失败评审的后果：只看 verdict 与源码哈希，不看 #1856 的 `review_activity.resolved`、镜像摘要与封存范围，于是把已恢复资格的运行画成失去经济证据，也没有恢复事件；只有 activity 未决时写 “(unspecified)” | **会话**：trial 218 03:35 被 `source-review-214-52a2ab00a61965c0` 屏蔽，#1856 合入后 04:16 恢复。**当前产品**：`report/graph.py:239-255` 对每个 failed 评审写“runs of this source lose economic evidence: [全部 research 试验]”；`qualification/availability.py:258-291` 的 `source_reviews` 才按镜像、范围与三个条件筛；`research graph --line research-line-20261029-ema-entrynotional-multiyear --at ltjorrno…` 输出该事件称 [218] 失去证据，而同一图里 218 `eligible: True`。**消费者**：IDE 画布（`services/ide/research_graph/layout.py:24`）与 research-graph skill，用户和 Agent 据此读资格历史。同类：20261029-32（修复只验失败的那条路径），#1856 验了经济资格与起线，没验图 | fix（图事件取 `availability.source_reviews` 的结果，删掉自己的推导；不改规则、不加字段） | wrong output（用户可见图；未见据此做错的决定） | open |
| 20261030-02 | 源码评审的 api 项范围没写进 research-round：设计站说 api、causal、readiness 是源码属性（`docs/rd/design-code-ledger.zh.mdx:1336`），skill 只交给审查者预检原件与四个项名（`research-round/SKILL.md:42-47`）。10 份评审（299、306、310、314、320、325、326、332、340、347）都按“实际执行观察到的下单”判 api 通过，没核对预检没走到的 `self.cancel_order(order)`；rc7 的 `Strategy.cancel_order` 只收 `ClientOrderId`。Agent 自己 11:18:10 的探针已报同类 `TypeError: 'StopMarketOrder' object is not an instance of 'ClientOrderId'`，当时读的是 `ExecutionAlgorithm` 存根（`order: Any`），没回头查已发布源码 | **会话**：缺陷首见于本会话的 `ema-entrybudget-atrstop@1`（10:55，账本 `candidate` 只读查询；别的线都用 `order.client_order_id`），被 8 个派生版本继承；14:42 审查 353 用钉住镜像探针复现；14:44–15:10 九份纠正审查失败，`research status` 列 302、309、311、317、323、328、334、342、349 为 `SOURCE_REVIEW_FAILED`。**当前产品**：`.venv/.../nautilus_trader/trading/__init__.pyi:570` `Strategy.cancel_order(self, client_order_id: model.ClientOrderId, …)`；`engine/run.py:165-169,261-275` 回调抛异常即运行失败，所以通过的运行没走到该分支；重跑与原跑 `run_return` 逐日相同（302/361、328/367、334/370、342/376 各 1,461 天，`native_return` 与 `mean_gross_notional` 全等）。mypy 抓不到（`cache.orders_open()` 返回 `list[Any]`）。**消费者**：主 Agent 停登记、重跑 4 个窗口、重建推荐序列；5 个被屏蔽版本未重跑，保持无经济证据 | skill（research-round 审查一句改为：四项照旧，api 覆盖源码里每个原生调用，预检走没走到都要对钉住镜像核对）。不选 none：同一会话 10 次漏、Agent 握有证据未用。不选重述屏蔽（只屏蔽确实执行过的失败）：产品不知道失败是否只在未执行的抛异常分支，要新存储字段；重跑本就复现，代价只是时间 | hours（约 107 min、4 次全窗重跑、9 份纠正审查约 20.7M token、4 组新预检与审查约 10M token） | open |
| 20261030-03 | 换线到期以“推荐版本连续不变”计数（`research-round/SKILL.md:84-90`），而推荐何时可以换没有判据（`references/review.md:3-8` 只说换了就写推荐）；每次以落在可检测差之内的差异换推荐都把计数清零。本线 23 次合格比较全在可检测差之内，推荐仍换了 5 次（258→282→293→361→367；judgment 390 以“实际有利读数”把 334 提到 328 之上，judgment 478 却以“不追每个有利点估计”保留 367 而不选 370，同一对经济结果给出相反处置） | **会话**：judgment 314、337、350、357、380、390、410、418 正文都写 \|mean diff\| 小于可检测差；用户 09:42 选 A 后到 01:37 才第一次到期，其间 22 个研究试验（282–431）。**当前产品**：`SKILL.md:84-90`、`review.md:3-8`、`feedback.md:29-32`（此类差异“不可分辨”），自 `773ac59b4` 未改。外部规范：数据窥探与多重检验文献都按搜索过的每个设定计数，没有让搜索者自己的选择清零计数（White 2000, Econometrica 68:1097；Hansen 2005, JBES 23:365；Bailey et al. 2014, Notices AMS 61:458；Harvey & Liu 2015, JPM 42:13）。**消费者**：主 Agent 继续登记而不停下交还选择 | authority + skill（重述那一句：连续若干次研究运行各自都落在可检测差之内即到期，推荐在可检测差之内的移动不清零、也不算改进；替换原句，不加情形；`REVIEW_DUE` 代码不动）。改的是 Agent 停下问用户的条件，按 AGENTS.md 先问用户 | hours（实测：两次到期之间 22 个研究试验；估算：按重述后的条件约在 trial 309 后到期，约多跑 17 个试验） | open |
| 20261030-04 | `replay report --trial-id` 与 `hypothesis compare` 每次调用都按成员逐个查询 MARK 日收盘重算整个成员池的市场日收益（`report/measures.py:595-608` → `market/read.py:50-90`，29 个合约各一条查询），4 年窗口约 15 s、6 年约 35 s；同一市场提交结果不变，只有进程内的 `report/graph.py:98-115` 复用 | **会话**：主线 55 次研究报告、32 次比较，报告 p90 36.8 s、比较中位 25.4 s；审查子会话另 42 次报告。**当前产品**：数据审查在 main 上计时 trial 460 报告 16 s，cProfile 15.3 s 在 `daily_returns` | measure（先量查询本身：单条批量查询或命中索引能省多少；不先加跨进程缓存） | minutes（估算主会话 22–30 min，子会话未计） | open |
| 20261030-05 | 同一钉住输入每个研究试验导出三次：登记（`registration/register.py:605` fresh 后 `:611` 删除）、回放（`replay/entry.py:475` 再 fresh）、复现（`replay/reproduce.py:74-76`）；`registration/inputs.py` 头注释写“each export once” | **会话**：202210 线 31 个登记的导出哈希全是 `ea14d8a05fb7…`；研究导出中位 28.2 s（37 次共 19.3 min），登记导出共 17.9 min，复现导出 10.2 min | measure（先确认重复 fresh 是否承担身份核对；是则留，不是则共用一次导出） | minutes（约 17 min 可省，估算） | open |

**记为 none 的观察**

- 资格屏蔽本身（任一 failed 评审屏蔽该源码全部运行，`qualification/availability.py:147-151`）在本会话按设计触发并有用；源码 API 缺陷的修复与纠正审查都保留了原记录（数据审查核对 9 份纠正审查、5 个更正说明包均被引用）。
- 审查盲测是 Agent 自加的规则，skill 交给审查者的报告缓存含绩效（`SKILL.md:42-47`）；审查 440 读到绩效后被换人（10-30 02:08:33），审查 325 在作者提示后发布失败更正（12:40）。都已就地处理。
- `CONCURRENT_WRITE` 一次（10-30 03:02:47）：`ledger/trials.py:127` 的 `open_trial` 不重试（封存写重试 5 次），消耗 trial 号 453、无残留行；Agent 照 `next_actions` 重跑，约 5 min。等复发再议。
- `SUBJECT_ROLE_MISMATCH` 两次、`REGISTRATION_INVALID`（`shared_duties` 键）一次，都是 Agent 输入错误，`next_actions` 正确。
- 想读订单与成交就得 `replay explore` 复现（20 个 explore 试验、开到封存共 28.1 min），因 `replay run` 存完即删工作目录；与已修的 20261022-11 同一模式，这次未见多余复现，不另立。
- 备份落后 1,143 个提交（头 `odeo1h7…`，10-25），`ledger review` 仍 ok；用户已拒同步步骤（20261022-14），只记观察。
- 用户怀疑 Agent 读设计站或过胖的 skill 稀释了对硬规则的注意：本会话 skill 与文档读入约 127k token，其中 docs/rd 只 5.5k 字符；06:10 漏说暴露检查的提问早于读 doctor 记录，06:40 的放宽提议紧跟 06:27–06:35 读 doctor 索引与整合评审。两者都不足以定因，记为未证实。
- Goal 暂停后会话继续约 62 min：用户 10-30 02:42:47 暂停（`thread_goal_updated` paused，会话无 `update_goal` 调用），Agent 又跑了预检 452/458、运行 454/460、复现与 recommendation 505，03:44:25 `get_goal` 才看到。归 20261021-29。
- 本机 ruff、mypy 通过；main CI quality 40892641562 680 个测试 OK，无 ResourceWarning/DeprecationWarning；日志里的 HTTP 请求行、`(1105, 'no common ancestor')`（`tests/research_graph/test_replica.py` 经 `services/ide/docker/replica.py:99`）与 git 默认分支提示都是测试输出，不是缺陷。

## 既有项

| id | 本会话 |
|---|---|
| 20261025-24 | **recurred，用户先发现（应由“行为与决策证据”发现，attach 也未先指出）**。用户 05:58 提议从 2022-10 起；06:00 Agent 读了 research-start（`SKILL.md:47-59` “每个选项都是现在能起的线”，冻结规则“never on earlier months”），06:10 仍只问“是否正式改用这个主开发窗口”，没说原源码在新窗口被 `SOURCE_ALREADY_EXPOSED` 拒；06:29 自己发现，06:40 的提问又把“授权换窗规则 PR，保持原策略”与“只读区间描述”（不是线）列为选项。用户 06:43 答“按产品规则来”，并对 attach 会话说“有明确产品规则的硬骨架部位 他为什么不遵循反而是抛question给我选呢”。规则原文清楚，代价约 49 min、两次等用户。动作：measure（加 research-start 评测案例“用户提议把已暴露源码换到另一窗口”，grader 单独 PR）；`line select` 提前拒绝暴露源码（契约审查的备选）挡不住这次提问，不提 |
| 20261029-02 | 复发佐证：检出 `773ac59b4` 在会话中途落后 main，两次祖先检查都通过（14:18:20、10-30 01:47:24）；缺 #1874 使 07:59 起主线 9 次、14 个审查子会话约 30 次 `PUBLISH_FAILED`，`next_actions` 指向网络与 key，主线 11 次手动 `ledger publish`；缺 #1889 使 10:50 起按旧 bracket 规则绕行（改字典拼 OTO）。仍 open |
| 20261029-22 | #1874（`26eca2061`）已合；本会话跑的是合入前代码，不算复发也不算验证 → fixed 26eca2061 |
| 20261029-37 | #1889（`e03ef399f`）已合；本会话检出不含它 → fixed e03ef399f |
| 20261025-06 | 复发：换线时宿主拒绝在旧 Goal 未结束时建新 Goal，Agent 06:56 载入 computer-use 想操作 Codex 界面被拒，07:05 用户手动清除；约 9 min。之后 09:41、01:44 的提问已把“请在界面结束当前 Goal”并入同一问题。仍 recurred |
| 20261021-29 | 暂停后约 62 min 才观测到（上次约 5 min），见上；仍 measure |
| 20261025-33 | 增长：本会话运行指纹合计 11.68 MB（均值 316 KB，最大 631 KB），约占会话逻辑增长 18 MB 的 65%；全账本 29.86 MB / 154 个运行（10-29 记 9.56 MB / 74 个）。`by_utc_day` 仍无读取方（`engine/compare.py:98,128` 唯一生产者）。仍 measure；删除需存储字段评审与用户授权 |
| 20261025-10 | 复发佐证：`report/status.py:207-266` 的 `by_development_window` 只计完全相同的窗口，2022-10 窗口显示 33 次，与之重叠的 2020 窗口 4 次与另 96 次不计。仍 measure |
| 20261025-18、20261023-07 | 上下文每次调用中位 222k、p90 391k、最大 450k；5 次压缩，每次后 15 min 内重读 100–161k 字符（共约 128k token、57 次调用），AGENTS.md 21 次、research-start 11 次、doctor 索引 11 次；审查子会话读 research-round SKILL.md 56 次。仍 measure |
| 20261029-07、20261029-01 | 两项均由本会话在会话内诊断并修复（#1849、#1856），已在已结表 verified；#1856 的图消费者另记为 20261030-01 |

## 移除清单

| 机制 | 防的风险 | 谁另外覆盖 | 本会话所见 | 提议 |
|---|---|---|---|---|
| failed 评审屏蔽该源码全部运行 | 源码 API、因果或准备状态不成立的运行进入比较 | 无 | 9 次有用触发；读数事后证明未受影响，但产品无从得知 | 保留 |
| `SOURCE_ALREADY_EXPOSED`（登记） | 已看过结果的源码在别的窗口重测 | 无（`line select` 不查） | 正确拒绝原源码换窗 | 保留，不前移 |
| 换线到期“推荐不变”条件 | 线不再产出可分辨改进时继续跑 | `REVIEW_DUE` 只管写推荐的节奏 | 被可检测差内的推荐变更反复清零 | 重述（-03） |
| 登记、回放、复现各 fresh 导出 | 输入身份 | 导出哈希核对 | 31 个登记同一哈希 | 先计量（-05） |
| `by_utc_day` 指纹 | 逐日语义比对（设想） | 整体指纹比较 | 无读取方，体积占增长 65% | 先计量（20261025-33） |
| 审查盲测（Agent 自加） | 审查受绩效影响 | skill 未要求 | 一次越界后换人 | 不进 skill |

## 决定

待用户：

1. **20261030-03（研究 skill 的停止条件）**：现在换线到期要求“推荐版本连续不变”，推荐在不可分辨的差异上移动就清零；改为“连续若干次研究运行各自都在可检测差之内即到期，推荐在此范围内的移动不清零”。这会让研究更早停下来问你换线。建议同意。不改则维持现状，靠 Agent 自律不在不可分辨差异上换推荐。
2. **20261030-02 的备选**：不改屏蔽规则（建议），只在 skill 写明 api 覆盖源码里每个原生调用。若想让“只在未执行分支里的 API 错误”不屏蔽已封存读数，需要新存储字段与审批，不建议。
