# 2026-11-07 八个 Codex 研究线程的全量审计

用户要求开 8 个会话，各用 product-doctor 审计一个线程，由主控整理去重并记录。本记录把 8 份报告的 170 行合并成 55 个新发现和 21 个既有条目的新证据。

下文线程简称：`a9db`（视频语料与 MACD-FVG）、`ab8d`（视频组合 B）、`ab8e`（视频组合 C）、`b9df`（缠论）、`4a95`（价格行为）、`99f6`（道氏 B）、`f47d`（价格行为突破回踩）、`1313`（道氏结构）。`#N` 是该线程主会话的调用号。

| Item | Value |
|---|---|
| Sessions | Codex，全部已结束或暂停。`a9db` `rollout-2026-11-05T12-58-45-01a1a9db-…` 11-05 03:58–11-06 10:02Z，30 个子代理；`ab8d` `…T20-52-10-01a1ab8d-…` 11-05 11:52–11-06 16:59Z，46 个；`ab8e` `…T20-53-07-01a1ab8e-…` 11-05 11:53–11-06 08:08Z，22 个；`b9df` `…T01-12-55-01a1a755-b9df-…` 11-04 16:12–11-06 08:44Z，65 个；`4a95` `…T01-12-27-01a1a755-4a95-…` 11-04 16:12–11-06 17:00Z，71 个；`99f6` `…T01-12-47-01a1a755-99f6-…` 11-04 16:12–11-06 17:01Z，74 个；`f47d` `…T01-16-27-01a1a758-f47d-…` 11-04 16:16–11-06 10:23Z，64 个；`1313` `…T01-17-40-01a1a75a-1313-…` 11-04 16:17–11-06 08:43Z，81 个 |
| Audit session | Claude Code，Opus 5.5。主控 `04e8c3d1-4f26-45ca-811c-1e6dadb53764`，worktree `.claude/worktrees/doctor-20261107`，分支 `doctor/codex-eight-threads-20261107`。审计会话：a9db `572e2510`、ab8d `d50868e6`、ab8e `c77601da`、b9df `0f300445`、4a95 `a84700c8`、99f6 `dd421173`、f47d `e8d118f8`、1313 `a6018401` |
| Checkout / ledger | 8 个会话固定在 `b06f1a68c`；主控写前在 `3e6a6cb03` 上复核。两者之差不碰 `ledger/`、`report/`、`replay/`、`registration/`、`engine/`、`ide/`、`market/` 和 research-round，只碰部署、`paper/serve.py`、`cli/main.py` 两行和 `readiness.md`。线程起点 `c0e0c01ba` 或 `922199f68`。账本读到 `ic7kgug8h6rrad7r90780ud1p720d34d`（11-06 17:00Z）；各线程提交范围见 `/tmp/doctor-20261107/reports/` |
| Coverage | 每个线程：Behavior and decision evidence、Data and usage cost、触及的 contracts。全产品切片各分一块：a9db 研究方法文献；ab8d Skills；ab8e Code 与部署分发；b9df Design；4a95 Human use；99f6 Residue（基线 `987649db3`）；f47d 拒绝、审计、闸门和 skill 规则；1313 全账本读数。缺口：账本物理增长和活动卷未测；账本保真测试未做；IDE 未看渲染；子代理 brief 加密；未逐份读策略源码（每线程 1–4 份） |
| Cost | 见下表。产品造成的无效 trial：8 个线程都是 0。审计：每会话约 25–35 min；8 组子代理合计约 7.7 M token；各主会话与主控 token unknown |
| Net change | 拒绝码 254（上份记录 257，`ledger/refusals.py` 的 `CATALOGUE` 键）。skill 词数 26,365（上份记录 27,732，同口径）。提议：新增拒绝码 0，新增存储字段 0；机制 0，只有 20261107-23 在用户保留换线规则时 +1 个只读提示。skill 约净 +150 词（估算：约 +280，−130），选 20261107-04 的方案 B 则再约 −110 词。增长的理由：多数是把 Agent 现在要猜的规则说全，每条说明在发现行里 |

| 线程 | 跨度 | 主会话 token（缓存占比约 99%；未缓存 + 输出） | 子代理 token | 复现次数 | 镜像迁移窗口（含其他工作） | 等用户 |
|---|---|---|---|---|---|---|
| a9db | 30.1 h | 462 M；7.5 M | 63 M | 11 | 50.5 min | 11.3 h（含夜间） |
| ab8d | 29.1 h | 652 M；未单列 | 117 M | 134 | 204.6 min | 12.8 min（另用量上限 187 min） |
| ab8e | 20.2 h | 284 M；3.1 M | 44 M | 18 | 21.9 min | 8.7 h |
| b9df | 40.5 h | 668 M；7.5 M | 122 M | 0（目标写死旧镜像） | 0 | 11.5 h |
| 4a95 | 48.8 h | 835 M；8.1 M | 128 M | 261 | 5.41 h | 5.5 h |
| 99f6 | 48.8 h | 638 M；6.6 M | 123 M | 248 | 5.55 h | 12.3 h |
| f47d | 42.1 h | 668 M；7.2 M | 109 M | 173 | 4.32 h | 9.4 h |
| 1313 | 40.4 h | 617 M；6.9 M | 146 M | 98 | 2.73 h | 13.2 h |

时间线末行的 `tokens_sum` 重复计了 `token_count` 事件，上表取各报告校正后的累计。时间分类多为估算。

## 事件

- **凭据进入审计转录。** f47d 的 Data 子代理找备份时打印了 `~/.local/share/trade/dolt/service.json`，本地 Dolt `research_writer`、`research_reader` 的密码进入该子代理转录。4a95 的 Human use 子代理 GET IDE 首页，页面的 `trade-paper-token` meta 标签进入转录。两者都未使用、未复述；报告和本记录不含值。两次都违反 AGENTS.md 的凭据规定。见 20261107-45。
- **超出 brief 的读取。** 4a95 放行子代理对运行中 IDE（127.0.0.1:8765）的约 15 次 GET，无写入，每次触发一次图计算。
- **审计也移动了镜像 tag。** `research state` 读时 `docker pull` main（20261107-16），多个审计会话和主控都运行过；只影响本地 tag，不写账本。
- **挂起的宿主进程。** 99f6 暂停时留下 PID 95669（`migrate-image374.py`，状态 T）。若被恢复会继续写活动账本。本批未动，见“决定”。

## Findings

