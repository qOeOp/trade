# 2026-10-31 doctor 覆盖回顾：研究方法、修复成效与用户体验

| 项 | 值 |
|---|---|
| 会话 | 不审单个研究会话。读的是 origin/main d3bb52cf9 上的 51 份诊断记录和 `index.zh.md`（215 行），以及只读的账本与 IDE；IDE 走查时研究会话 Codex `01a18f8b…` 仍在跑 |
| 审计会话 | Claude Code，Opus 5.5，会话 880a0cc9；同一会话此前正对 `01a18f8b` 做 attach（attach 的证据不进本记录）；worktree `doctor-meta-review`，本 PR 由本会话写 |
| 检出 / 账本 | origin/main d3bb52cf9；账本只读，读到的提交为 `0snouj3v…` 至 `8n1220bc…`（研究会话写入中） |
| 覆盖 | 用户的三个问题：doctor 对研究方法与假设质量的发现能力；修复是否守住、产品是否变好；用户旅程与体验（数据库、IDE 展示、信息可找到、操作可达）。三个全新只读子代理各管一题，主会话走查 IDE（RSI 线，1440×900）并复核关键结论。没有读研究会话转录，没有重跑历史验收；分类由人工完成，边界有主观成分 |
| 成本 | 本审计 05:08–05:40 UTC 约 32 分钟（含等待）；子代理约 52 万 token；主会话 token 未计 |
| 净变化 | 本记录不改产品和 skill。提议若全部采纳：lenses.md 约 +95 词、record.md 约 +30 词，0 个新机制、0 个新字段、0 个拒绝码；IDE 两项修复只展示账本已有事实。增长的理由见各项“动作” |

## 发现

