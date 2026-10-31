# 2026-10-31 Codex 会话 01a18f8b 整场审计

| 项 | 值 |
|---|---|
| 会话 | Codex（gpt-6.1-sol），`rollout-2026-10-31T10-21-15-01a18f8b-f2b7-7b11-937d-a80f36e75777.jsonl`（5,466 行），2026-10-31 01:21:19–06:47:34 UTC，11 轮，2 次压缩（03:14、05:20）；子会话 28 个（14 个源码审查、14 个全窗口核对），无孙会话，与 attach `rollouts.tsv` 一致；attach 原始证据 `/tmp/doctor-01a18f8b/evidence`（04:53 Z 起采集，此前只有 `--since 01:21Z` 的服务日志） |
| 诊断会话 | Claude Code，claude-opus-5-5，会话 564e392a-251b-4e48-93ad-de669beb1a58，worktree `youthful-volhard-401479`；三个只读工作流子代理加一个只读会话图提取子代理；本会话只写这份记录、索引和它们的 PR |
| 检出 / 账本 | **会话检出**：Codex worktree `f5a7` 与 `channel-research-20261031`，全程 `8732f5960`，即会话开始时的 origin/main（第一个后续合并在 01:40 Z）。**当前产品**：main `3155ab6e9`，比会话多 30 个提交（含 #1932、#1936、#1937、#1943）。**账本**：`7v7p8mkm0dkj8a44uho0g09hocoq0tv7`..`79nvntvq0n28t6ou9c45kkjf4php67f3`，165 个提交，全部 `research_writer`，按命令与 id 连续性（judgment 506–554、trial 465–492）逐一对上本会话，attach 证据里范围内无别的写入者 |
| 覆盖 | **行为与决策**：全部用户与 Agent 消息、29 份时间线里每个非零退出与拒绝码、全部 Goal 调用、14 份登记正文与 14 次比较（只读 `hypothesis compare` 复算）、judgment 506–554、491 的审查路径、research-sources 调用、零成交量证据。**数据与成本**：范围内全部提交与行、28 个试验的身份字段、export 与 receipt 哈希、备份与 DoltHub 头、各阶段耗时与 token、轮询、压缩后重读。**产品契约**：会话碰到与没碰到的拒绝、审计与 skill 规则；`market/remote.py` 供给端与 `deploy/`；CLI help、设计站、IDE（只经 API 与源码，未截图）；全部 skill 对 Anthropic 规范；本机 ruff、mypy、compileall、`tests.market.test_remote` 与 `tests.cli.test_help`；main CI quality 41178361545；文献（OpenAlex、Crossref 免 key）。**保真度**：两条线各一次。**缺口**：子会话任务说明（Codex 加密）；Semantic Scholar 未检索，文献只读摘要；零成交量即时成交未做原生重跑；`paper/` 与 video-evidence 未审；IDE 未渲染；数据库物理增长（Docker 卷内）未量 |
| 成本 | **会话**：总跨度 326 min。等用户约 16.5 min（含换 Goal 6.4 min）；起线与选线 4.7 / 7.7 min；channel 5 个实验 101.8 min，RSI 9 个实验 195.6 min，每实验中位约 18 min（14.5–30.1），其中产品计算（预检、回放、封存）合计约 20 min（约 6%）。产品相关的绕行与修复：供给端拒绝 1.3 min、7 次调用；`LINEAGE_MISMATCH` 一次重试约 23 s；写入间隔中位 25.8 s 引起的空轮询约 10 min。**token**：主会话输入 139.2M（缓存 138.3M）、输出 0.55M，609 次请求；子会话输入 63.8M、输出 0.34M（审查 29.3M、全窗口核对 34.5M）；每实验约 14M 输入。**无效试验**：0 个。**本审计**：约 06:51–07:30 Z；四个子代理合计约 1.07M token，主线 token 未计量 |
| 净变化 | 提议合计：机制 0 增；-07 把换线条件从“均值在可检测差内”改写为“配对区间含零”，feedback.md 改正一句（skill 约 ±0 词，authority）；-08 `market coverage` 的 interpretation 改写一句（skill 0 词，产品文字约 +20 词）；20261025-11 拒绝信息带出不符的字段、两边取值与两条出路（拒绝码 0 增），另交用户定是否让供给端只比导出内容（−1 比对分支）；20261025-06 research-start 加一句约 20 词；-09 IDE 改一个标签单位；-10 设计站两页改正；-11 去掉一个存储的耗时字段（authority，−1 字段）；20261027-07 `market/remote.py` 照 `paper/serve.py` 吞掉客户端断开（+1 个已有写法的重写方法）；-12 去掉一处字节相等检查（authority，−1 分支）。拒绝码按 `len(ledger.refusals.CATALOGUE)` 计，会话提交与当前都是 264，本记录 0 增。skill 词数（各 skill 目录 `.md` 空白分词，同 01a1856e 记录口径）：research-start 3,355、research-round 9,344、product-doctor 3,367（01a1856e 记录为 3,285、9,137、3,225），全部 `.agents/skills/**/*.md` 26,027；本记录提议约 +20 词。增长理由：20261025-06 已第四次复发，宿主的“一线程一个未结 Goal”只能靠提问时告诉用户 |