同一原因和补救合并为一行。“线程”列出报告它的会话。行号在 `3e6a6cb03` 上有效。来源都是 doctor，除 20261107-30。

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261107-01 | **每个新镜像摘要都要求先重放线上全部已通过运行，排在线上任何事之前，且工作量随线长增长；代码只要求对照可比** | **线程** a9db-4、ab8d-1、ab8e-3、f47d-1、4a95-1、99f6-1、1313-1。**会话**：7 个线程 943 次复现，打印的 `tables_differing` 全空，0 次因结果不同失败；两次失败都是镜像缺失（20261107-18）。1313 的全账本窗口 942/1,783 个 trial（52.8%）是复现。5d44 迁到一半被 3740 作废（ab8d 34 次、4a95 45 次、99f6 36 次）。99f6 结束时落后 50 个，新候选卡在迁移之后；4a95 16:06 起候选冻结。**产品**：`research-start/SKILL.md:44`、`changes.md:10`；`report/status.py:554-562` 只列出不进 gates；`registration/comparability.py:68-77` 接受对照的任一复现身份。设计站写的是窄版本：`docs/rd/comparison.zh.mdx:113`“先重放推荐候选和它的对照”，与 skill 矛盾。**消费者**：研究 Agent 每次停下迁移，没有任何决定因复现结果改变；选线选项里“先迁移 N 个”抬高换线成本（99f6 #1418、f47d）。**保护**：11-04 干跑 182 个有 12 个不同，复现不能删。动作：按风险重述为“比较或推荐要读的运行，读之前先移动”，机制 0，skill 约 ±15 词。取舍：未移动的运行退出比较表（`review.md:16`） | authority + skill | hours（7 线程迁移窗口合计约 22.6 h，含窗口内其他工作、彼此并行；全账本约 7.5–10.5 h 回放，估算） | open |
| 20261107-02 | **镜像工作流在只改 CI 或工具配置的提交上也重建，修订标签使摘要变化，触发 20261107-01** | **线程** f47d-2、99f6-2、1313-1、4a95-1、ab8d-1。**会话**：`aacad3b91`（只改 CI 脚本）、`e82c73f10`（工作流、发布脚本和 README）、`4dd9ccaff`（`pyproject.toml` +5 行 ruff 配置）；1313 算全账本这 3 轮 381 次复现约 3.9 h，4a95 本线 115 次约 143 min，99f6 本线 103 次、可避上限 67 次（`e82c73f10` 新增 amd64，清单摘要可能仍变）。**产品**：`.github/workflows/runtime-image.yml:11-19,116`，`engine/runtime/Dockerfile`。**分歧**：`c4853abb6`、`dc49edba7` 只动 paper、live 和 `engine/config.py` 文案，也换摘要；拆镜像是新机制（ab8e A2），ab8d 提议改判据比 `source_files_sha256`。都先不做，等这行和 -01 落地后再量。动作：CI 脚本改动继续跑检查，不移动 `main` 标签；`pyproject.toml` 须先证明依赖变化总落到 `uv.lock`。路径 −3 至 −5 行，不碰拒绝 | fix | hours | open |
| 20261107-03 | **用户选“继续”后换线计数不重算，下一次分不出的运行立刻再问；规则没写，同一 Agent 用过两种读法** | **线程** 8 个全部：a9db-1、ab8d-5、ab8e-1、f47d-4、4a95-11、99f6-4、1313-8、b9df-1。**会话**：ab8e 13 次提问 12 次答继续，26 个空转回合；b9df 15 次，其中 7 次只隔一次运行；99f6 8 次都选继续，末三次各隔 1 个；a9db 四次“继续”各只换到一个试验。读法分歧：f47d #754“从这次选择后开始”对 #1742“历史仍保留”；1313 #188 对 #1544。b9df 把字面读法写进推荐 1324。ab8d 第一次提问用户否决了 Agent 的推荐，提问有用，后两次 14 秒、11 秒答复。**产品**：`research-round/SKILL.md:111-117`，`docs/rd/feedback.zh.mdx:271`，无对应用例。**消费者**：用户逐次审批。动作：从“最近一次区间排除零”和“用户最近一次选线”的较晚者之后数 `review_every` 个。机制 0，约 +10 词，+1 用例 | authority + skill | hours（ab8e 结果到停止 226.6 min、估算约 170 min 可归因；b9df 7 段合 299 min 含研究；多数用户等待在夜间） | open |
| 20261107-04 | **换线规则分不开被比较的效应：只看任一区间是否排除零，不看方向和目标差，边界全由 Agent 当场定** | **线程** a9db-2、ab8d-2、ab8e-10、f47d-3、4a95-4、1313-9、b9df-3、b9df-4、99f6-4。**分辨力**：可检测差中位 f47d 25.2 pp（大于 20% 年化目标）、99f6 6.9 pp、b9df 6.56 pp；b9df 54 次比较 3 次排除零，99f6 ≥52/54、ab8d 36/40 观察差小于可检测差。模拟（独立假设）：无真实差与 2 pp 都约 7–17 次到期。**方向**：更差也清零：4a95 本线 13 次更差，用户选择后 45 个运行、32h45m 无提问；1313 5 次；99f6 风险 2%→1.5%、年化差 −7.71 打断计数。**贴零**：百分位年化区间下界 +3e-6（ab8d #1715 清掉 7 连；ab8e 1177），`report/comparison.py:202` 对 `:211`。去掉它 ab8d 首次到期早约 9.5 h（反事实）。**边界**：日收益全同（a9db 1878、1893）、修复重跑（b9df 757/798）、10 次空学生化区间、算不出的比较。**产品**：`research-round/SKILL.md:111-114`。任一区间规则是用户 11-01 批准的。选项：A 保留并写明只数三区间都可读的比较、更差不清零；B 删除这条停止（机制 −1，skill 约 −110 词，用例 −6，`REVIEW_DUE` 和用户随时可停仍在，20261022-10 那种 41 版不回头的风险要另看）；C 按目标差距重述（新设计）。可先做只读重算：用各线已有 compare 结果算各选项的提问点，不需授权 | authority + measure | hours（经 -03 支付；未证明错误结果） | open |
| 20261107-05 | **只放大名义上限时配对差几乎是对照日收益的固定倍数，统计量退化成对照自身的 t，却计入换线计数并被当成规模证据转述** | **线程** b9df-2，主控用 `run_return` 复算：1466→1513 差值 t 1.5287、对照 t 1.5191、相关 0.9968；1513→1888 1.5285、1.5216、0.9956；606→610 1.1974、1.1971、1.0000；非仓位步 1423→1466 相关 −0.2335。用户读到“相对125000上限的优势仍不确定”（b9df `main.md:49029`）。**产品**：`feedback.md:23` 要按目标读仓位步，与 `SKILL.md:111-117` 冲突，后者无豁免；`report/comparison.py:190,196` 不提示。动作：规模步不计入窗口，skill 说明同路径放大时配对区间不评价规模。比较代码算得对，不改。约 +30 词，+1 用例 | authority + skill | wrong output（对规模的解读）；提问代价计入 -03 | open |
| 20261107-06 | **所有写都改 `ledger_head`，并行线下冲突是常态，只有封存类写自动重试** | **线程** 8 个全部：a9db-7、ab8d-3、ab8e-5、f47d-5、4a95-3、99f6-3、1313-2、b9df-5。**会话**：每线程 13–46 次，f47d 普查 8 线程 255 次；Agent 自写守护重试脚本，99f6 恢复脚本用 19 次；1313 7 次打断复现队列 19 m 15 s；未丢数据。**产品**：`ledger/db.py:65,772-785`；`attempts=` 只在 `ledger/execution.py:457`、`ledger/trials.py:313,366`、`paper/inputs.py:54`；重试在新头上重跑全部检查。2026-10-30 记录写“等复发再议”，未进索引。**分歧**：f47d、b9df 提议全部写默认重试；ab8d、1313 只给 `open_trial`、`register`，判断保留拒绝（拒绝文本要求重读）。主控建议：先 `open_trial` 和 `register`，判断待 -08 落地后看残留。机制 0，分支 0 | authority + fix | hours（估算：99f6 约 29 M token；ab8d 可追踪 24.7 min 实测；b9df 上界 47 min） | open |
| 20261107-07 | **`CONCURRENT_WRITE` 说“重跑同一命令，幂等”，回放类命令照做撞 `PATH_EXISTS`** | **线程** a9db-8、ab8e-5、4a95-3、99f6-3、1313-12。**会话**：a9db #897→#904、ab8e #215→#222、99f6 #585、4a95 #2285 后 7 min 专项诊断。**产品**：`ledger/refusals.py:81-83`；`replay/entry.py:439-443`、`replay/reproduce.py:93-98` 先建目录再开 trial。动作：改文字写明换新 `--output`；-06 落地后只剩罕见竞争。拒绝条件不变 | fix | minutes | open |
| 20261107-08 | **`judgment add --kind recommendation` 把全量比较表放在写事务内算，窗口内常被其他提交撞掉** | **线程** ab8e-2、a9db-7；b9df 08:25–08:36 4 次 931 s 同形。**会话**：ab8e 33–34 次冲突 22–24 次在此，7 个重试脚本；a9db #1924-1938 11.4 min。**产品**：`ledger/judgments.py:99-102`，`report/status.py:447-451` 在事务内另开 `read_as_of`，结果只由固定 commit 决定。动作：调用移到 `db.write` 之前，`RECOMMENDATION_INCOMPLETE` 语义不变，消除比例未测 | fix | minutes（20–27 min 实测） | open |
| 20261107-09 | **`research state`、`research status` 不分线读全账本 explore 和 coverage，逐对比身份，耗时随复现数增长** | **线程** a9db-17、ab8d-8、ab8e-4、f47d-13、4a95-12、99f6-7、1313-6、b9df-7。**实测**：`research state --line` 一次 18,856 条 SQL、20.5 s（b9df）；线上 14 个运行 6.85 s、55 个 37–47 s（99f6）；`research status` 75–83 s。线程读 88–199 次，常写文件再取字段；每次等待是一个全上下文轮次。**产品**：`report/status.py:60-108,170-200`，`ledger/reproduction.py:82-104`。动作：判定不变，先按线和当前摘要筛候选，批量读 | fix | minutes，随 -01 增长（上限估算 58 min–2.6 h，多与模型时间并行） | open |
| 20261107-10 | **两项目标都达到不是停点，验证没有入口** | **线程** 4a95-2、f47d-11。**会话**：4a95 trial 1093 首次达标后 29h54m、41 个运行没问用户，只在进度消息提一句；f47d 725 达标后又 39 个 trial，7 份选项写“尚未独立验证”，没有一份说何时能验。**产品**：`research-round/SKILL.md:162-164` 的条件是“用户接受候选”，无选项、命令或记录表示接受。不改“只由用户发起”。动作：推荐达标时说一次验证由用户发起及其窗口；问还是只告知由用户定。约 +25 词，+1 用例 | skill（告知或询问由用户定） | hours（经过时间；用户可能本就想继续，是否浪费未证明） | open |
| 20261107-11 | **“达到目标”到人面前只是单路径点估计，开发报告不给年化区间** | **线程** a9db-5、f47d-9。**复算**：a9db trial 1501 用产品 `single`：年化点值 21.24%，折年区间约 [−2.6%, +45.0%]。f47d 725 区间 [−12.8%, +67.9%]（子代理）。**产品**：`report/comparison.py:223` 只由验证报告用；`recommendation.md:7`。规范：Lo 2002、Harvey & Liu 2015（摘要）。动作：`replay report` 读时给区间，不存字段、不是门槛，目标不动 | fix | unknown | open |
| 20261107-12 | **多重检验读数到不了读者：要求给试验数和“判断不抄计数”两句相撞** | **线程** ab8d-4、f47d-10、b9df-10。**会话**：ab8d 13 条推荐 0 条写数字；f47d 106 条判断 0 条提 DSR；b9df 数字只在 `/tmp`。**产品**：`research-round/SKILL.md:125` 对 `:138`；`templates/report.md`、`recommendation.md` 无此项。规范：White 2000、Bailey & López de Prado 2014。动作：给用户的文字必须写 research、effective、all-purpose 三个数，`:138` 明确例外。约 +15–30 词 | skill | unknown | open |
| 20261107-13 | **DSR 输入分不开任何运行，产品也没有“搜索后最佳者”的检验** | **线程** a9db-6、b9df-17、b9df-18。**读数**：N 484–1181，V 0.00649，门槛年化 4.68–5.08，全账本最高约 2.65；trial 1501 DSR 1e-7、1888 1.2e-9。子代理：同窗口方差约 9e-4；b9df 49 个运行 SPA p≈.93、RC p≈.18（未校准）。**产品**：`report/status.py:317-371`。用户 10-31 定的 N 口径不动。动作：先量同窗口总体上的 SPA 读数是否校准，再判 `mean_correlation`、`effective_trials`、`daily_sharpe_variance` 去留；是否算信任边界由用户定 | measure | unknown | open |
| 20261107-14 | **来源审查是最大的强制 token 开销，保护价值测不出，没有阳性对照** | **线程** a9db-16、ab8d-11、99f6-6、ab8e 删除清单、f47d-14、4a95 删除清单。**会话**：a9db 0/25 改变源码，占未缓存 25.4%；ab8d 46 次占 `tokensUsed` 38%，1 个真实缺陷；99f6 59/59 通过；4a95 1 个（1362）；1313 943 抓到真预热缺陷；全库 629 份 44 份含 failed。**不提议删除**，是信任边界。动作：种入 api 与因果缺陷量一次检出率 | measure | hours（实测 token，价值未量） | open |
| 20261107-15 | **`changes.md` 要当前镜像摘要，没有任何输出给出它** | **线程** f47d-19、4a95-9、99f6-11、1313-7。**会话**：8 线程无效名词 `runtime` 21 次（f47d 普查）；4a95 #3089；1313 #1957 起 15 次 import 内部函数。**产品**：`changes.md:11`，`cli/main.py:697-704` 算出后只传给 `_behind`。动作：`research state` 输出只读键 `current_image`，不存储；1313 的备选是 skill 写 `:main` 标签（`runtime/image.py` 接受标签，未跑） | fix | minutes | open |
| 20261107-16 | **`research state` 每次读都 `docker pull` main，help 写 “nothing”，doctor 也把它当只读** | **线程** ab8d-7，主控复核。**产品**：`cli/main.py:697-704`、`runtime/image.py` 的 `resolve`、help `cli/main.py:1339`。本地 tag 随读移动，旧镜像变成无 tag；线程都在一轮中途发现新镜像。动作：help 写明；是否保留随 -01 一起定 | fix | unknown | open |
| 20261107-17 | **`SOURCE_ALREADY_EXPOSED` 的 next action 叫人在新镜像重做预检，豁免却只给被引用的那个；没有 `retry_of` 的候选走这条路就登记不了** | **线程** 99f6-9、f47d-22。**会话**：99f6 #2438–#2461 候选放弃、回放未跑（18 min）；f47d #2182–#2379 `highvolume@1` 放弃，拒绝由代码推得。正确路径见 99f6 #701。**产品**：`ledger/refusals.py:383-389`，`registration/precheck.py:69-80`，`changes.md` 无指引。判定有用，不放宽。动作：改文字，skill 一句“在预检自身镜像登记再复现”。约 +20 词 | fix + skill | minutes，加 2 个放弃的候选 | open |
| 20261107-18 | **会话用过的镜像不在本机，原因未查明** | **线程** ab8d-6、99f6-10；f47d 遇 5c99（`main.md:20042`）。主控 11-07 查：`5d44e182…`、`374033…` 都 `No such image`，其余 17 个 trade-runtime 镜像在。`docker events` 72 h 无 delete、untag 事件（事件缓冲可能不全）。转录无 prune、rmi。AGENTS.md 把删除保留镜像列为需授权。后果：trial 2476、2478 复现失败且计入 `all_purpose_trials`。动作：查 Docker Desktop 的回收和 `docker pull` 的 tag 移动 | measure | minutes | open |
| 20261107-19 | **研究图和 IDE 只读基本区间，与三区间规则相反地显示“Crosses zero”** | **线程** f47d-6，主控复核。推荐 1411 基本下界 −4.3e-7，学生化 [+1.4e-5, +1.6e-4]、年化 [+0.2, +6.4]，Agent 判分得出，人看到红色 Crosses zero；1267、1439、1528 同样。**产品**：`report/graph.py:105-106`，`Detail.tsx:76-77`。#2005 改了 skill，这里没跟（20261101-06 的漏网消费者）。未观察到用户因此决定 | fix | wrong output | open |
| 20261107-20 | **IDE “Picked from” 用本线运行数，提示却说它是挑选范围，小约 10 倍** | **线程** f47d-7，主控复核。本线 56，`research_trials` 546，`effective_trials` 484。**产品**：`ide/research_graph/layout.py:196`，`Recommendation.tsx:35`；`research-round/SKILL.md:125` 规定所有线。**消费者**：人读过拟合风险 | fix | wrong output（低估） | open |
| 20261107-21 | **`minimum_effect` 必填，没有判断读它，单位也不统一** | **线程** a9db-12、b9df-16、1313-16，ab8d、f47d 删除清单。**全账本**（531 个登记）：0.0 共 396，0.02 共 55，5e-05 共 35，0.01 共 24，0.002 共 21，疑似混用年化和日对数；`comparison.py` 注释说单位是年化差。**产品**：`registration/register.py:38,186-188`，`report/comparison.py:215,268` 只回显。选项：A 写明单位和用法（skill 约 +20 词）；B 不再必填，放松 `REGISTRATION_INVALID`。旧行不动 | authority | none（潜在误读）；一个单位更正包（1313 #76） | open |
| 20261107-22 | **正文超 TEXT 上限时，拒绝截掉真因并让 Agent 原样重跑** | **线程** a9db-9、f47d-15、1313-15。**会话**：a9db #1498（71,883 B）、#1919（187,955 B），都靠读 schema 才改对，约 9 min。**产品**：`ledger/db.py:727-753` 只留错误前 300 字符，`ledger/refusals.py:84-85`，`schema.sql:187`，`judgment add --help` 不写上限。动作：保留错误尾部，按错误号给建议，help 写上限。不加长度检查，拒绝条件不变 | fix | minutes | open |
| 20261107-23 | **换线到期只能由 Agent 自己算，`research state` 的 gates 看不到** | **线程** f47d-8、4a95-11；ab8d `read-undistinguished-streak.py` 15 次；b9df 自写脚本曾算错（`main.md:13797`）；4a95 把计数放在 `/tmp`，329 次调用碰过。f47d #2716 同时断言 `other_actionable_gates: []` 并标 blocked。**产品**：`report/status.py:654`，`cli/main.py:1346-1349`。若规则保留：读时派生提示，只报不拒，字段 0，skill 约 −35 词。依赖 -03、-04 | authority + fix | minutes | open |
| 20261107-24 | **用户恢复 Goal 而未回答选线问题时，规则没说算不算选择** | **线程** a9db-10、b9df-8；1313 判 none（目标文本写着 A）。**会话**：a9db 00:30:01“视为继续 A”后 trial 1407 成为 A2 起点，16:34 同样事件却询问；b9df 00:30:15 后跑了 1405。两例都记入曝露，用户事后未反对。**产品**：`research-start/SKILL.md:85,113`。动作：恢复而未回答时复述一次并等待。若算收紧停止规则先问用户。约 +15 词 | skill | minutes | open |
| 20261107-25 | **Agent 告诉用户“选择即批准对应试验”，规则没有这句，线内实验变成逐个审批** | **线程** b9df-9。第 8–15 次提问都如此。**产品**：`research-start/SKILL.md:102`，`research-round/SKILL.md:7-9`。动作：选线不批准也不限制某个实验。约 +15 词 | skill | unknown | open |
| 20261107-26 | **Agent 自提的仓位值经用户转述后被当成用户约束** | **线程** 1313-5。#331 选项 A 自提“共同预算因子 3”，用户回“保持 3”，此后判断写 “user-selected”，最后 40 余次试验没有再排序仓位。**产品**：`AGENTS.md:35`，`research-start/SKILL.md:95`，`feedback.md:21`。不评价仓位该不该改。约 +15 词 | skill | unknown | open |
| 20261107-27 | **Goal 目标写死运行身份和“迁移是第一步”优先级未定，修复到不了回放** | **线程** b9df-12。证据包写目标固定 a46，选项带“保留a46”，用户选 A；`runs_behind_image` 50，`gates` 空。**产品**：`research-start/SKILL.md:44,98-100`。约 +10 词。与 -01 同一 PR 决定 | skill | unknown | open |
| 20261107-28 | **未写入的瞬时冲突被 Agent 逐个归档进公开账本** | **线程** f47d-18、99f6-3、4a95-3、1313-2。f47d 17 个包 107,345 字节，其中一个误带 74 KB 派生状态再用自由文本更正；99f6 17–19 个；4a95 约 21 个（按名称）。无消费者。**产品**：`AGENTS.md:60-61` 的 “failure logs” 没排除。动作：一句“未写入的瞬时冲突不算”，已发布的不动；-06 落地后大部分自动消失 | skill | minutes（计入 -06） | open |
| 20261107-29 | **第三方视频完整转写进入公开账本** | **线程** a9db-19（子代理查询）：`bilibili-BV17VGGzjEdT/transcript.json` 271,253 B，`BV1PG3g6NEZw` 175,456 B。AGENTS.md 允许存来源原件，账本又是公开的。授权问题未核。选项：今后只存摘录和哈希，已发布的不改写；或维持 | authority | none | open |
| 20261107-30 | **同线分叉和不同线的经验没有提炼、跨线检索和用于下一假设的路径** | **线程** a9db-18。用户 11-06 08:52、09:55、10:04 提出，Behavior and decision evidence 应先查出。`report/status.py` 跨线比较有，判断跨线读取和假设入口没有。设计在线程 `01a1ab2c-d7bf-7903-9fde-fda81ad2937d`，主检出有未跟踪的 `docs/plans/cross-line-research-experience.zh.md`。本批不重复设计 | none（设计进行中） | unknown | open |
| 20261107-31 | **研究 skill 不把用户带到任何视图，选项只能信 Agent** | **线程** 4a95-6。823 条消息 0 条指向 IDE，13 条链接 `/tmp`。深链已有（`ide/web/src/lib/lines.ts:1-16`）。规范：Nielsen “Help and documentation”。`recommendation.md` 约 +20 词，+1 用例 | skill | unknown | open |
| 20261107-32 | **⌘K 搜不到 trial，而 skill 要求对用户用 trial id** | **线程** 4a95-7。`ide/web/src/shell/CommandPalette.tsx:49` value 只有 version id 和 change；`research-round/SKILL.md:137-141`。约 +1 行 | fix | unknown | open |
| 20261107-33 | **IDE Agent 工具输出 20k 字符从头截断，`gates` 在输出末尾，模型读不到** | **线程** 4a95-8。本线紧凑 110,037 字符，`gates` 在 109,877；15 条线 14 条如此（子代理）。`ide/agent/src/tools.ts:14`，`chat.ts:27`，`report/status.py:651-656`。20261029-118 判 none 时没算到这个后果。模型实际反应未测。动作：调键序 | fix | unknown | open |
| 20261107-34 | **买入持有参考每换镜像重跑一次，值一字不差** | **线程** 1313-13。trial 833、955、#850、1876 年化都是 `-0.14569359852151598`。`research-round/SKILL.md:128` 没说可复用。约 +8 词 | skill | minutes | open |
| 20261107-35 | **不带 `--line` 的 `research state` 无条件带全部候选** | **线程** 1313-14。15 条线时 32.3 s、1,028,162 字节，`facts.candidates` 占 83%。`report/status.py:604-625`，`research-start/SKILL.md:24`。先核对 research-start 是否依赖它 | fix | minutes | open |
| 20261107-36 | **trial、registration 目标只有 `about` 合法却必须写 role** | **线程** f47d-17。8 线程 `SUBJECT_ROLE_MISMATCH` 6 次，相关 `USAGE_ERROR` 13 次。`ledger/judgments.py:21-37`。放宽拒绝，需授权。分支 −1 | authority | minutes | open |
| 20261107-37 | **`strategy-authoring.md` 推荐 GTD，bars 回放下到期确认晚一根 bar，文字没说** | **线程** b9df-14。trial 757 过审后自查，修复 limit-entry@3、trial 798，读数不变。`strategy-authoring.md:53,115,118`。约 +20 词，改前用原生探针复核 | skill | minutes（20.1 min 实测） | open |
| 20261107-38 | **可检测差按单侧 alpha 算，换线规则看双侧区间，说明也没讲它随仓位缩放** | **线程** b9df-15。`report/comparison.py:190,196`，双侧把握约 70%（正态近似）；`research-start/SKILL.md:81`；`comparison.zh.mdx:367-369` 已说明。改公式会动封存读数，不做。约 +25 词，help 一处 | skill | none | open |
| 20261107-39 | **`--universe pool` 和 `universe_rule` 仍读作每个合格合约，实际是部署配置的手选名单** | **线程** a9db-13。`cli/main.py:2088`，`market/README.md:239`，`deploy/compose.yaml:105-108`，`research-start/SKILL.md:76`；#2131 的说明只注在 basket 度量上（20261105-18 未覆盖的消费者）。全账本单合约，未触发。约 +20 词 | skill + fix | wrong output（潜在） | open |
| 20261107-40 | **验证窗口的预留只按完全相同的源码，窗口长度的建议不按统计长度** | **线程** a9db-14、a9db-15。`ledger/trials.py:39-50`，`validation.md:29`。账本 validation 登记 0。规范：Nosek 2018（摘要）、Bailey & López de Prado 2012 §4。动作：`validation report` 读时披露登记后到绑定前的 trial；换一个短语。扩大拒绝不推荐 | fix + skill | none | open |
| 20261107-41 | **`research-start/SKILL.md:103-104` 让 Claude Code 用 `/loop`，要的语义是 `/goal`** | **线程** ab8d-13，主控复核文字。https://code.claude.com/docs/en/goal 。`2026-11-06-no-approval-pressure.zh.md:59` 记 2 条评测败在这句。未观察到 Claude Code 上的研究会话。净 0 词，判据另开 PR | skill | unknown | open |
| 20261107-42 | **`ratios.md:3-7` 要求 365 天年化但没给参数，rc7 默认 252，“或说明差异”给了错算出口** | **线程** ab8d-14。同序列 Sharpe 6.93 对 8.34。`engine/report.py:174` 用 365。线程 4 次都写对。+4 词 | skill | none | open |
| 20261107-43 | **skill 文字小问题一批** | **线程** ab8d-15、-17、-18、-19，ab8e-12。`fidelity.md:30-31` 权限归属；`capital.md:30-41` 对 `research-round/SKILL.md:98`（约 −60 词）；`:80,89` “the diagnostics”；`--line BUNDLE` 对 `LINE`、pilot、borrow、“retired service” 等术语；`SKILL.md:74-91` 条件内容移到 `strategy-authoring.md`（入口约 −200 词，总词约 0）。全部规范检查（500 行、第三人称、引用层级）通过 | skill | none | open |
| 20261107-44 | **research-start 描述 125 词，占启动描述 28%，约一半复述流程** | **线程** ab8d-20。https://code.claude.com/docs/en/skills 。无触发用例（20261105-44）。先加触发用例再删，约 −55 词 | measure | none | open |
| 20261107-45 | **doctor 的只读边界没说哪些文件和页面带凭据，且清单与 `fidelity.md` 不一致** | **本批事件**（见上）；ab8d-16。`~/.local/share/trade/dolt/service.json` 有账本密码，IDE 首页有 paper token（`ide/research_graph/serve.py:398`）。备份身份 `ledger review` 已给出，不需要读文件。`product-doctor/SKILL.md:14-16` 不含 `research graph`，`fidelity.md:7` 要跑。约 +20 词，改 doctor 边界 | authority | none（凭据未使用） | open |
| 20261107-46 | **`remote-paper-auth` 的路径过滤漏掉它读的文件，公共端口检查可能不跑** | **线程** ab8e-13，主控在头上复核。`remote-paper-auth.yml:5,8` 无 `deploy/compose.yaml`、`deploy/Dockerfile`、`deploy/paper_*.py`；`check-remote-deploy.py` 读 base compose。历史相关提交都同时改了 remote 文件。改的是安全检查触发条件 | authority | none（预期风险） | open |
| 20261107-47 | **CI 小项** | **线程** ab8e-14、-16、-19、-20。部署 CI 的 “Ubuntu system Python” 是 24.04，主机 26.04.1；docs-site 读 `ide/web/fonts`，`docs-pages.yml` 过滤不看；`runtime-image.yml:135,192` artifact v4 触发 Node 20 警告；mypy 唯一输出 `market/aggtrades.py:166`（此文件在导出器哈希内，见 20261105-53）。ruff、mypy 其余全干净，CI 日志逐条有因 | fix | none | open |
| 20261107-48 | **远程部署文档缺主机文件定义和发布面** | **线程** ab8e-17、-18。`install-release.sh:16-21` 用 `/etc/trade/remote.env`、`images.json`、`/opt/trade-app`，文档写 `deploy/remote/.env`；`deploy/remote/README.md:44` 接纳 arm64，发布面只有 amd64。低优先 | fix | unknown | open |
| 20261107-49 | **移除后留下无消费者的代码** | **线程** 99f6-13、-17。`paper/runs.py:161` `killed_before`、`paper/serve.py:211` `self.started`（c4853abb6 后）；`market/sources.py:210,278-279` 的 `workers`（在导出器哈希内，等下次改动）。约 −13 行，−2 参数 | remove | none | open |
| 20261107-50 | **移除后留下的文字** | **线程** 99f6-14、-15、-16，1313-20。`tests/paper/test_serve.py:1-6`、`design-code-cli(.zh).mdx` 第 2 项；`design-code-engine(.zh).mdx` 的 `compare_runs`；`appendix-open.zh.mdx:72`；`ledger/schema.sql:1-3`、`AGENTS.md` 未列 cycles、`metrics_revision` 含义 | fix | none | open |
| 20261107-51 | **live、paper resume、远程部署、`ledger mirror`/`sync` 落地时都没改设计站** | **线程** b9df-22，主控复核：`docs/rd` 中 `live preflight`、`engine/live`、`live/runs` 0 个文件。`platform-architecture.zh.mdx:9` 仍说一份 compose 是全部部署；96 模块 33 个无章节。消费者：把站点当 Blueprint 的人。不补函数目录，平台页加 3 小节，约 +40 行 | fix | none | open |
| 20261107-52 | **skill 设计页没人同步** | **线程** b9df-24。`design-skill-nautilus-report-analysis.zh.mdx:45,48` 对 `capital.md:5-10`；`design-skill-product-doctor.zh.mdx:86` 写已删 skill；video 页对 `assets/env.sh:10-11`；sources 页缺 Coinalyze、CryptoHFTData。约 ±30 行 | fix | none | open |
| 20261107-53 | **`docs/index.zh.mdx:7` 承诺每个函数、表、skill 节与 eval 逐条写全，无机制维持** | **线程** b9df-26。33/96 模块无章节，47/185 用例不在页面。改承诺比补全便宜。约 0 | fix | none | open |
| 20261107-54 | **`docs/rd/map.json` 是手工第二份标题** | **线程** b9df-27（未自查）。第 4 层 61/230 个与章节不同。构建时从章节读，减 256 个字符串，加约 5 行 | fix | none | open |
| 20261107-55 | **#2159 没处理 19 个带少量英文标签的文档副本** | **线程** b9df-25（未自查，主控核到非 zh mdx 23 个）。983 KB、14,291 行；325 个英文页链接跳中文路由。20261105-32 判“有真译句，留着”，实测不支持。净减约 14,300 行 | fix | none | open |

