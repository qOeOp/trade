# 2026-11-12 道氏理论研究会话 b5788262 的全量审计

研究线 `dow-theory-btc-eth`（BTC/ETH 永续，新 gen-1 账本上的第一条线）。下文 `#n` 是主会话的第 n 个调用，`rv n` 是第 n 次独立源码审阅，`t n` 是试验 n，`D n` 是跟读会话留下的诊断编号。

| Item | Value |
|---|---|
| Sessions | Claude Code。主会话 `b5788262-377c-4bda-a6a3-77ae2d539260.jsonl`，2026-11-11T15:05Z–11-12T10:16Z，981 次调用，6 次自动压缩；子代理 46 个（`subagents/`，1,428 次调用）。会话期间收到三条外来消息：跟读会话应用户要求发的改用 worktree（约 03:08Z）与停止（09:47Z），会话 `local_4fecb3e2` 转述用户选择（07:49Z，与用户同时的选择一致）；之后的行为按受外来指令影响看 |
| Audit session | Claude Code，Opus 5.5，会话 `21f48906-4b37-4cc5-8771-4498377784c0`，worktree `.claude/worktrees/practical-vaughan-a7c9e3`。修复 PR：#2780（-08）、#2781（-14）、#2782（-18）、#2783（-20）、#2784（-21）、#2785（-22）、#2786（20261105-51）、#2787（20261107-02）、#2788（20261105-07）；本记录随索引一个 PR |
| Checkout / ledger | 会话起于主检出（`de32d8fe1` 起，多次快进到 `03087c999`），03:09Z 起在自己的 worktree `/tmp/research-b5788262`，`4778b6795` 至 `5fd92b88e`。审计按 `origin/main` `4997b5437` 判断。账本 `itqdelgunv14g7b89aono3fbdetjpgsn` 至 `pio1ucfkr3muki15rspcnf0ijl4jvqe5`（490 个提交，只读） |
| Coverage | 先复核跟读诊断 `/tmp/doctor-b5788262/diagnoses.md`（D1–D25，SHA-256 `3abe718f…ad14b`）；时间线 `/tmp/audit-b5788262/timeline/`（主会话与 46 个子代理）；四个全新只读子代理：Behavior and decision evidence、Data and usage cost、Product contracts and delivery 分两块（规则、skill、设计站与方法文献；代码、静态检查、残留、结构与 IDE 页面）；账本保真测试（会话图由第五个子代理只读转录生成）；两个子代理在 `4997b5437` 上重跑索引 198 个 `fixed`/`unobserved`/`in PR` 行的证明；`skill_heat.py`（1,202 个会话，本次新增 129 个）。缺口：Semantic Scholar 一直 429；配对比较的 bootstrap 与 PBO 方法未对照文献；未亲读的约 225 个拒绝码；IDE 需要 paper、agent、行情、Live 的页面；子代理推理只有转录里的部分；跟读证据目录只有诊断文件，没有原始采集（manifest 已写明） |
| Cost | 会话 19.2 h：等用户约 6.9 h（含夜间），等回放与审阅约 6.6 h，主动工作约 4.3 h，等主检出变干净 0.75 h（#2763 已修）。研究回放中位 176 s。主会话输出 0.89 M token、缓存读 237 M；子代理输出 1.40 M、缓存读 166 M。产品造成的无效试验 0（t94/t95 无效由 Agent 的加仓无止损造成，审计正确拦下）；产品把 t19/t20 错计为暴露（-13）。每次写命令同步推 DoltHub 约 11.4 s，主会话约 32 min（估算，20261025-32）。本审计约 1.5 h；七个子代理合计约 1.17 M token，主控 token unknown |
| Net change | 拒绝码 252（`shared/refusals.py` `CATALOGUE` 键；上份记录 254）。skill 词数 26,510（`.agents/skills/**/*.md` 全部 `cat \| wc -w`；上份记录 26,365，同口径）。本记录的修复：skill −58 词（删两处重复）、+3 词（预检窗口），机制 0；产品代码改一处读数（-14）、CI 的回放镜像选择不再因版本号重建（20261107-02），不加字段、不加拒绝码。授权项若全按建议：+1 个拒绝（-08 预检超 7 天）、+1 个检出检查（-10，复用验证已有的 `STALE_CHECKOUT`）、审阅项改写 3 句（-09、-11、-12），预检超 7 天“照跑后暴露”的分支被删。增长的理由写在各行 |