## 发现

| id | 发现 | 证据（会话；当前产品；消费者与决策） | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261031-07 | 换线条件把按登记检验已显著的结果也算作“分辨不出”：`detectable_mean_log_difference_80pct_normal_approx` 是同一标准误的约 2.49 倍（α=0.05 单侧加 80% 功效），“在其内”即 \|t\| < 2.49，而登记的单侧检验在 1.645 倍就拒绝；不看符号，显著变差也计数；可检测差随每次改动的方差变，一年窗口上从年化 0.02% 到 43% 不等，把“无效应”和“无功效”混在一起 | **会话**：RSI 线 06:21 由 484、486、488、490、492 连续五次触发换线，其中 484 单侧 p=0.016（3/7/14 日块 0.013/0.016/0.018），年化差区间 [+0.2%, +4.9%]；channel 线 03:10 的五次里 472 年化差区间 [−44.0%, −1.5%]（显著变差）。按登记检验，两次停线都早到：去掉 472，channel 到 474 只连续 1 次；去掉 484，RSI 到 492 只 4 次。两次都以 Goal blocked 等用户告终（03:15、06:47），RSI 线此后一直停着。Agent 照文执行，并三次（02:39、03:12、05:04）提醒“在可检测差内不等于不显著”。**当前产品**：`research-round/SKILL.md:98-104`、`references/feedback.md:29-31`（“低于可检测差就无法在该数据上区分”，统计上不成立）、`report/comparison.py:205-210`、设计站 `feedback.mdx:274`；两份 skill 与会话提交逐字节相同。**规范**：Hoenig & Heisey, The Abuse of Power (2001), https://doi.org/10.1198/000313001300339897 （只读摘要）。复算全部来自会话留存的 14 份 compare 输出与审阅者的只读 `hypothesis compare` | authority（换线条件改为“配对基本区间含零”的研究运行才计数，可检测差改作年化单位的功效读数；改正 feedback.md 那句；规则 10-30 经用户批准，改动由用户定） | hours | open [本记录](2026-10-31-codex-01a18f8b-full-audit.zh.md) |
| 20261031-08 | `market coverage` 的 interpretation 说零成交量分钟“bar execution … fills nothing, so an order it crosses waits”，只对挂着的单成立：在零量分钟新提交、可即时成交的单按引擎缓存的盘口成交 | **会话**：01:26、03:20、04:05 Agent 把这句转述给用户；trial 478 核对子会话（01a19017，06:30:59.999 Z 那一笔）找到 BUY LIMIT `O-20250829-063059-001-BTC-2043` 在 volume 0 的分钟以 taker 成交 0.090 @ 110966.40，四个订单事件同一时间戳；10-29 会话的 trial 373 已见 MARKET IOC 同样成交并写了证据包 `rsi-intraday-zero-volume-treatment-20261029`，RSI 线说明里仍存着错句。**当前产品**：`market/coverage.py:31-34` 未变；`capital.participation@1` 把零量成交单列（`ledger/metrics.py:845,853,866`），产品自相矛盾；评测 `zero-volume-observation-asks-only-blocking-gap/prompt.md:16` 引了这句。机制来自子会话读固定镜像的撮合源码与 10-29 的合成探针，本审计未原生重跑 | fix（改写那一句：挂单穿过零量分钟要等下一根有成交的 bar；零量分钟内新提交的单可按引擎最后的盘口成交）；评测引文另开 PR | wrong output | open [本记录](2026-10-31-codex-01a18f8b-full-audit.zh.md) |
| 20261025-11 | 复发于新机制：#1906 的市场供给端按导出器源码哈希比对两端（`market/remote.py:121-122,266-269`），导出字节不变的导出器改动也让研究回放被 `MARKET_REMOTE_INVALID` 拒；拒绝不说哪一项不符、两边取值和出路 | **会话**：01:31:20 首个预检被拒，供给端跑 df1b52a11（导出器 `9d80479c…`），检出是 `410b43a0…`，中间的 dab446d8c（“No behavior change”）与 77d4a9c7d 不改导出字节；Agent 用 80 s、7 次调用（含 `docker inspect`、`docker exec`）查明，写了临时 `--market` 本地配置跑完全部 28 个试验，导出内容指纹与对照 339、430 相同，活动配置未改。供给端 03:57 被重建，会话没有回到它。**当前产品**：`ledger/refusals.py:18-19` 的修复建议只有“Inspect the supply identity…; no local or latest fallback is used”，`expected: null`；本地出路散在 `deploy/README.md:43-51`（改活动配置，需授权）与 `market/README.md:304`；10-24 至 10-31 有 23 次提交改过导出器文件，而 #1932 起每次开始都把检出移到最新 main，供给端只在用户 `docker compose pull/up` 后更新。10-25 用户已批准输入键不再比对 `exporter_source_sha256`（`registration/comparability.py:20` 已只作出处） | fix（拒绝带出不符的字段与两边取值，修复建议写两条出路：请用户更新供给端，或传本地 `--market` 配置）；authority（供给端是否照 10-25 决定改比导出内容） | minutes | recurred [本记录](2026-10-31-codex-01a18f8b-full-audit.zh.md) |
| 20261025-06 | 复发：换线时宿主拒绝在本线程另建 Goal（旧线 Goal 未结，blocked 也算未结），research-start 没写这一步；两次停在提问后各空转两个 Goal 回合才 blocked | **会话**：03:12 的提问没说换线要先结束当前 Goal；03:20:09 `create_goal` 被拒（“this thread has an unfinished goal”），Agent 拒绝把可继续的旧 Goal 标为完成，请用户取消，用户 03:26 照做，等 6.4 min；06:44 的提问 Agent 自己补上了这一步。03:14–03:15 与 06:45–06:47 四个空转回合约 3.0M 输入 token，每回合重读约 32 KB `get_goal` 与 20 KB 研究状态。**当前产品**：`research-start/SKILL.md:92-101` 只写沿用本线 Goal 与新建 Goal | skill（换线提问写明宿主一线程只留一个未结 Goal 时用户要先结束当前 Goal，约 20 词） | minutes | recurred [本记录](2026-10-31-codex-01a18f8b-full-audit.zh.md) |
| 20261031-09 | IDE 摘要的 “Unchanged for N runs” 数的是推荐判断（`recommendations_unchanged`），不是运行；IDE 也不显示换线到期或在等用户的决定，用户得回聊天里找 | **会话**：两次停线等用户选线，状态只在聊天与 Goal 里；Agent 自己拼跨线对照表（03:12 前 11 次调用、06:21–06:44 19 次）。**当前产品**：`ide/research_graph/layout.py:194-195`、`ide/web/src/widgets/Recommendation.tsx:36`（tip 自称 “recommendation judgments”）；RSI 线视图读出 `recommendations_unchanged: 1`、`runs_since_recommendation_changed: 0`；四条线的达标对比在 IDE 要 8 次点击外加记住四组读数。**规范**：Nielsen 十条之 1（系统状态可见）与 6（识别而非回忆），https://www.nngroup.com/articles/ten-usability-heuristics/ | fix（标签单位改为 judgments）；measure（用户靠什么看到在等自己的决定，再定 IDE 要不要显示） | unknown | open [本记录](2026-10-31-codex-01a18f8b-full-audit.zh.md) |
| 20261031-10 | 设计站落后两处已合并的改动：架构页写 compose 四个服务、运行时镜像名 `strategy-runtime`，实际五个（缺 market-supply 及其导出器耦合与更新方式）、名为 `trade-runtime`；research-start 设计页 E.1.2.3 仍写“检出在 origin/main 上”，#1932 已改为移到当前 origin/main，新评测 `start-moves-stale-checkout-to-main` 未列 | **当前产品**：`docs/rd/platform-architecture{,.zh}.mdx:9,32`（与发布页同）对 `deploy/compose.yaml`；`docs/rd/design-skill-research-start{,.zh}.mdx` 的 E.1.2.3 对 `research-start/SKILL.md:14-19`；评测 `readiness-checks-checkout-on-main` 的描述仍是祖先检查。供给端缺席于架构页，使上一条的出路在设计站无处可查 | fix（文档两页；评测描述另开 PR） | none | open [本记录](2026-10-31-codex-01a18f8b-full-audit.zh.md) |
| 20261031-11 | 导出收据里的墙钟 `"seconds"`（`market/export.py:487,577`）进了公开账本的输入覆盖文件，同一窗口内容相同的文件因此存成多份；无人读它，内容哈希已按语义去掉它 | **会话**：28 个文件存成 27 份不同内容（212 KB），去掉该字段只需 6 份。**账本全量**：491 个文件 243 份（1.81 MB），去掉后 66 份（0.47 MB），多出约 1.34 MB 永久留在只追加的公开账本 | authority（存储内容变化，按 AGENTS.md 先做独立子代理审阅；低优先） | none | open [本记录](2026-10-31-codex-01a18f8b-full-audit.zh.md) |
| 20261027-07 | 复发于新服务：`market/remote.py` 的供给服务在客户端断开时打印双重 `BrokenPipeError` 回溯，兜底分支再写已关的套接字 | **会话期间**：`services/market-supply.log` 04:28、05:09、06:04 三次。**当前产品**：`paper/serve.py:428` 与 `ide/research_graph/serve.py:332` 已重写 `handle_error` 吞掉断开，`market/remote.py:331-349` 没有 | fix（照前两处的写法） | none | recurred [本记录](2026-10-31-codex-01a18f8b-full-audit.zh.md) |
| 20261031-12 | 登记正文的 `change` 必须与候选发布的 `difference` 逐字节相同（`registration/register.py:318`），只差末尾换行也被 `LINEAGE_MISMATCH` 拒；`change` 可由候选导出 | **会话**：05:42:25 一次拒绝，重试约 23 s；拒绝信息点名的父版本其实相符，`expected: null`，`registration add --help` 不列此码。见删除清单 | authority（去掉这处相等检查或改为从候选取值；复发未证实，低优先） | minutes | open [本记录](2026-10-31-codex-01a18f8b-full-audit.zh.md) |
| 20261031-01 | 修复只覆盖新镜像：成交量占比在 `fill_volumes` 存在时才封存（`ledger/metrics.py:53,793`），而四条开着的线都钉在 b0b2337（早于该改动），此后每个运行仍封存 null，skill 仍让 Agent 手算并记判断（`nautilus-report-analysis/references/capital.md:23-27`） | **会话**：会话检出早于 #1943；Agent 01:38 写 `/tmp/channel-20261031-participation.py`，03:32 改给 RSI、03:59 与 04:00 再修，27 次调用覆盖 14 个研究运行；14 个核对子会话同时复算（共 76.4 min、34.5M 输入 token，占比因任务说明加密未知）。**当前产品**：`research state` 的 execution_identity 显示四条线均为 b0b2337 | measure（下一条换新镜像的线或用户决定换镜像后看手算是否消失；换线镜像属用户的研究选择） | hours | fixed 6a99516f0 [#1943](https://github.com/qOeOp/trade/pull/1943) |