### 既有条目的新证据（不另起行）

| id | 新证据 | 线程 |
|---|---|---|
| 20261021-07 | 审查者“不看经济字段”不是产品规则，5 个线程作废约 20 名审查者，已计量的合计约 20 M token；1313 #411 由作者过滤证据，削弱“无作者上下文”。skill 交的是含费用的缓存（`research-round/SKILL.md:46-47`）。原 `measure` 改为 skill，方向由用户定 | ab8d-10、f47d-14、4a95-10、1313-3、b9df-13 |
| 20261021-23 | 更正写在证据包里，正常读取看不到；99f6 7 个、f47d 18 个 | 99f6-12、f47d-18 |
| 20261021-28 | 复发：f47d #813、ab8e #600，trial 1428 丢一次已声明读数。ab8e 提议 help 或 `attribution.md:36` 一句 | f47d-20、ab8e-8 |
| 20261022-14 | 备份落后 8,103 个提交（上次 1,644），覆盖 211/2,358 个 trial；DoltHub 正常 | ab8e-21、f47d、1313-11、b9df-20 |
| 20261023-03 | 复发：首份推荐“every one at the first”（`review.md:19`）加跨线可比集，A3 正文 187,955 B、改脚本生成；99f6 推荐 8.8→27.8 KB，外线比较 122 个，未见选外线；ab8e 40 个外线文件选 0 次。重开，动作 skill（约 −5 词），先量外线权衡价值 | a9db-3、99f6-5、ab8e、f47d |
| 20261023-07、20261025-18 | 压缩后重读：a9db 741,660 字符；ab8d 11 次压缩；4a95 14 次；99f6 13 次、18.2 M；1313 10 次；b9df 3.19 MB。产品原因未证明 | a9db-21、ab8d-12、ab8e-22、4a95-13、99f6、1313-17、b9df-19 |
| 20261025-06 | 复发：7 个线程，每次提问空转两回合。99f6 #1418、#1485 回合内 `request_user_input_async` 无空转，长时间离开未试；b9df 提议续跑回合只复述问题 | a9db-20、ab8e-7、f47d-23、4a95-14、99f6-8、1313-19、b9df-6 |
| 20261025-32 | 状态不变：推送中位 10.0 s，每次写约 13 s，约 690 次写阻塞约 2.5 h（估算）；99f6 见 `tags` 阶段全 0.0 | f47d-12、99f6 |
| 20261029-108 | 同因复发：519 个签名 6 个不符，`design-code-runtime.zh.mdx:3,42,49` 写单平台 arm64，错名 `NO_ECONOMIC_EVIDENCE` | b9df-23 |
| 20261031-09 | 回答其 `measure`：`report/graph.py:326-327` 已带前 300 字，`layout.py:27` 滤掉 priority；把 `ref`、`text` 传到 `summary@1` 约 +10 行。动作改 fix | 4a95-5 |
| 20261031-14 | 复发（#2008 的 skill 补救）：6 个线程的登记只引视频或复用一次搜索。a9db 24 份 14 份声明不搜索；ab8d 39/39 只引 Bilibili，76 个登记 0 个 DOI；f47d 56 个 29 个不同字符串；b9df 56 个 49 个复述；1313 25+ 次同一句。`hypothesis.md:7-9` 已要求，`registration/register.py` 只查非空。动作 skill：引文不支持这次改动时必须有命名查询；ab8e 主张先量 | a9db-11、ab8d-9、ab8e-9、f47d-21、1313-10、b9df-11 |
| 20261031-15、20261031-16 | 15 条线 4 条推荐达标，IDE 要选 15 次线；`v_runs` 看不到仅可诊断 | 4a95-15、1313-18 |
| 20261101-05 | 复发收窄：选项文档有可检测差，聊天消息不带（ab8e 13/13）。a9db、b9df 认为 verified 只就各自一次；不采信 | f47d、ab8d、ab8e、1313 |
| 20261105-02 | 1313 约 13 名审查者被指向早先探针，停止后单次审查 1.2 M→2.9 M；a9db 265 次匹配 89 次非零退出（正则）。1313 提议写明一行 `docker run`；是否允许复用探针由用户定 | 1313-4、a9db-22 |
| 20261105-08 | 锚点 229/275 错（83%，上次 61%）；中文 `#L` 277 处（主控复核）。提议删锚点而非建生成器。`deploy/compose.yaml:1-3` arm64 only、`README.md:27,79-80`；签名和命令覆盖继续漂移。`add_venue` 子项不成立，应删 | b9df-21、ab8e-15、99f6-18 |
| 20261105-14 | 复发：镜像缺失也报 `REPRODUCTION_MISMATCH`（ab8d #2584、99f6 #2626）；8 线程 8 次 0 次是结果变了，f47d 3 次是打错 id。`changes.md:18` 仍说“means the result changed”。拆码需授权，先改说明 | ab8d-6、f47d-16、99f6-10 |
| 20261105-17 | 新线第一回合搜索 3 个短语、无机制术语，56 个注册 49 个复述 | b9df-11 |
| 20261105-32 | 见 20261107-55 | b9df-25 |
| 20261105-18 | 见 20261107-39 | a9db-13 |