## 跟读诊断复核

D1–D25 在 `4997b5437` 上逐条复核，结论如下；只有经本审计自己证明的才进发现表。

| 跟读 | 复核 |
|---|---|
| D1 跨合约预热、D2 日线 bar type、D3 主体角色（首次）、D4 审阅漏因果、D10 买入持有草稿缺钩子、D11 四小时预热不够、D13 输入起点、D15 zsh、D16 空目录、D18 价格精度、D22 `LINEAGE_MISMATCH` | 同意 `none`：现有指引或拒绝足够，Agent 一次恢复 |
| D5、D8、D9、D12、D14、D3 复发、D20 | 修复 #2753、#2752、#2754、#2757、#2759、#2760、#2763 均已合入，原证明在 `4997b5437` 上不再出现，索引 20261112-01 至 -07 改 `fixed` |
| D6 本地研究备份落后 490 个提交 | 是设计：备份只在 `ledger export --kind backup` 与 `line close` 时同步，DoltHub 有全部提交。操作手册写着研究会话后刷新备份，本次没人做；不是产品发现，在决定里告诉用户。顺带发现手册把 Paper 写成没有副本（-20） |
| D7 readiness、D19 同分钟权益 | 跟读把 D19 改判 `none`（评测在新旧 skill 上都 3/3）。本审计的行为子代理按审阅简报逐条对照：通过的 17 次审阅简报都没提权益，失败的 4 次简报都点了权益，结论随简报走而不是随 skill 走。评测问题本身点了题，不能代表审阅里的真实情形。两条都改为 authority（-11、-12） |
| D17 `replay run` 重打运行参数 | 同意 `none`：两次各一次调用恢复 |
| D21、D24 预检跑满开发期 | 本审计证实，并找到 skill 里字面冲突的一句（-08） |
| D23 在旧 HEAD 上登记 | 本审计数到 2 次登记加 1 次选线写在旧 HEAD 上，都紧跟上下文压缩（-10） |
| D24 附带 `EXECUTION_CAPTURE_LIMIT` 的 `expected` 只写总上限 | `none`：消息正文同时写了两个上限，会话没被误导 |
| D25 activity 不要求改动的路径跑过 | 本审计证实，代价比跟读时更大：登记 25 整个三年没触发一次（-09） |
| 跟读 10:00Z 在研究 worktree 里跑了 `git checkout --detach` | 跟读越界一次（attach.md 的只读边界已写），研究会话已停，随即还原，无影响；`none` |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261112-08 | 预检窗口超过 7 天时产品照跑全程，跑完才在 stderr 说来源已暴露、不能首次登记；research-round 一边说“最短窗口”，一边说“每次预检、登记与回放传同样的运行参数”（`SKILL.md:65`），字面上包括窗口 | #484（03:24Z，@31/@32，t48/t49，1,096 天）与 #808（07:48Z，@54/@55，t90/t91，调用说明写着“7 天窗口”，封存撞 `EXECUTION_CAPTURE_LIMIT`）；两次 stderr 都重定向进文件、事后才读到。`replay/entry.py:459-470` 只打印；`replay precheck --help` 写“Longer prechecks still execute”。消费者：来源暴露判定（`registration/register.py` 约 405 行），四个版本永久不能登记，用户为此回答一次问题。其他转录（Claude Code 与 Codex）没有超 7 天的研究预检 | skill：那句改成“窗口之外的运行参数”（本记录 PR）；authority：超 7 天的预检在跑之前拒绝，并删掉“照跑后暴露”的分支 | minutes（约 26 min 回放、4 个版本作废、一次用户往返） | open |
| 20261112-09 | 审阅的 activity 项只要求预检有成交（`research-round/SKILL.md:59`），不要求本次改动加的或改的订单路径跑过；预检窗口照旧沿用 2023-10-20..27 | rv 40/41、44/45、47–49、51、53/56 都写明改动路径没跑，仍判 activity 通过。登记 21 的加仓没有止损，预检 t92 只有 4 张单，全程回放 t94/t95 才被审计以 `UNPROTECTED_POSITION` 判无效；登记 25 的减仓规则三年没触发（t110/t111 与对照 t105 订单逐字节相同），一次登记什么也没测。评测 `reviewer-item-meanings` Q3 编码的就是现在的含义。设计站 `strategy-file.zh.mdx:544` 写的是“覆盖这次改动所需的最短窗口”，skill 没带过来 | authority：activity 改为“预检成交了本次改动加的或改的订单路径；没有就报 unverified、换窗口或用临时账本探针”；评测在单独 PR 改 | hours（4 个试验，约 25 min 修复，登记 21、25 的结论作废） | open |
| 20261112-10 | 研究的检出新鲜度只靠 skill：`registration add`、`replay run` 只记录 `HEAD`，不核对它等于 `origin/main`、工作区干净；验证已有这道检查（`STALE_CHECKOUT`，`registration/validation.py:52-58`） | #84（15:40Z 选线，落后 4 个合并）、#123（16:07Z 登记 2）、#949（09:36Z 登记 25，`f75f7776e` 对 `5fd92b88e`）都是打印了不相等仍继续；回声式检查集中在压缩之后（#351、#638、#947/#949）。三次缺的提交都不碰研究代码，读数不受影响（#84 未逐个比对，unverified）。research-start `SKILL.md:19-26` 已写明要比较 | authority：研究登记与回放也拒绝不在 `origin/main`（本地已取回的引用，不联网）或有未提交改动的检出，复用 `STALE_CHECKOUT` | none（实测）；风险是读数记在旧提交上 | open |
| 20261112-11 | 用当分钟 `portfolio.equity` 定仓位算不算违反因果，skill 没说：`strategy-authoring.md:75-80` 要求“多少”的输入严格早于下单，`:151` 又说“按原生状态的组合权益定仓”；回放在同一时间戳先送 MARK 再送 bar | 同一写法 17 次审阅判因果通过、4 次判失败（rv 21/22 02:13Z，rv 35/36 06:14Z），失败的四次简报都点名了权益（#414、#421、#710），通过的都没点。会话自己的更正包说这是“产品问题，不在这里定”。推荐 28、38、50 在 02:16Z 更正之后仍推荐 @25 且不提此事；@25 的 t40 又是登记 8–11、16 的对照；@43/@44 以 @25 为底再次被拒 | authority：在 `strategy-authoring.md` 写明当分钟读到的权益与账户状态也是下单输入，须取自更早的事件（与字面规则和会话自己的修复一致） | minutes（两轮重发约 25 min）；推荐与对照的影响未计量 | open |
| 20261112-12 | readiness 没说“从窗口起点重建的路径相关状态机”怎样算收敛：`strategy-authoring.md:84-90` 只覆盖递归均值与固定窗口指标 | rv 7（16:27Z，@9）判通过并自己写了窗口敏感“不是 readiness 缺陷”，rv 8（16:29Z，@10，只差 SIGNAL_SCALE）判失败；更正包量出 366 天里 83–111 天决策不同。会话随后自行扩写审阅简报（rv 13/14 起），使前后 readiness 判断不可比 | authority：写一句定义（建议：两种不同预热起点得到的状态一致之后才决策；或明说窗口边缘行为属于假设而不属于 readiness，二选一由用户定） | minutes（一次失败审阅、约 15 min 的更正包） | open |
| 20261112-13 | `WARMUP_INSUFFICIENT`、`NO_ACTIVE_INSTRUMENT` 在策略看到任何数据之前就拒绝，但发生在 `stage = "replay"`（`engine/run.py:751`、`:933`），不在 `PRE_STRATEGY_STAGES`（`ledger/problems.py:28`）里，于是计为暴露与全用途试验；`replay precheck --help` 写“在 load 或 inputs 阶段、市场数据到达策略之前失败的预检不算暴露” | t19/t20（17:16Z，@13/@14 预检）`sealed_no_result` 为假（只读探针），`all_purpose_trials` 110 里多算 2；按代码推断 @13/@14 再登记会被 `SOURCE_ALREADY_EXPOSED` 拒（未验证，需写入）。会话改发 @15/@16，没撞上 | authority（改暴露计数）：建议在宿主侧把这两个拒绝码归为策略前失败，不动引擎、不换镜像 | none（实测）；试验计数多 2 | open |
| 20261112-14 | `line list --readings`（手机研究页）把推荐“维持了多少次研究运行”算错：只看未被取代的推荐判断，而推荐判断每次都取代上一条，于是总从最新一次重复推荐算起；桌面摘要（`ide/research_graph/layout.py:185-199`）走全部推荐，算对 | 活动账本 `pio1ucfk…`：手机显示“最近 43 次里 3 次未变”，桌面显示 9 次；判断 55、62 都推荐 @51。`report/graph.py:124-147`；对齐测试 `tests/report/test_graph.py:210` 只记一条推荐，测不到。消费者：用户在手机上判断线是否停滞 | fix（本记录同批 PR） | wrong output | open |
| 20261112-15 | 换思路的计数规则在这条线上分不出所比的效应：40 个网格运行可检测年化差中位 0.30（25 个 ≥ 0.20），目标是年化 20%、回撤 15%；只有 t52、t77（都更差）与 t60 被分出来；`hypothesis compare` 没有回撤比较，而登记 7–9 的改动针对的是回撤 | `research-round/SKILL.md:101-104` 只数收益区间；`feedback.md:33-36` 要求改动瞄准可检测的效应，但在可检测差 30 个点的仓位上目标够不着。用户在 00:39、02:03、04:17、06:01、07:44、09:21Z 的换思路选择跟的是运行次数而不是证据。另见 20261031-14 | measure：先在登记前报告每个改动的可检测差；是否加回撤比较、是否改计数规则由用户定 | hours（约 19 h、111 个试验，3 个被分出、无一更好；不可拆分） | open |
| 20261112-16 | 试验计数不含 Agent 的离线参数扫描：18 个 `search_exposure` 判断记了扫描（如判断 21、30），不进有效试验数 N | 有效试验数公式对照 Bailey & López de Prado 2014 附录 A.3 式 9，产品一致；Fabozzi & López de Prado 2018 及两篇 2026 年工作论文（只读摘要）都说自适应搜索使 N 偏低 | authority（研究方法）：建议 `search_exposure` 写明扫描的变体数、推荐报告合计；是否计入 N 由用户定 | unknown | open |
| 20261112-17 | 留出期只防“开着的线”：同一季度开的线共享同一留出期，关闭的线公开其留出结果，后开的线的留出期就已被看过 | 潜在：新账本还没有线关闭。Dwork et al. 2015、Bailey et al. 2016（只读摘要）支持这一担心 | authority（研究方法） | none | open |
| 20261112-18 | 两段 skill 重复别处已说的规则：`research-round/SKILL.md:78-80`（逐笔与 metrics 运行参数，重复 `strategy-authoring.md:94-104`）、`research-start/references/readiness.md:82-83`（首次回放前再查检出，重复 `research-start/SKILL.md:19-26`） | 热度：分别 78、25 个机会、0 次命中；删除测试：两处原文都在调用它们的阶段已加载，没有独有保护 | remove（本记录同批 PR，−58 词） | none | open |
| 20261112-19 | 判断正文该不该写读数，产品自相矛盾：`ledger/judgments.py:5` 与设计站（`ledger-runtime.zh.mdx:57,275` 等）说判断只引用、不抄数字，`research-round/references/review.md` 却要推荐正文按收益、回撤、Sharpe 等权衡并写出邻近常数的 Sharpe 与年化范围，`research-start/references/recommendation.md:13` 写“names … the readings it rests on”；68 条判断里 48 条带百分比 | 现在无重封，所以还没有错值；重封后判断里的数会与读数不符。AGENTS.md：同一事实只存一次 | 用户定：判断正文只引用试验与度量名，或允许写读数（改设计与 docstring） | none | open |
| 20261112-20 | 操作手册备份表把 Paper 写成“none: never published”，而服务每 300 s 同步 Paper 的本地备份（`cli/service.py:422-450`） | `docs/operator/README.md:85`（表中 Paper 行） | fix（文档） | none | open |
| 20261112-21 | `ide/README.md` 说 `/api/view` 被拒时返回拒绝 JSON，实际每次请求都回 `202 queued` 并重排一次 `research graph`（`ide/research_graph/serve.py:341-344`、`:523`）；页面读事件流，画得对 | 空账本上 5 次轮询都 202，每次约 0.42 s 一个进程 | fix（README 写实际行为） | none | open |
| 20261112-22 | `quality.yml` 两个步骤名仍写“(pyproject configuration)”，ruff、mypy 配置已移到 `ruff.toml`、`mypy.ini`（f874becbe） | `.github/workflows/quality.yml:52,54` | fix | none | open |
| 20261112-23 | 评测 `product-doctor/user-first-miss` 在 `main` 上 0/3（本审计为 #2788 跑的对照，`4997b5437`，运行器默认评判）：要么题面与现在的 product-doctor 不符，要么 skill 退化 | `claude plugin eval .agents --case user-first-miss --runs 3`，`main` 与 #2788 分支都是 0/3；三次回答没逐题复判 | measure（按 AGENTS.md 逐题复判存下的回答，再定改 skill 还是改用例，各自单独 PR） | none | open |