**记为 none 的观察**

- 预检 491 下了 24 张单、0 成交，审查把 `activity: no_opportunity` 记为通过（`registration/precheck.py:31-33` 接受；`research-round/SKILL.md:50` 定义 activity 为“预检有成交”而未提 `no_opportunity`），492 带着未走过的成交后路径登记；全窗口核对未见问题。归 20261020-40（豁免只看窗口长度不看位置）。
- research-sources 04:37 才首次读，前 10 个登记都写“无外部支持、参数为探索”；作者库全文被反爬拦截，Agent 未绕过，记为只读摘要。`papers.md:70`（决定性论文向用户要 PDF）与 Goal 规则（只问阻塞）有张力，Agent 判论文非决定性。按现有指引处理。
- judgment 506–508 在用户 01:27 选线前发布：SKILL.md 说选前不发布，`recommendation.md` 说先补推荐；Agent 按引用文件做，无代价。
- 19 条判断（508、511…552 的解释与 506、524、540、554 的推荐）写着市场条件字段不可得，原因是会话缺 #1937；当前 main 上 `replay report --trial-id 488` 已给出 beta 与 alpha。归 20261031-05，账本里的旧句不改。
- `channel-breakout-15m-mid80@1` 发布后 45 s 被只改一行头注释的 @2 取代，从未运行，16 KB 留在账本；`USAGE_ERROR` 7 次、`UNKNOWN_REF` 3 次（Agent 写判断时哈希与前词粘连）、`INTERVAL_INVALID` 1 次，都是输入错误。
- 写入间隔 20.9–49.1 s（中位 25.8 s，29 个间隔），61 次只轮询的调用里 52 次空返回，约 10 min、约 14M 缓存 token；Agent 自选 1000 ms 轮询间隔，产品占多少分不开。#1933 合并在会话之后，修后延迟未测（测需写入）。归 20261025-32。
- 05:20 压缩后 2 min 内重读 9 个 skill 文件与 9 页 help（约 35k token，此后 163 次请求重发，估约 5.7M 缓存 token）。归 20261023-07 / 20261025-18。
- 证据包 `rsi-episode-permission-callback-scope-20261031` 只被后来的登记与 judgment 539 引用，从它所更正的 one-episode 登记找不到，`evidence` 也没有 list。归 20261021-23。
- 备份 manifest 停在 10-25 09:38，不含本范围的 165 个提交；DoltHub 头 06:44 与 `79nvntvq…` 一致。用户已拒 20261022-14。
- 本机 ruff、mypy（95 个文件）、compileall 通过；mypy 在 `market/remote.py:262` 提示未注解函数体不查，供给端是信任边界，可考虑 `--check-untyped-defs`。main CI quality 41178361545 成功，73 个测试模块无失败、无跳过、无 ResourceWarning 与 DeprecationWarning，其余输出均为测试有意产生。
- 文献：配对块 bootstrap 与 Ledoit & Wolf (2008)、White (2000) 一致；全搜索多重检验产品只披露不校正（Harvey, Liu & Zhu 2016），每次比较都写明，不另立项；DSR 有效试验数归 20261025-35。

