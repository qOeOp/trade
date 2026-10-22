# 2026-10-22 EMA 日线定仓分叉：第四次会话诊断

按 product-doctor 的三个工作流（行为与决策证据、数据与使用成本、产品契约与交付），由三个 fresh、只读子代理独立检查，主代理复核高优先级发现。目标会话在诊断时仍在运行（已到 trial 31），以下只评价 trial 1–25 及其后的判断与候选发布，不评价之后的研究。

| 项 | 值 |
|---|---|
| 会话 | local Codex Desktop（cli 0.163.0-alpha.10.2），`rollout-2026-10-22T15-41-48-01a16258-2d5c-7813-ab19-bf2578ecb8da.jsonl` 及 14 个子会话（parent_thread_id = 01a16258…）；范围 06:41:49–08:42:09 UTC；截取副本到 08:50:46 |
| 检出 / 账本 | 会话工作树与审计检出均为 `33bc93550`；账本 `research` 于 06:36 新建，`82vm89ihhcfei5u0kjhlke27jt0unml8` → `f49mgersv75d81gbkuqj469bi3lknbpl`，122 次提交；未见市场写入 |
| 覆盖 | 行为与决策（分叉依据、回撤区间、比较输出到判断的链条、root@1 因果失败、拒绝与绕行）；数据与成本（124 次提交对应 CLI 写入、身份一致性、备份、逐版本耗时与 token、trial 24 差额）；产品契约（各机制分类与删减测试、报告/比较契约、skill 规范、ruff/mypy/本地 465 测试/主线 CI 39725766586、设计站）。缺口：trial 26 起的研究；子代理任务正文为密文；第二次 trial-2 审阅（07:00:59）的写入者无转录；验证、市场导入、`execution recover`、research-sources 与 video-evidence；20261021-20 图内容 |
| 用时构成 | 范围内约 120 分钟。等待用户 3.4 分钟（06:43–06:46）及 Goal 授权 5.5 分钟（07:02–07:07）；会话内自跑 doctor 约 6 分钟、5.7M token；上下文压缩停顿 3.0 分钟（07:55）；trial 24 差额排查约 4 分钟；其余为研究、审阅与执行，未再细分 |
| 产品导致的无效试验 | 0。root@1 的同收盘价成交是策略源码错误，由独立源码审阅拦下 |
| 新发现按动作 | fix 3（-09 部分、-10 部分、-15）/ remove 0 / skill 6（-09、-10、-11、-12、-13、-16）/ authority 2（-14 备份新鲜度如需成为检查、-17）/ measure 1（-11 审阅按变更类别的命中率）/ none 1（轮询） |
| 复发项 | 20261020-25 同类（测试输出泄漏 stderr，见 -15）；20261020-40 未复发（预检窗口落在月界且不超过 7 天）；M3 已测 |
| 用户先发现 | 本轮 0 |
| skill 体积 | 全部文件空白分词：research-round 5594（上次 7438，−1844，#1625 合并精简）、product-doctor 1754（2145，−391，#1625/#1626）、research-start 1360（1224，+136，#1631 研究线命名与关闭、#1637 Goal 宿主授权说明）、nautilus-report-analysis 1554、research-sources 1925、video-evidence 5969 均不变。本轮不改 skill |

## 范围与证据

凝缩时间线、截取原件、子代理工作文件位于 `/tmp/doctor-20261022-ema/`（`behavior/`、`data/`、`contracts/`），均为可再生成的工作副本。下文时间均为 UTC，`#n` 为主时间线调用序号。研究线 `research-line-20261022-ema-cross-btc-daily`，窗口 2025-10-01 至 2026-10-01，用户目标：最大回撤 ≤15%、年化 ≥20%。

谱系：root@1（因果审阅失败）→ root@2（t3）→ fixed04（t6）→ entryvar（t9）→ {staticvarref（t12），monthlyvar（t15）→ monthlyvol（t18）→ ewmavol（t24），entryvol（t21）}。每个研究 trial 之后有一个 explore（复现）trial。

## 发现（按会话代价和复发概率排序）