### 已看过判 none

账本健康（1313）：2,358 个 trial 身份无不符，18 张表历史 `ROW_CHANGED` 0，无孤儿，无未封 trial。Docker VM 停机 2–2.5 h（5 线程），Agent 未越权。`counted_trials` 没被复现灌水（a9db）。ab8e-6、ab8d-21、f47d-24、4a95-16。研究线上的 reduce-only、run 1089 的 `RUNNER_INTEGRITY_FAILED` 等是有用的拒绝。

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| 新镜像先移全部运行 | 比较混用身份；引擎悄悄改变结果 | `COMPARABILITY_MISMATCH` 守可比性；复现本身不删 | 943 次，0 次结果不同；11-04 干跑 12/182 不同 | 收窄（-01，需授权） |
| 回放镜像的 CI 触发路径 | CI 改动使镜像失效 | PR 构建、`workflow_dispatch` | 3 轮无执行改动 | 收窄（-02） |
| 换线停止 | 41 版不回头（20261022-10） | 部分：`REVIEW_DUE`，用户随时可停 | 已答的多数选继续；第一次提问有时有用 | 用户定（-04 选项） |
| 答复后继续滑动 | 用户选后不看新证据 | 从选择后再满 `review_every` | 8/8 线程重复提问 | 重述（-03） |
| 写事务内算比较表 | 无（读固定 commit） | — | 22–24 次回滚 | 移出（-08） |
| 审查者财务盲（Agent 自加） | 未证明 | 四项不读经济结果 | 作废约 20 名 | 写明不要求，或要求并分离字段（20261021-07） |
| `minimum_effect` 必填 | 事后改效应口径 | 无判断读它 | 75% 为 0.0 | 用户定（-21） |
| `review.md:19` “every one at the first” | 首份漏看候选 | `RECOMMENDATION_INCOMPLETE` | 164 行模板化权衡 | 重述（20261023-03） |
| 设计站 277 个 `#L` 锚点 | 精确定位 | 函数名可搜 | 83% 错 | 删（20261105-08） |
| 19 个文档副本、`map.json` 第 4 层标题 | 英文入口；无独立事实 | 构建时生成或读取 | 差异几乎只有标签；27% 分叉 | 删（-54、-55） |
| `killed_before`、`self.started`、`workers` | 无 | 不需要 | 无消费者 | 删（-49） |
| `COMPARISON_ONLY` 单次报告行、`process.json`、`run_sealed` 分表 | 把没算的值当 0；留存命令行；多次封存 | 部分 | 无读者或从未多行 | 现在不动，影响指纹或存储 |
| 33 个同修复的拒绝码合并 | 各自情形 | 合并后同样拒绝 | 0 次触发 | 不做：无会话代价 |
| 来源审查、`REVIEW_DUE`、`SOURCE_ALREADY_EXPOSED`、`COMPARABILITY_MISMATCH`、`REPRODUCTION_MISMATCH`、`RECOMMENDATION_INCOMPLETE` 等 | 身份和暴露边界 | 无 | 有用，或沉默但独有 | 保留。f47d 普查 544 码：触发有用 38，触发无价值 19，静默且未逐码读 454（unverified，不能据此删） |