| id | 发现 | 证据 | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261031-13 | doctor 不审人的使用体验，用户体验问题多由用户先发现 | **记录**：215 行里用户体验相关 30 行，用户先发现 17 行（57%）；IDE 布局、导航、画布 9 行全是用户先发现，doctor 发现的 5 行全是图数据或运维问题。全产品审计自认未读 `services/ide`（`2026-10-29-whole-product-audit.zh.md:15`）。<br>**规则**：`lenses.md` 的外部规范只列研究方法文献、skill 指南、静态检查、设计站一致性；按 `nielsen\|heuristic\|usability\|可用性\|任务耗时\|journey\|findab` 等全量扫 `docs/plans/doctor/` 与 doctor skill，没有一次用外部可用性标准，也没测过用户完成任务的步数或时间；文档评分矩阵只有“Agent 可用性”一维（`2026-10-29-doc-product-score-matrix.zh.md:16`）。<br>**用户先发现**：用户 10-31 提问；应由 Product contracts and delivery 抓到 | authority（见决定 A1） | unknown | open |
| 20261031-14 | doctor 不审产品对假设质量的支持：假设依据、搜索面、停止规则在本窗口的分辨力都没人看过 | **记录**：按 `假设质量\|选题\|调参\|经济机制\|局部条件` 扫 10-22 之后约 45 份记录，0 命中；只有 10-20、10-21 四份评过（如 `2026-10-21-ema12-autonomous-audit.zh.md:52`）。<br>**当前产品**：`SOURCES_REQUIRED` 把任何非空 `rationale.external` 当引用（`registration/register.py:617`），Agent 把“未引用外部来源”写进 `local` 就过，01a1856e 审计判“按设计”（`2026-10-30-codex-01a1856e-full-audit.zh.md:26`）。停止规则的“5 次弱比较”只当用户定的断路器（`2026-10-29-consolidation-review.zh.md:75`），01a1856b 的 23 次比较全在可检测差内（`2026-10-30-codex-01a1856b-full-audit.zh.md:18`），这类局部改动在单一开发窗口上能否分辨，没有记录分析过。<br>**边界**：`product-doctor/SKILL.md` 把选实验划给 research-round，`lenses.md` 已写“评估产品对推理的支持，不做研究选择”，缺的是这一句没落到假设层面。<br>**用户先发现**：用户 10-31 提问；应由 Behavior and decision evidence 抓到 | authority（见决定 A2、A3） | unknown | open |
| 20261031-09 | IDE 不显示研究线的状态和待用户的事（与 [01a18f8b 完整审计](2026-10-31-codex-01a18f8b-full-audit.zh.md) 的 20261031-09 同一根因，并为一条） | **当前产品**：首页只列线名与 Open/Closed，没有各线推荐、达标与否、最近活动。线页没有 `research state` 的 gates（REVIEW_DUE 等），没有“Agent 在等用户选择”。下一步方向的 `priority` 判断进了图数据，被 `ide/research_graph/layout.py:27` 的 `EVENT_KINDS` 过滤掉。<br>**消费者与决策**：选线、给目标、授权都在 Codex 对话里做（`research-start/SKILL.md:80-98`），01a18f8b 因等选择停了三轮（10-31 03:12–03:19Z），IDE 上看不出来 | fix（展示账本已有事实，不加字段；IDE 只读不变） | unknown | open |
| 20261031-15 | IDE 把产品字段名和未换算的统计量直接给人看 | **当前产品**（RSI 线 `level5@1` 详情，10-31 05:10Z）：预测一栏三行字面相同的 `trade_structure.cycles`，另有 `profit_bridge.price`；对照比较给“平均日对数差 −0.00000647、最小可检测差 0.0000489”；目标值只在悬停提示里，达标或不达标没有标记；回放失去资格的原因只在悬停提示（`ReplayTable.tsx:29`）；收益对回撤散点原点附近两个标签重叠 | fix | unknown | open |
| 20261031-16 | 人直接查账本答不了常见问题 | **当前产品**：“最好的策略达标没有”没有结构化字段，要读推荐正文（7,403 字符）或 `run_sealed.report` 的 JSON；“今天发生了什么”：10-31 有 117 个 `dolt_log` 提交，说明都是 `add_judgment:add_judgment:<哈希>`，不写线和 trial；“X 为什么被拒”只给评审 bundle 名；`docs/rd` 9 个数据库页只有 views 页有 SQL，没有按问题组织的查询示例。<br>**消费者**：未测人实际查了什么 | measure（先记下用户直接问账本的问题，再决定改提交说明还是补查询示例；不加字段） | unknown | open |
| 20261029-03 | doctor 的补救只会加：标记 verified 之后照样在长 | 同法计数（`ledger/refusals.py` 目录键；`.agents/skills` 全部 `.md` 词数）：e8b09ce34（10-29 末）261 个拒绝码、24,920 词 → d3bb52cf9 265 个、25,913 词。原 verified 的依据是两份审计自己的处置净变化为负（`2026-10-29-index-format-conversion.zh.md:120`），不是之后的研究会话走到该路径 | skill（重述不变；之后每份记录的净变化行按同法计数，见决定 A4） | unknown | recurred |

另有一处索引数据错误：20261029-24 的来源写成 `doctor`，它的记录写“用户首先发现”（`2026-10-29-ide-line-navigation.zh.md:3`），已改为 `user（产品契约与交付）`。

## 修复成效

**能证明守住的**
- 20261020-21：账本 `run_sealed` 按 `metrics_revision` 逐个 `git merge-base --is-ancestor`，#1748 之后封存的 104 个运行全在 main 上，只有 10-25 的 6 个（`8c5cd561f`）不在。
- 前视（20261022-13）、换线计数（20261022-10 的第一种形式）、比较总体（20261025-25）、tick 网格（20261028-13）都有后续研究会话的证实。
- 20261029-31（代价不记）：215 行里 198 行代价是 `unknown`，但几乎都是 #1865（10-29）之前的行；10-30、10-31 新开的 13 行里 10 行有实测代价，只有 3 行 `unknown`。改为 verified。
- 账本：source-review 失败 10-22 为 22/84、10-29 为 20/96、10-30 为 0/12、10-31 为 0/10；explore 试验 10-30 为 14、10-31 为 0（#1904 之后）。后两天样本小，只是账本观察，还没有审计记录确认。

**证明不了的**
- 到过 `fixed` 的 156 行里只有 36 行 `verified`；36 行 `unobserved`。
- 复发：20261025-24 修三次后又出现 4 次；同一事实的消费者接连漏修（20261028-10 → 20261029-01 → `availability.py` → 20261030-01）；20261022-10 的根因以“在可检测差内换推荐会把计数清零”的形式复发（20261030-03，#1897 未验证）。
- 每版本 token：10-23 12.1M → 01a1856b 14.1M → 01a1856e 14.7M；最后两场各有约 3.5–4.5 h 产品返工；用户先发现到 10-31 仍有（20261031-02/03/04/06）。没有做过按会话长度归一的比较。
- 多重比较与数据复用：20261025-10（试验按市场提交计数，同窗口重算为 0）与 20261025-35（DSR 的 N 与方差不同总体）自 10-25 一直是 open/measure。