| id | 发现 | 证据（会话；当前产品；消费者与决策） | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261022-09 | 回撤区间对比较消费者不可见。所有版本的最大回撤是同一区间（峰 2025-10-06T18:57，谷 10-10T21:20），完全落在第一笔持仓（run_cycle seq 1，10-02 开、10-14 平，0.4 BTC 上限；仅 staticvarref 约 0.334 BTC 触及该区间）。各定仓规则都是 `min(1,…)` 的只减仓规则，且首笔按十月前数据定仓，无法改变该区间。单次报告封存了峰谷时间，但 `hypothesis compare` 的 drawdown 切片只给最大值、天数和头部合约占比，不给两侧峰谷、区间内持仓或规则动作；零差值时 `same_sign` 为 false。nautilus-report-analysis 写“never recompute”回撤，抑制了描述性区间表 | 会话：Agent 自写的提取脚本在 t6/t9/t12 丢掉 drawdown 段（直到 08:14 才再打印）；entryvar 登记仍预测回撤下降（#117 07:32:24）；判断 9 把落空读成“回撤机制不获支持”，推荐 j25 重复此说法；j13/j15 起改称“首月路径相同”并停止回撤预测，但从未查看次级回撤（2026-02-05 至 04-07 的日收盘回撤在各版本间 2.48%–5.84% 不等，描述性计算）。产品：`ledger/metrics.py:893-898` 封存 `peak_utc@2`/`trough_utc@2`；`registration/duties.py:69-70`、`report/measures.py:65-67` 比较切片无区间身份；`report/attribution.py:345`；`.agents/skills/nautilus-report-analysis/SKILL.md:34-38`。主代理复核：`ledger sql --at f49… SELECT trial_id, JSON_EXTRACT(report,'$.drawdown') FROM run_sealed` 各 trial 峰谷相同，t6/9/15/18/21/24 MDD 均为 0.0846826512 | fix：比较输出按读取时现有封存值并列两侧峰谷，并列出区间内持仓的周期（来自已存 run_cycle，不新增存储字段）。skill：预测回撤变化前先核对被改职责能否在对照的峰谷区间内动作；允许描述性区间表而不改“MDD 只读产品值” | 一次无依据的回撤预测及一条推荐中的错误机制结论；8 个版本均未得到区间信息 | open |
| 20261022-10 | 比较输出已给出可检出效应，但没有消费者使用，分叉选择与推荐依据点估计。`detectable_mean_log_difference_80pct_normal_approx` 在 7 次两两比较中均大于观测均值（1.3–5.6 倍）；年化差区间仅 t12 对 t9 不跨零（[−11.4%, −0.2%]，与 mean-log basic 区间符号不一致），其余均跨零。年化区间是分位数区间、mean-log 区间是 basic 区间，标签未说明。研究目标与距目标距离不在任何输出中（设计选择，`report/status.py:5-7`）。版本按 1–2 个百分点的点估计分成“达标/未达标”，而两两区间宽 ±3–7 个百分点，进入推荐 j25 | 会话：Agent 正确转录每个区间与 p（如 t9 对 t6：+1.69pp，[−3.09, +7.11]，p 0.256），未把不显著读成等价，但“信息价值”论证从未回答同一窗口再跑一个变体能否分辨。产品：`report/comparison.py:196-209`；skill 中无 “detectable” 一词（`rg detectable .agents/skills` 无命中）。主代理复核：`/tmp/doctor-20261022-ema/contracts/compare-*.json` | fix：比较输出把可检出效应同时换算成年化差，并标注两种区间的构造。skill：feedback.md 一句——可检出效应远大于合理效应时，同一开发窗口上的新变体不能分辨，下一实验须说明什么能分辨（更长窗口、更多合约或不同机制） | 7 个定仓分叉在不可分辨的差异上持续；耗时见 -11 | open |
| 20261022-11 | 每版本成本：墙钟 8–17 分钟（root@2 含 root@1 与 Goal 等待为 27.5 分钟），主会话 3.4–10.7M 输入 token（99% 缓存），独立源码审阅 0.7–1.5M token、2.5–4.1 分钟，成交核查子代理 0.3–1.9M。预检 2–4 秒、全年回放约 25 秒、复现 16–18 秒。审阅是每版本关键路径；对含时序代码的定仓变更（月度方差换月、EWMA D-2 滞后）审阅有实质内容，只有 fixed04 是纯常数变更（估计可省约 0.5M token）。每个 run 后都复现，因为 `replay run` 不保留原生报告，而 diagnosis.md 的全窗口时钟检查与 capital.md 的参与率都要求成交；参与率从未驱动决策。轮询 25 次（16 次 10 秒等待）占约 11% 输入 token，几乎全为缓存 | 会话：数据工作流 `data/phases.out`、`segments.out`；契约工作流各版本时间。产品：`registration/register.py:482-486`（SOURCE_PRECHECK_REQUIRED）、`.agents/skills/research-round/SKILL.md:27-38`、`references/diagnosis.md:21-23`、`nautilus-report-analysis/references/capital.md:15-17` | skill：全窗口时钟检查只在订单新增或改时序时复现；参与率仅在仓位相对分钟成交量可能有意义时计算。measure：按变更类别统计源码审阅的命中率，再决定是否向用户提出审阅豁免（改审阅属 authority）。轮询：none（宿主习惯） | 实测见左；节省为估计 | open |
| 20261022-12 | trial 24 的 0.00000002 USDT 毛现金流差额是 Nautilus 逐笔舍入，不是产品缺陷。`price_pnl` 按 realized_pnl + commissions − funding 读取时派生；Nautilus 把每笔减仓成交的 realized PnL 以半偶舍入到 8 位小数，求和后与逐笔精确现金流相差 plan 7、13 各 1e-8。手续费与资金费逐笔相等，realized 与账户现金变化完全相等。8 个研究 run 中只有 t24 出现；凡多价加仓后分步减仓的周期都可能出现，每笔减仓上限 0.5e-8。周期身份检查容差 1e-6（`ledger/metrics.py:37,374-377`）正确地放过。nautilus-report-analysis 把 `price_pnl` 称为“gross fill result”而未提舍入，导致核查子代理期待精确相等 | 会话：08:37–08:41 子代理核查，j27 被 j28 取代且限定语未消解。产品：`ledger/metrics.py:44,920-921`、`report/profit.py:57-60`、`.agents/skills/nautilus-report-analysis/SKILL.md:52-54`；复算 `/tmp/doctor-20261022-ema/data/price_pnl_check.py`、`nautilus_round.py`（plan 7：1524.03945972，未舍入 1524.03945971） | skill：一句说明 realized/price_pnl 是逐笔 8 位舍入之和，与精确成交现金流可差每笔减仓至多 0.5e-8。不改代码或容差 | 约 4 分钟、1.7M 子代理 token、一次判断取代 | open |
| 20261022-13 | 策略编写指导缺“成交须严格晚于决策 K 线收盘”。root@1 在 `on_bar` 内直接下单，成交时间等于日线收盘；预检通过，因为审计只检查成交不早于订单 `ts_init`（`engine/audit.py:600`，`engine/README.md:197-198` 声明不证明信号时钟）。该规则只在 diagnosis.md，编写时读的 strategy-authoring.md 没有 | 会话：独立审阅 `source-review-1-c84fe022d95c0684`（06:54:24）拦下，root@2 修复（#41 06:55:14）。产品：`.agents/skills/research-round/references/strategy-authoring.md:71-86`、`references/diagnosis.md:21-23` | skill：在 strategy-authoring 的下单段落写明（或引用 diagnosis 的同一句），不新增检查 | 一个失败版本及一次额外审阅（约 6 分钟） | open |
| 20261022-14 | 账本备份整轮未同步，`ledger review` 仍报 ok。备份头停在 schema 提交 `e1j26137…`，122 次研究提交和 6.4 MB 来源原件只在活动库；`ledger review` 只检查备份头是否为祖先（历史改写），`status: ancestor` 不产生 finding。同步靠手动 `ledger export --kind backup`，只有 README 在初始化与重建处提到，skill 不要求；research-round 却写“账本及其备份是研究记录” | 会话：全程未运行 export。产品：`report/review.py:76-98`、`cli/main.py:344-366`、`README.md:75-82`、`.agents/skills/research-round/SKILL.md:55`。主代理复核：当前 `ledger review` 输出 `history.head = e1j26137…`、`status: ancestor`、`ok: true` | skill：research-start/research-round 在会话收尾同步备份。若要 review 对过期备份报 finding，属改审计，需 authority | 未造成损失；风险是活动库损坏时整轮研究无副本 | open（待用户定是否每次会话备份） |
| 20261022-15 | 测试输出泄漏 stderr：主线 CI 39725766586 有多行 “Precheck trading window…”（`replay/entry.py:389` 的 print），只有 `tests/replay/test_entry.py:228` 捕获。与 20261020-25 同类 | 契约工作流 `contracts/ci-main-39725766586.log`；本地 465 tests OK（Dolt 2.4.2、ResourceWarning=always），ruff 通过；mypy 在 `ledger/metrics.py:864` 提示未注解的嵌套 `endpoint()` 使其函数体未被检查 | fix：相关测试捕获该输出；给 `endpoint()` 加注解 | CI 日志噪音；回撤贡献函数体缺类型检查 | open |
| 20261022-16 | skill 文字与产品不符：research-round SKILL.md:17“Only these commands write the ledger”所指表格含只读命令，漏了 `replay reproduce`/`replay explore`/`line select`；template.md:27、duty-directory.md:3 引用的 strategy-header.md 是工作目录文件而非 skill 文件；AGENTS.md 的 Skills 列表缺 `research-start`；product-doctor SKILL.md:15 允许“把重放输出再生到 /tmp”而禁止写账本，但 `replay reproduce` 会写一个 explore trial（`replay/reproduce.py:7,77`），其 `--help` 不说明 | 产品文件行号见左；本轮 doctor 子代理均未运行 reproduce，范围后的 trial 29–31 由 Codex 会话写入（已核对其转录） | skill：删去 SKILL.md:17 那句（AGENTS.md 已覆盖）；改引用说明；AGENTS.md 补列 research-start；product-doctor 写明再生须走不写账本的路径或需用户同意。fix：`replay reproduce --help` 说明会写 explore trial | 无会话损失；误导风险 | open |
| 20261022-17 | research-round SKILL.md:11 新增 AGENTS.md 没有的授权规则（宿主进程终止或配置变更需用户授权）；product-doctor SKILL.md:18 的存储字段逐项授权仍与 AGENTS.md:33 不一致（即 20261021-24） | 产品文件行号 | authority：由用户决定保留、并入 AGENTS.md 或删除 | 无 | open |