## Decisions

本批没有用户决定。下列待决，每项说明现在拒绝或要求什么、改后允许什么、不改的办法。

1. **换线计数从哪算（skill 规则，-03）。** 现在你说继续后下一次分不出就再问。改后从你最近一次选线后再满 5 次才问，最多晚 4 次运行知道。不改只能逐次回答。
2. **换线规则本身（skill 规则，-04、-05）。** 现在任一区间排除零就清零，不看方向，规模步和修复重跑也计入。A 保留，更差不清零，规模步和读不到区间的不计；B 删除这条停止；C 按目标差距重述。先做只读重算不需要授权。
3. **换镜像迁移多少（skill 规则，-01）。** 现在全线每个通过的运行都先重放。改后只移下一次比较或推荐要读的，其余读到时再移，未移的退出比较表。不改的办法：只做 -02，只能减少触发次数。
4. **写冲突自动重试（产品代码，-06）。** 现在非封存写第一次冲突就拒绝。改后 `open_trial`、`register` 最多重试 5 次，每次在新头上重跑全部检查，用尽才拒绝。不改的办法：Agent 继续写重试脚本。判断是否也重试待定。
5. **审查者要不要盲读（skill，20261021-07）。** 现在 skill 不要求，还给含费用的缓存。选不要：一句话说明，省去作废和作者投影。选要：写明范围并把经济字段分开。
6. **达标时告知还是询问（skill，-10）。** 现在不算停点。只告知一次继续；或问一次验证还是继续并等你。
7. **`minimum_effect`（产品代码和登记校验，-21）。** A 写明单位和用法；B 不再必填。
8. **备份（配置和说法，20261022-14）。** 现差 8,103 个提交，`ledger review` 仍 ok。关线时同步，或改 `AGENTS.md`、`README.md` 的说法。
9. **公开账本里的第三方转写（账本记录，-29）。** 今后只存摘录和哈希，已发布的不改写；或维持。
10. **公共端口检查的触发（CI，-46）。** 加路径后改 compose 会触发它，不要求设为必需。
11. **doctor 边界（skill，-45）。** 写明带凭据的文件和页面，补 `research graph` 或把 `research state` 的拉取说清。
12. **`--subject` 默认 role（产品代码，放宽，-36）。** 默认 `about`，其余 role 仍须指向候选。
13. **宿主事件。** PID 95669 是否结束（终止宿主进程需授权）；本地 Dolt 密码和 IDE token 是否轮换。