**状态变化（已合并、索引仍写 in PR）**：20261029-02 → fixed 2eb09c784；20261029-04 → fixed 7455d5f73；20261029-20 → fixed ce1344218；20261029-34 → fixed d3bb52cf9；20261025-30 → fixed 61f4ed8f2；20261025-32 → fixed 290cb674c；20261031-01 → fixed 6a99516f0。本会话检出早于这些合并，均未经研究会话验证。20261031-05 的修复在本机读路径成立（上条 none 观察），不算会话验证。

## 账本保真测试

两条线的会话图由只读子代理仅凭 29 份转录与 schema 生成，账本图为 `research graph --line … --at 79nvntvq0n28t6ou9c45kkjf4php67f3`；四份 `ide.py check` 均通过，`ide.py compare LEDGER SESSION --until <会话图 scope.end>`（channel 03:15:00.484 Z，RSI 06:47:34.035 Z）：

| 线 | 本会话新版本 / 试验 | 本会话部分的度量、资格、源码、预测差异 | 其余差异 | 分类 |
|---|---|---|---|---|
| channel-breakout-15m | 6 / 10（465–474） | 0 / 0 / 0 / 0 | 10 个旧版本只在账本、18 个父版本与 19 个旧研究运行缺于会话图（会话没读到的历史）；26 个状态（会话输出从未显示状态字段）；`mid80@1` 账本 `unrun`、会话图 `superseded` | extraction miss（历史未读、状态未显示）；`mid80@1` 为 derivable |
| rsi-intraday-15m | 9 / 18（475–492） | 0 / 0 / 0 / 0 | 1 个旧版本 `persist@1` 只在账本；20 个父版本、预测与评审差异全是旧版本；8 个本会话版本的状态会话图为 null | extraction miss |