## 本轮四个问题的结论

1. **回撤与定仓分叉。** 产品的单次报告给出峰谷时间，但比较输出没有；Agent 自己的提取脚本又丢掉了这一段。entryvar 仍预测回撤下降，并把落空写成机制不成立（-09）。自 j13/j15 起 Agent 已认识到“首月路径相同”而停止回撤预测，此后的分叉是为了年化目标（回撤 8.47% 本已在 15% 之内），并非完全盲目；但它从未查看定仓规则真正起作用的次级回撤。
2. **比较输出与下一实验。** 区间与 p 都被正确转录，但产品已给出的可检出效应无人使用，也没有 skill 说明其用法；同一窗口上的定仓变体本就无法分辨，分叉和推荐仍按点估计排序（-10）。注意 t12 对 t9 的年化区间并不跨零（staticvarref 更差）。
3. **每版本成本。** 预检、回放、复现合计不到 1 分钟；成本集中在 Agent 与独立审阅、核查子代理的 token 和墙钟（-11）。对含时序代码的定仓改动，审阅仍有保护价值；可省的是无条件的全窗口复现与参与率计算，以及纯常数改动的审阅（后者属 authority，先测量）。
4. **trial 24 差额。** 舍入，不是缺陷；需要一句 skill 说明（-12）。