已有条目的新证据：

| id | 本次 | 新状态 |
|---|---|---|
| 20261025-32 | 首次拆量：每次写命令同步发布中位 11.4 s（push 9.5 s、fetch 1.9 s，70 个样本），主会话约 171 次写、约 32 min，连子代理约 64 min（估算）；服务已每 300 s 重试发布（`cli/service.py:444`）。动作从 measure 改为用户决定：写命令是否改为只本地提交、发布交给服务循环 | open |
| 20261020-38 | 审阅简报超出 skill 给的四项：会话把自己对 rv 8 的结论写进 rv 13/14 起的 readiness 项（子代理 `agent-a5989266febb17196`），权益一事随简报而变（-11） | recurred |
| 20261031-09 | 改为何时等用户、哪些试验未审阅，IDE 仍不显示：`research state` 此刻 5 个分不出的运行等于 `review_every`、3 个未审阅试验，`ide/web/src` 与 `ide/research_graph` 都不读这些字段 | open |
| 20261105-07 | 产品代码、skill、README、部署与文档已无旧“market commit”说法，只剩 12 个评测题面与 grader 文件（`.agents/evals/research-round/reviewer-reads-prices-by-command` 等，[#2788](https://github.com/qOeOp/trade/pull/2788)）；另有 15 个中文题面仍写“市场提交”，留在本行 | in PR |
| 20261105-51 | 原列各项已清；新增一处未启用规则的 `noqa`：`tests/replay/test_reproduce.py:149`（`ruff check --extend-select RUF100`，d34606ad1 加入） | recurred |
| 20261107-02 | 只改 CI 的提交已不重建；但发布提交只改版本号（`pyproject.toml`、`uv.lock` 各一行，945ec3dbf）也重建并发布了回放镜像（run 43039728936），因为两者是回放输入（`runtime-image.yml:63-67`、`replay-changed.py` 按文件比较）。下一个版本标签会让所有已过的运行落后于镜像 | recurred |
| 20261107-140 | 复核重跑（`transcribe.md:81-85`）仍没有 `USER_LANGUAGE`，用户指定语言时复核的 `DETECTED` 仍报“windows disagree”；改它就是改复核检查 | recurred |
| 20261107-143 | Live 重复 `prepare` 仍只在运行时带摘要时才比较运行时（`live/runs.py:318`），修复只做了来源一半 | recurred |
| 20261107-113 | `SCHEMA_MISMATCH` 的文字（`shared/refusals.py:50-52`）仍说换代时“同名重建”，与 `ledger/schema.sql:1-3` 的只加列规则不符 | recurred |
| 20261107-49 | `market/sources.py:278-279` 的 `workers` 仍无调用方传入；记录当时说下次改这个文件时一起删，此后没改过 | recurred |
| 20261107-102 | `LICENSE` 与 `THIRD_PARTY_NOTICES.md` 在；但 Supply 字体随 4d1ea6e43 回到 `ide/web/fonts/`，没有许可文件，声明写“all rights reserved”。字体归用户决定 | open |
| 20261029-34 | 本机又积起：117 个 worktree、216 个已并入 `origin/main` 的分支、87 个无标签镜像、11 个无用卷、约 20 GB 可回收（部分 worktree 属于还在跑的会话） | recurred |

索引其余行：`4997b5437` 上重跑 198 行的证明，早期 116 行 105 行不再出现、6 行对象已不存在（20261105-29、20261030-04、20261029-108、20261029-30、20261025-01、20261021-03）、2 行无法判定（20261105-48 要付费评测；20261025-32 见上）；后期 82 行除上表与 20261107-52（设计页已删）、20261107-113 外都不再出现。20261029-36 的根 `.dockerignore` 过滤是 #2379 有意加回的运行输入（`deploy/runtime_inputs.py:19`），原证明（两条死拒绝码）不再出现。逐行证明在审计工作目录 `/tmp/audit-b5788262/reports/index-*.md`。

## 账本保真测试

账本图（`research graph --line dow-theory-btc-eth --at pio1ucfk…`）与会话图（只读转录生成）都通过 `ide.py check`。`ide.py compare --until 2026-11-12T10:16:52Z`：候选 66 对 66、研究运行 0 缺、度量 0 差、资格 0 差、源码 0 差、推荐 8 对 8。差异只有三类：预测结果 32 处与版本状态 39 处、资格变更事件 10 处，账本可导出而会话没打印（derivable）；源码 43、职责 24、假设 4 处只在账本，是提取规则所限（extraction miss）；会话图里的有效试验数（12.417）不在格式内，由 `research counts` 导出。没有 ledger gap。

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| `research-round/SKILL.md:78-80` 运行参数一段 | 逐笔、metrics 参数忘传或乱传 | `strategy-authoring.md:94-104`，候选阶段必读 | 本会话未用，热度 0/78 | 删（-18） |
| `readiness.md:82-83` 首次回放前再查检出 | 在旧检出上回放 | `research-start/SKILL.md:19-26`（每次登记前） | 热度 0/25 | 删（-18） |
| 预检超 7 天“照跑后暴露”的分支 | 长窗口预检偷看经济结果 | 若改为事先拒绝，则由拒绝覆盖 | 两次误用烧掉 4 个版本，没有一次有意的长预检 | 由用户定（-08） |
| `LINEAGE_MISMATCH` | 同一登记的网格候选描述不同的改动，比较无法归因 | 无 | 一次触发（@33/@34 只差一个常数），Agent 拆成两次登记 | 保留：唯一的保护，触发一次代价约 2.5 min |
| `REVIEW_DUE` | 推荐长期不复核 | 无 | 两次触发（07:12、09:12Z），8 条推荐里 4 条只因它而写，都写“维持”，写在拒绝后 20–45 s | 保留：成本是一次调用；复核内容空洞是 Agent 行为，不是检查的问题 |

## Decisions

授权项与待定项（-08 至 -13、-15 至 -17、-19、20261025-32 及上表需用户定的已有条目）于 2026-11-12 一并提给用户；用户的决定记在索引的状态与动作格，本记录不再修改。