会话图里没有只出现在会话一侧的版本、运行或判断。会话里另有 14 次全窗口原生核对（子会话）与 /tmp 里的选线读数文件，未入账：前者的结论写进了解释判断，后者由推荐判断与线记录导出，按 AGENTS.md 属工作副本，记为 not a record。临时 `--market` 本地配置是宿主状态，导出内容指纹已入账且与对照一致。**本次无 ledger gap。**

## 删除清单

| 机制 | 防的风险 | 已被覆盖 | 会话所见 | 提议 |
|---|---|---|---|---|
| `registration/register.py:318` 的 `change` 与候选 `difference` 逐字节相等（`LINEAGE_MISMATCH`） | 登记写的改动说明与候选发布时声明的不一致 | `change` 可从候选取得；父版本相符仍由同一检查的另一半守 | 只因末尾换行拒一次，属仪式 | 去掉或改为取候选的值（20261031-12，authority） |
| 供给端两端比对导出器源码哈希（`market/remote.py:121-122,266-269`） | 远端用不同代码导出，使收据与 provenance 失真 | 登记与回放已记录 `export_content_sha256`，客户端按 manifest 校验每个对象的大小与 SHA-256；10-25 用户已定输入键只比内容 | 导出字节相同仍拒，迫使绕行 | 交用户定是否改比内容（20261025-11）；在此之前保留检查、改拒绝信息 |
| 导出收据的 `"seconds"` | 无（耗时诊断，无读者） | — | 让相同内容存成多份 | 去掉（20261031-11，authority） |

## 决定

无。20261031-07、20261025-11 的供给端比对、20261031-11、20261031-12 待用户决定。