## 删减清单

| 机制 | 防护的风险 | 由谁覆盖 | 本会话所见 | 建议 |
|---|---|---|---|---|
| 正式预检（SOURCE_PRECHECK_REQUIRED） | 审阅者看到原生订单而不见全年结果 | 无 | 静默但唯一保护；回放仅 25 秒，预检不省算力 | 保留 |
| 独立 `source review` | 决策时钟、前视、仓位逻辑错误 | 引擎审计不查决策时钟（`engine/audit.py:7`） | root@1 有效拦截；fixed04 无价值 | 保留；按 -11 先测命中率 |
| SOURCE_ALREADY_EXPOSED、登记形状检查、审计、资格 | 暴露与登记完整性 | 无 | 静默但保护 | 保留 |
| INTERPRETATION_REQUIRED | 未解释即继续 | 无 | 有效（经 `research state`） | 保留 |
| 每个 run 后复现 | 全窗口时钟、参与率 | 预检只覆盖短窗口 | fixed04 无价值；monthlyvar/ewmavol 新增加减仓时有价值 | skill 改为按条件（-11） |
| `search_exposure` 判断 | 搜索暴露记录 | 仅 `research state` 消费（`report/status.py:387`） | 未驱动任何决策 | measure，暂不删 |

## 既有项回读