## 分歧与未验证

- **状态分歧**：20261101-05 见上。20261105-56：4a95 不算 verified（线程起于旧措辞），99f6 #948 读到 5 且在 3 轮继续，采信。20261030-07：b9df 判 verified（Agent 按提示改对），其行为工作流判 recurred，f47d-17 另起。20261029-22：ab8e 判 verified 未自查，1313 把 `PUBLISH_FAILED` 列为走到；主控未裁定，状态不改。20261025-12：8 个主时间线只有 1313 一行含 `PUBLISH_REJECTED`（未逐字核），ab8e #60 等锁 34.97 s 未被拒，采信 verified。20261021-20（建议关闭）、20261031-10（建议并入）、20261031-01、20261105-35 证据弱，未动。
- **计数口径**：`CONCURRENT_WRITE` 每线程有多个数，范围不同；复现 4a95 259 与 261、1313 96 与 98，取账本数。
- **主控只亲自复核**：-01 至 -09 的规则和代码、-05 的统计、-15、-16、-19、-20、-22、-46、-49、-51、#L 锚点数和镜像缺失。其余依审计会话，自查情况在其报告。
- **未证明**：`e82c73f10` 上摘要是否本来就会变（未比较镜像层）；-08 能消除多少拒绝；换线本会更好与否；不判断策略经济有效性；文献多只读摘要，Semantic Scholar 无 key 返回 429；物理库增长；`/tmp/doctor-20261107/work` 下是否残留凭据值只由各报告声明（`password` 字样见于若干日志，未逐个读）。
- **底稿**：`/tmp/doctor-20261107/reports/<线程>.md` 是工作副本，重启后消失。