**抽查 verified 的依据**：随机 5 条里 20261025-27、20261026-03、20261025-20 成立，20261023-04 实质成立，20261029-03 不成立（已改 recurred）。另有 6 行（20261028-10、20261028-13、20261027-10、20261027-08、20261026-06、20261028-01）的状态链接指向全产品审计，但该记录里没有这些编号；研究会话的证据在格式转换记录（`2026-10-29-index-format-conversion.zh.md:123-129`）里，证据本身成立，只是链接指错，已改链；20261020-21 改链到本记录的账本证据。

## 用户体验现状（IDE 走查）

有：线页头的推荐版本、收益、回撤、Sharpe、“Picked from N runs / Unchanged for N runs”；版本树、谱系画布、实时版本表（含当时正在跑的 trial 483）；收益进度（有收益目标线）；收益对回撤散点（达标区与非支配前沿）；详情面板的改动、假设、预测、回放、对照、源码评审、结论；Sources 与父版本对比；Data gaps；纸面交易页（权益、费用、资金费、回撤、逐笔、对账）；⌘K 跳转；只读的内嵌 Agent。

缺：见 20261031-09、-10。另外研究回放没有费用、资金费、敞口拆分与回撤曲线（`graph.schema.json` 每个 trial 只有 return、drawdown、sharpe、win_rate、eligible，账本 `run_sealed.report` 里有这些数据）；任意两个 trial 之间不能对比；选线、目标、关线、授权只能经 Agent 或 CLI，IDE 只读是用户 10-30 的决定，所以提议只展示待办，不在 IDE 里写。谱系画布左侧节点像被版本面板盖住，未核实是否只是画布平移。

## 删除清单

无。

## 决定

用户 2026-10-31 回复“授权”，授权 A1、A2、A4，各自一个 PR；A3 不在本次授权内，仍待独立复核后单独提出。

用户 2026-10-31 对待定事项逐条过了一遍，回复“都按建议来”：
- 合并顺序：先合 [01a18f8b 完整审计](2026-10-31-codex-01a18f8b-full-audit.zh.md)（#1961），本记录 rebase 后合并，再合 A1、A2、A4。
- 20261031-07（换线条件）：只有配对基本区间含零的研究运行才计数，可检测差改为年化单位的功效读数，改正 feedback.md 那句；连续次数与两个研究目标不变。
- 20261025-11（供给端比对导出器源码）：视为 10-25 决定的延伸，供给端改比导出内容；拒绝写出不符字段与两边取值，给出“请用户更新供给端”或“传本地 `--market` 配置”两条出路。
- 20261031-11（导出收据墙钟秒数进公开账本）：先做独立子代理审阅，结论再交用户。
- 20261031-12（`change` 须与候选 `difference` 逐字节相同）：`change` 从候选取值，不再由 Agent 重填。
- A3 两项：先各做独立复核，不改代码。
- attach：attach.md 加一段，允许对已结束部分做聚焦诊断并实时告诉用户，不写记录、不交给审计；全量审计照旧在新会话做。
- 20261025-08：AGENTS.md 已有“never stack one PR on another”（#1682），记为已修。

执行结果（10-31）：20261031-07 由 #1963 合入（d3ef14e20），20261031-12 由 #1965 合入（e02e44f1f），20261025-11 在 #1964 待合，合入后须由用户更新 compose 的 market-supply 与 paper（新协议 `market-supply-v2`，旧供给端会拒新客户端）。

## 独立复核（2026-10-31）

三份只读复核都基于 ba2579a8e 与账本提交 `79nvntvq0n28t6ou9c45kkjf4php67f3`，不改代码、不写账本；结论待用户定。

