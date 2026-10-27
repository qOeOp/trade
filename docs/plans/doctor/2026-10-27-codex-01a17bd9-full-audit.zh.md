# 2026-10-27 研究线钉住的市场提交已不在活动库的研究启动完整审计（Codex 会话 01a17bd9，事后独立复审）

本记录按 product-doctor 的全部步骤加 Convergence，对已结束的 Codex 研究会话 01a17bd9 做完整、独立的审计。
- **独立性**：审计在另一宿主、另一模型族上运行。只读原始 transcript、两个检出、账本与市场的只读查询、CI 日志，以及跟读会话保留的原始证据（`/tmp/doctor-01a17bd9/evidence/`），未读跟读会话的笔记与 PR 正文。跟读会话在 [#1783](https://github.com/qOeOp/trade/pull/1783) 登记的两行（20261027-01、-02）在第 1 步当作未结项读入，未交给审查者；本记录沿用这两个编号。
- **审查分工**：三个工作流各派一个 fresh 只读子代理，只给证据路径、检出与问题，并要求它们不读宿主记忆、`docs/plans/doctor/`（只许读 20261026-01 一行，即用户 10-26 的市场决定）与跟读笔记。另做账本保真测试：另一个 fresh 子代理只读 transcript 与 schema，抽出会话图。
- **范围**：本记录只做诊断，不改产品；需要授权的项只列出。

| 项 | 值 |
|---|---|
| 会话 | **宿主**：local Codex Desktop（cli 0.164.0-alpha.11.1，gpt-6.1-sol，effort high）。<br>**transcript**：`rollout-2026-10-27T14-33-51-01a17bd9-c2f1-7a22-935b-2a2e23803c69.jsonl`，383 行，SHA-256 `c446c56f…`。<br>**时间**：2026-10-27T05:33:51Z–05:56:22Z（JST 14:33–14:56），三轮、三条用户消息。<br>**子会话**：无（按 `parent_thread_id` 搜索 10-27 起的 rollout）。<br>**工作目录**：`~/.codex/worktrees/919c/trade`。skill 从主检出 `/Users/vx/WebstormProjects/trade/.agents/skills/` 读取，会话期间主检出也在 `2343d5d60`，无错配 |
| 审计会话 | Claude Code desktop，claude-opus-5-5，会话 `7bb52bb0-ffc1-4912-96bd-43b1006908fb`（worktree `happy-kalam-c025bd`）。四个 fresh 子代理（行为与决策、数据与成本、产品契约、会话图抽取），均为同一模型 |
| 检出 / 账本 | **会话检出**：`2343d5d60`（`feat/paper-charts`，基于 main `3a62c5aac` 加一个 IDE 提交，不在 origin/main），另有三处 IDE 前端未提交改动与未跟踪 `.codex/`。<br>**当前产品**：`44b686d17`；会话后 main 新增 #1773、#1778、#1779、#1780、#1781、#1782。<br>**活动账本 `research`**：自 `odeo1h7mc6e429dohb6qrjt6vd89eusi` 至 `odeo1h7mc6e429dohb6qrjt6vd89eusi`，会话内 0 个提交。<br>**市场**：线固定 `l1kfbo4b2of54ijpjnpn02ijdm175aqd`，活动 `market` 的 head `gc305h705ocn5fm3lcjjerln283gek2t`（2026-10-26 06:07Z 重新初始化，96 个提交）；会话内未写 |
| 覆盖 | **行为与决策**：全部用户与助手消息，37 次调用（三轮 13/16/8）的输入与关键输出；展示给用户的读数逐一对照报告与比较文件。<br>**数据与成本**：账本两条线、211 个试验的市场提交按活动库逐一解析；`ledger review`；逐请求统计 token；`cli-procs.log` 与 `ledger-server.log`；只列目录查看 /tmp 恢复副本。<br>**产品契约**：研究入口与市场引用拒绝路径上的门槛与规则分类；`research state`/`market`/`line` 的 `--help` 与代码、设计站对照；7 个 skill 对照 Anthropic 规范与字数；本地 ruff、mypy、compileall 与 591 项单测（Dolt 2.4.2，无跳过）；main CI 40464946696 日志与近两日取消的运行；无 key 文献检索（OpenAlex、Crossref）。<br>**保真测试**：账本图与会话图都通过 `ide.py check`，差异逐条分类。<br>**未查**：<br>- DoltHub 公开副本状态（需外网读，不经产品）。<br>- 会话第三轮引用的 Dolt 文档与 `dolt_commits` 跨分支说法本身是否正确。<br>- `market review`（会写临时恢复副本）未重跑，结果取自 transcript。<br>- 旧提交与新 head 上 BTC 同窗口数据是否逐字节一致（见 20261025-10）。<br>- Semantic Scholar 无 key 四次 429；Crossref CMIP6 一文只读标题。<br>- eval 未运行；Codex 推理多数无摘要 |
| 用时构成 | **主动时间**：927 s（三轮：233 s / 284 s / 410 s）；等待用户 28 s + 394 s。<br>**研究**：读账本、六份报告、五份比较、推荐，约 90–110 s（第一轮）。<br>**诊断**：第一轮 `UNKNOWN_REF` 之后约 120–140 s，加第二轮 284 s 全部用于查“原提交为什么解析不了”。<br>**修复方案**：第三轮 410 s 全部用于设计把旧历史接回活动库、改提交解析器。<br>**命令**：37 次调用，工具执行约 61 s，其余为模型时间。<br>**回放**：0 |
| 产品导致的无效试验 | 0（会话未登记、未回放） |
| 新发现按动作 | fix 4（-01、-03、-04、-07）/ skill 2（-02 的 skill 部分、-05）/ fix+skill 1（-02）/ authority 0（-02 的旧历史接回方案列为不建议的授权项）/ measure 0 / none 1（-06） |
| 复发项 | 20261025-24（第三次：给出产品必拒的选项）；20261025-30（README 市场起点仍写 2025-01） |
| 用户先发现 | 1：20261027-02（用户 10-27 会话后指出“又一次投研启动失败”） |
| skill 体积 | 各 skill 目录 `.md` 空白分词（与上份记录同口径）：<br>- research-start 3,227（+359：#1774 写明四类输入事实与只问挡住回放的异常；#1780 数据/范围提问先列能跑的范围）<br>- research-sources 1,963（+74：#1777 无 key 应答算已检索）<br>- research-round 8,744、product-doctor 3,369、nautilus-report-analysis 2,125、video-evidence 4,831、research-graph 315（均不变） |

## 经过

**第一轮（05:33:53–05:37:46Z）**：用户只调用 research-start。
- Agent 先 grep 宿主记忆，再按 skill 读账本：`research state` 给出线 `research-line-20261025-ema-entryvar-rollingref-v7`（市场提交 `l1kfbo4…`），`gates` 为空。priority judgment 271 写着“换线已到期”，并要求保留钉住的市场提交以便续跑。
- 05:34:45Z 首次 `market coverage --at l1kfbo4…` 被拒 `UNKNOWN_REF`，`next_actions` 让用 `ledger sql "SELECT * FROM dolt_log"` 列提交。05:35:17Z 照做时被拒：`SQL_STATEMENT_FAILED`，reader 无权读 `market` 库。Agent 随后读产品源码，并对活动 head 跑 `coverage`。
- 给用户的问题有两个选项：
  - **A**：保留原输入，先获取并核验原提交的历史输入证据。
  - **B**：以 trial 200 的思路转向 BTC＋ETH 的新研究线，同时授权建 Goal。

**第二轮（05:38:14–05:42:58Z）**：用户回复“选 A，先核实原市场提交为什么无法解析”。
- Agent 读了 6 次宿主记忆、7 处产品源码、5 份 `docs/plans`、Dolt `server.log`，写了 3 个直接开 Dolt 的临时脚本，还用 Codex 线程工具读了另一会话的 rollout（01a173bd）。
- 结论：当前库是 10-26 重建的另一条历史，原提交只在 /tmp 的恢复副本里。它仍称“由哪条命令替换了活动库尚未确认”。

**第三轮（05:49:32–05:56:22Z）**：用户要“把原提交接回当前市场库、保留重建历史”的方案，暂不执行。
- Agent 读 Dolt 文档与源码，跑了 `market review`。
- 给出六步方案：
  - 把旧历史以分支接回活动 `market`；
  - 把 `market/store.py` 的解析器改查跨分支的 `dolt_commits`；
  - 发布到 DoltHub，并更新备份。
- 方案只把解析器改动标为需授权。

用户会话后原话：“正常来说research start后就是开始正常研究流程 不应该再抛出一堆问题 还要修改代码的 这已经证明是我们产品问题了 … 那个codex会话后面也不会再继续跟了 这又是一次投研启动失败”。

## Findings

| id | 发现 | 证据（会话或规范；当前产品；消费者与决策） | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261027-02 | 线钉住的市场提交已不在活动库，没有任何产品输出告诉研究入口；skill 只对 `RUNTIME_UNSUPPORTED` 有“只能关线重开”的规则，对市场提交消失没有；readiness 的数据提问仍给出“保留选择、取得或核验缺失来源”的分支，于是给出不可执行的选项 A | **会话**：<br>- 05:34:01Z `research state` 的 `gates: []`；05:34:45Z 才由 `market coverage` 撞到 `UNKNOWN_REF`。<br>- 05:37:46Z 的选项 A 不可执行：线上下一次登记必被 `MARKET_COMMIT_UNRESOLVED` 拒（`registration/seams.py:150-156`，`registration/register.py:624`），而用户 10-26 定的是不保留旧历史。<br>- 用户选 A 后，第二、三轮全用于诊断与设计恢复。第三轮方案与 10-26 决定相反，要管理员写活动库并发布公开副本，消息只把解析器改动标为需授权。<br>**当前产品（44b686d17）**：<br>- `research state` 仍 `gates: []`。其文档称列出“下一次登记会遇到的门槛”，实际只含解释与复审门槛和 `RUNTIME_UNSUPPORTED`（`report/status.py:426-446,494-499`）。<br>- 两条线都钉 `l1kfbo4…`；211 个试验、70 个封存运行钉的市场提交在活动库都不可解析。账本、`ledger review`（`limitations: []`）、`research state`、README、skill 都没有“旧历史已不保留”这一事实，只有 doctor 索引 20261026-01 一行记着，且该行不在会话检出里（#1773 晚于 `3a62c5aac`）。<br>- skill 规则：`research-start/SKILL.md:27-37` 只覆盖 `RUNTIME_UNSUPPORTED`。`recommendation.md:17-24` 要求不给 `market coverage` 不过的选项，但现有候选都已在旧提交上运行，模板根又只在无候选或用户离开所有线时才列（`SKILL.md:53-58`），所以没有出口。`readiness.md:51-59`（含 #1780）仍列“keeping the selection while obtaining or verifying the missing source evidence”。<br>- 无评测覆盖。<br>**消费者与决策**：研究入口把线当作补齐证据就能续跑，用户据此选 A；本应在第一轮就说明线不能继续，只给活动市场上的线 | fix（`research state` 在线的 `market_commit` 于活动市场库不可解析时报一个门槛，与 `RUNTIME_UNSUPPORTED` 同处；它只把登记已有的 `MARKET_COMMIT_UNRESOLVED` 提前读出，不新增拒绝，不需授权）+ skill（research-start：该门槛同 `RUNTIME_UNSUPPORTED`，线只能关，`line select` 新线后以 `line close` 的摘要写明原因，重开从活动 head 起；readiness 的“保留选择、取得来源”只适用于提交可解析而来源缺失；加一条评测）。修复不新增存储字段 | **实测**：第一轮约 120–140 s 诊断；第二、三轮 694 s、24 次调用、输入 4.06M token（缓存 3.95M）、输出 22.6K；研究零推进，第三次连续启动失败。**估计**：修后第一轮直接给活动市场上的线 | open |
| 20261027-01 | 市场引用拒绝的修复提示指向研究账本：`UNKNOWN_REF` 让用 `ledger sql "SELECT * FROM dolt_log"`，那列的是账本提交，reader 读不了 `market` 库，也没有市场命令列出市场提交；`MARKET_RETURNS_UNAVAILABLE` 让“使市场库 profile 可用”，`MARKET_COMMIT_UNRESOLVED` 让传 `market coverage` 显示的提交，对已删除的提交都不对 | **会话**：05:35:03Z 拒绝输出；05:35:17Z 照做得 `Access denied … to database 'market'`；此后用 `from market import store` 的自写脚本与另一个 dolt 二进制直读活动库与 /tmp 副本（调用 19、20、22、29、36、37），绕过 CLI。<br>**当前产品**：<br>- `cli/main.py:91-97` 的 `_market_refusal` 取 `ledger/refusals.py:47-48` 账本目录的同名条目；今天 `market coverage --at l1kfbo4…` 复现同一 `next_actions`。<br>- `ledger/refusals.py:130-131,481-484` 的另两条修复文字。<br>- `market --help` 无列提交的动词。<br>**消费者与决策**：research-round 要求按 `next_actions` 解决拒绝，错误的修复把 Agent 引向绕过 | fix（市场引用用市场自己的说明与修复：该提交不在活动市场历史里，`market coverage --at main` 给出 head，钉在它上的运行不能在本库重放；只改文字，不改拒绝条件） | 实测：一次失败调用加此后的绕过读取；单独代价与 -02 交织，未拆分 | open |
| 20261027-03 | CI 质量检查的 `apt-get install ffmpeg` 步骤时常卡 13–25 分钟，把 25 分钟作业超时耗尽 | **CI**：<br>- 6 次运行取消在这一步：40206927567（10-25）、40327569411、40330884070、40333623666、40334408856、40344153198（10-26 main，#1778 合入后），各卡 15–25 分钟。<br>- 40460277872（10-27）这一步耗时 13 分钟后通过。<br>- 正常是 17–26 s（40464946696 等）。<br>**当前产品**：`.github/workflows/quality.yml:36-37` 每次运行都无缓存、无步骤超时地 `apt-get update && install ffmpeg`，只为一项 video-evidence 测试。<br>**消费者与决策**：PR 合并等待、main 上的质量信号缺失 | fix（这一步加短超时与重试，或改用固定版本的静态 ffmpeg 并缓存；测试保留） | 实测：两天内 6 次运行各浪费 15–25 分钟 runner 时间并需重跑 | open |
| 20261027-04 | 设计站与 `--help` 落后于产品 | **设计站 `docs/rd/design-code-report(.zh).mdx` 的 research_state 部分**：<br>- 称它另列 `unverified_runs`（实际只有 `research status` 有，`report/status.py:270`）。<br>- 返回列表缺 `unclosed_lines`、`judgment_history`。<br>- `line.ledger_commit` 实为读取所用的提交，不是该线写入时的提交（今天两者都是 `odeo1h7…`，线写于更早）。<br>**`research state --help`**：漏了无线时的 `next_actions`。<br>**评测引用**：9 个带规则的评测没有任何设计页引用，例如 #1774 `zero-volume-observation-asks-only-blocking-gap`、#1780 `stored-month-gap-question-keeps-runnable-range`、#1777 `keyless-answer-counts-as-searched`、#1744 `reviewer-reads-no-memory`；另有 2 个是触发测试。<br>**消费者与决策**：读设计站与 help 的 Agent 和用户；本会话未因此做错决定 | fix（设计页与 help 对齐代码，补评测引用） | 无会话代价；按规范检查 | open |
| 20261027-05 | skill 结构不合外部规范 | **规范**：<br>- [best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)：引用只离 SKILL.md 一层；超过 100 行的引用文件要有目录。<br>- research-start `recommendation.md` 再引 research-round `review.md`、`validation.md`；`selection.md` 再引 `hypothesis.md`、`template.md`；research-round `diagnosis.md` 引 nautilus-report-analysis `capital.md`，后者又引 `feedback.md`。<br>- `readiness.md` 119 行，无目录。<br>- `duty-directory.md:3`、`template.md:53` 只写 `strategy-header.md` 这个裸名，它实际在 `cli/templates/`，从 skill 解析不到。<br>**消费者与决策**：Agent 渐进加载时可能读不到或读偏；本会话未见因此出错 | skill | 无会话代价；按规范检查 | open |
| 20261027-06 | 展示给用户的读数数值全对（年化、回撤、Sharpe、胜率、资金占用、费用、利润拆分、差值与区间），但有三处口径偏差：<br>- 把换线条件说成“各次差异区间都跨零”，产品规则是均值差不超过可检出差；<br>- 胜率只有 13 个计划，未给样本量；<br>- B 的“已核对范围”是 Agent 自选的查询范围，不是 readiness 要的可支持范围 | **会话**：05:37:46Z 消息，对照 `report-200/207`、`compare-207`。<br>**当前产品**：research-round、recommendation.md、readiness.md 已有对应要求。<br>**消费者与决策**：未改变选择（两条换线条件对 203–211 都成立） | none（既有指导已覆盖） | — | — |
| 20261027-07 | 测试服务线程在客户端断开时打印未处理的回溯，CI 质量日志里有两段，约 90 行 | **CI 40464946696（main 44b686d17）**：<br>- 07:12:25Z `paper/serve.py:370→458→runs.py:256` 之后的 `BrokenPipeError`。<br>- 07:15:48Z `http.server handle_one_request` 的 `ConnectionResetError`（research_graph serve 测试）。<br>**本地**：本地 591 项测试同见后者。<br>测试都通过，ResourceWarning 检查抓不到。<br>**规范**：用户 10-20 先指出过“CI 测试日志满是错误与警告行”（20261020-25）。<br>**消费者与决策**：读 CI 日志的人与诊断，会误以为有错 | fix（服务端吞掉客户端断开，或测试按协议关闭连接） | 无会话代价 | open |

## 保真测试

- **两张图**：
  - 账本图：`research graph --at odeo1h7… --since odeo1h7…`，75 个版本、37 个事件，通过 `ide.py check`。
  - 会话图：6 个 v7 版本、6 个试验、3 个事件，同样通过。
- **比较**：`ide.py compare --until 2026-10-27T05:56:22`。
- **差异类别**：
  - 只在账本的 69 个版本：v6 历史版本，会话未读其归属。
  - 6 个父版本、6 组预测、5 组源码审阅、5 个状态，以及 hypothesis/duties/interpretation/source 字段：会话都没有读出。
- **全部归为 extraction miss**：会话没有读这些事实，也没有写账本。没有 ledger gap，也没有只在会话里出现的事实。
- **非图字段**：会话的主要事实是“线钉住的提交在活动库不可解析”。它由账本的 `market_commit` 与市场库可推出（derivable），是 -02 要补的读路径。“旧历史不保留”这一用户决定可由 `line close` 摘要承载，不需新字段。

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| `RUNTIME_UNSUPPORTED` 门槛与 skill 规则 | 给出或续跑无法重放的线 | 登记与预检的契约拒绝（更晚） | 本会话未触发；3 个评测 | 保留；-02 照此补市场提交的同类门槛 |
| `MARKET_COMMIT_UNRESOLVED`（`line select`、登记） | 在不存在的数据上钉线或重放 | 无 | 未触发（会话未登记），唯一保护 | 保留 |
| recommendation.md 的“`market coverage` 不过就不给” | 给出跑不了的选项 | 登记拒绝（更晚） | 撞到了 `UNKNOWN_REF`，但无出口 | 保留；-02 补出口 |
| readiness.md“保留选择、取得或核验缺失来源”分支 | 提交可解析时来源缺失，用户想保留线 | 无 | 对已删除的提交生成了选项 A | 收窄到提交可解析的情形（-02） |
| 市场引用拒绝套用账本目录的修复文字 | 无（误导） | 拒绝本身的 `message` | 引向读不了的命令并致绕过 | 改文字（-01） |
| 模板根只在无候选或用户离开所有线时列出 | 无故重启 | 无 | 与 -02 叠加成无出口 | 保留；-02 加市场提交失效的分支 |
| “readiness 不自己换提交” | 静默换输入 | 无 | 会话交给用户选 | 保留 |
| `trials_on_line` 按市场提交加窗口计数 | 把别的数据算成同一次搜索 | `research status` 按窗口计数 | 新线换到 `gc305h7…` 同窗口会从 0 计，旧线已有 70 个研究试验 | 先量（20261025-10） |
| quality.yml 的 ffmpeg apt 步骤 | video-evidence 检查器测试 | 无 | 6 次取消 | 保留测试，改安装方式（-03） |

## 授权项

- **不建议**：会话第三轮的方案要把旧市场历史接回活动 `market`、改提交解析器跨分支查找（放宽 `UNKNOWN_REF`），并发布到公开 DoltHub 与备份。这推翻用户 2026-10-26“只留一个 `market`、不保留旧历史”的决定，修复研究入口也用不到它。按 AGENTS.md，改拒绝、管理员写市场库、改公开副本都需用户授权。本记录建议不做，以 -02 的关线重开代替。
- -02 的 `research state` 门槛只是把已有的登记拒绝提前读出，按本记录判断不需授权；若用户认为它是新检查，则作授权项处理。

## 既有项回读

- **verified**：
  - 20261026-03：#1774 在会话检出内；会话对活动 head 的 18 个零成交量分钟只说明、不提问。
  - 20261026-07：main CI 40464946696 用新配置跑 591 项，无警告；mypy 读 pyproject 并包含 `paper`。
- **recurred**：
  - 20261025-24：#1750 在检出内，仍给出产品必拒的选项 A；后续由 20261027-02 跟踪。
  - 20261025-30：README:93 仍写活动库自 2025-01；活动库现从 2020-01 起，BTC 2020-01-01 有 1,440 根。
- **unobserved**：其余已修项。会话未登记、未回放、未走 readiness 的数据提问；#1778、#1779、#1780 不在会话检出内。
- **measure 补数**：
  - 20261021-26：读宿主记忆 11 次，三轮回答都带记忆引用；用 Codex 线程工具读另一会话的 rollout。
  - 20261025-18：40 次请求，输入 5.10M（缓存 4.89M），输出 30.1K，最大上下文 226K，无压缩。
  - 20261023-07：无压缩、无重读。
  - 20261025-10：账本上 70 个研究试验搜索过 BTCUSDT `[2025-10-01, 2026-10-01)`，在 `gc305h7…` 上新开同窗口线时 `trials_on_line` 从 0 计。

## 文献（无 key）

- **OpenAlex**：
  - Rauber 等 2016 的 RDA 动态数据引用建议（10.5281/zenodo.4048303）：以版本化数据加时间戳与查询子集，使数据源演化后原子集仍可识别。
  - Bailey、Borwein、López de Prado、Zhu 2014（10.1090/noti1105）：尝试的配置越多，回测过拟合的概率越高。
- **与产品的关系**：
  - 市场库重建后旧提交不可识别，正是该建议要避免的情形。用户已决定接受这一代价；产品至少要在读路径上说清楚（-02）。
  - 试验计数按数据版本而非所搜数据计数会低估（20261025-10）。

## Decisions

无（本审计未取得用户决定）。