- #1625（271e8bcc9）已合入 20261021-04、-05、-06、-08、-09、-12、-13、-14、-15、-16、-17、-18、-19、-21、-22 所在分支；契约工作流在主线上抽查了 -04、-05、-06、-08、-09、-12、-17、-18、-21。其余几项随同一 PR 合入，未逐项复核。
- 20261022-03 由 #1635（f7e7c1df9）、20261022-04/-05 由 #1636（8d3afd2ed）合入；本会话的 trial 编号统一、预检缓存路径正常运行，未见复发。
- M3 已测：8 个 run、30 条判断时 `research state` 紧凑输出 102 KB，其中 73 KB 是完整判断正文；本会话调用 10 次。保留 measure，待决定是否默认只给摘要。
- 20261020-40 未复发；20261021-03（video-evidence 设计页 404）仍开。

## 诊断过程事故

契约工作流子代理为查 Dolt 二进制读取 `~/.local/share/trade/dolt/service.json` 时，过滤没有排除嵌套字段，账本与市场账户密码进入了其上下文。它未使用、未复述这些值，本记录也不包含它们。这违反了本 skill 的“不读凭据”边界。是否轮换密码由用户决定。

## 决定

用户 2026-10-22：

- -14：暂不加备份同步的 skill 步骤，也不改 review。
- -17：问题不是 skill 与 AGENTS.md 不一致，而是同一信息不该记两处；不重复记录就不会不一致。据此删去 research-round 中与 AGENTS.md 重复的句子（写账本命令、备份是研究记录、Git 不存源码、胜率与仓位变量），只在 skill 中独有的规则（宿主进程权限、doctor 的存储字段逐项授权）不属重复，保留；20261021-24 随之结案。
- 其余各项复核无误后可改，但须避免补丁式膨胀：优先改写既有句子和删除重复，不新增段落或机制。

据此复核后的处理：

- -09、-10 不改产品输出。单次报告已有回撤峰谷，比较已有与 `mean_daily_log_difference` 同单位的可检出差，缺的是读法：只改写 hypothesis.md 的预测句、feedback.md 的信息价值句。
- -11 改写 diagnosis.md 的时钟检查时机及 capital.md 参与率的适用条件；审阅豁免不提出。
- -12、-13 各改写一句；“成交严格晚于决策 K 线收盘”只在 strategy-authoring 陈述，diagnosis 改为引用。
- -15 两处测试捕获 stderr，`endpoint()` 加注解。
- -16 删去 SKILL.md:17 那句；product-doctor 边界句写明 `replay reproduce` 会写 explore trial；`replay reproduce --help` 同步说明。strategy-header.md 是 `candidate new/export` 写入工作目录的文件，引用无误，不改。AGENTS.md 的 Skills 列表与各 skill 的 description 重复，按同一原则应删而不是补列 research-start，待用户确认。