- **20261031-11（`export.json` 的墙钟 `seconds`）**：全账本 `input-coverage.json` 491 个文件存成 243 份，去掉 `export_receipts.*.seconds` 后 66 份，多存 1,345,820 B；各组除 `seconds` 外无差异。读 receipt 的代码（`engine/load.py`、`engine/audit.py`、`ledger/coverage.py`、`registration/validation.py`、`replay/reproduce.py`）都不读它，缓存命中时它记的还是首次导出耗时。建议 (a)：`market/export.py:487` 不再写 `seconds`（同删 :404 `started`），已存记录不改；`export_content_sha256` 的语义哈希本就去掉它，旧运行 `input_key` 不变；导出器源码哈希会变，本地缓存重导一次，供给端须更新（#1964 合入后导出器哈希不同不再被拒）。备选 (b) 只在 `replay/entry.py:191` 构造覆盖文件时去掉，多一种 receipt 形态；(c) 维持现状。
- **A3(a) `SOURCES_REQUIRED`**：163 份登记中 `external` 非空 142 份，138 份所引 bundle 含原件或检索日志（84 份 PDF，49 份只有 HTML）；未见把内部笔记冒充文献，问题是不一致：同样的“未找到外部证据”有的写进 `external`、有的写进 `local`，写明未找到并附检索日志的只有 1 份。来源不进审计和资格，不是产品要守的信任边界。建议只改 skill：research-round `hypothesis.md` 要求 `external` 二选一，给出引用（DOI/arXiv/URL 加所在 bundle）或写明哪些查询未找到并给检索日志 bundle（规范：PRISMA 2020 条目 6–7，https://doi.org/10.1136/bmj.n71 ）。产品收紧（所引 bundle 须含原件或检索日志）留待复发。
- **A3(b) 多重检验的试验计数**：`line_trials`（`ledger/lines.py:261-293`）管换线与复审节奏，不管多重检验，不改。`by_development_window` 已跨市场提交合并，但只合并完全相同的窗口，不看合约与重叠；`ratios.md:14-23` 与 `research-round/SKILL.md:110-113` 给 DSR 的 N 不一致。账本 168 个 research 试验全部与 2025-10..2026-10 重叠，RSI 线按 `ratios.md` 读 N=[30,30]。文献（Bailey & López de Prado 2014，https://doi.org/10.3905/jpm.2014.40.5.094 附录 A.3；Harvey, Liu & Zhu 2016；White 2000）都按合约 × 重叠时期累计、再按相关性折算有效 N。建议在 `report/status.py` 读时派生，不加存储字段：给出同合约、窗口重叠、跨市场提交和线的试验数 M（research 与全部用途分列），并用这些 research 运行的日收益按 N̂ = ρ̂ + (1−ρ̂)M 估下界，夏普方差 V 取同一组运行（解决 20261025-35）；`ratios.md` 同步一处。不同窗口长度的夏普须先统一频率，实现时定。


- **A1（20261031-13）**：在 `lenses.md` 的 Product contracts and delivery 加“人的使用”一段：IDE、CLI 输出和账本里给人读的部分，检查研究者能否找到达标与否、线的状态和待办决定，能否到达所需视图；对照一份公开可用性规范（如 [Nielsen 十条启发式](https://www.nngroup.com/articles/ten-usability-heuristics/)）；必要时数任务步数。全产品审计须读 `ide/`。约 +60 词。
- **A2（20261031-14）**：在 `lenses.md` 的 Behavior and decision evidence 的 Method 段加一句：评估产品和 skill 如何让假设落到机制和先例（`research-sources`），以及停止或换线规则在该窗口上能否分辨所比较的效应；仍不做研究选择。约 +35 词。
- **A3（20261031-14 / 20261025-10 / 20261025-35）**：两件改研究检查的事，按 AGENTS.md 需用户授权，各自单独 PR：(a) `SOURCES_REQUIRED` 是否要求 `rationale.external` 给出可核验的来源身份，或写明经 `research-sources` 检索无先例；(b) 试验计数是否按合约与重叠窗口而不是市场提交计。本记录只提出，不推荐具体口径前先做一次独立复核。
- **A4（20261029-03）**：`record.md` 加两句：`verified` 必须在所链记录里写出走到该路径的研究会话和调用；净变化行按固定方法计拒绝码和 skill 词数。约 +30 词。
- 20261031-09、-15 是产品修复，不改检查也不加字段，可直接按 doctor 流程各开一个 PR；20261031-16 先测量。
