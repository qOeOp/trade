# 2026-11-13 未结项圆桌

用户 2026-11-13：“继续开圆桌会议把能解决的都解决了需要量的可以先记着 以后doctor也会pick的”。这句委托是本记录各项裁决与随后各修复 PR 的依据；用户保留的事（字体、真实资金 Live、研究目标、破坏性写入、活动账本与市场、主机配置、收紧或放宽审计检查）不在委托内，列在“待用户”。

## 范围与方法

对象是 [index.zh.md](index.zh.md) 未结表里状态为 `open` 或 `recurred` 的 35 行（2026-11-13，`main` 0c935be3a）。四个只读评审按簇分拣（IDE 7 行、运维与文档 10 行、skill 9 行、流程与评测 9 行），各自在 `origin/main` 只读检出上逐行重跑证明；一个批评者交叉审四份结论；主席定裁决与修复批次。协调会话随后在同一检出上复核了全部 20 个所引提交都在 `main` 上，并抽查了各“现在修”批次要改的原文与行号。

裁决：已修 18、现在修 8、不改 5、待测 1、待用户 3；另立 3 个新发现。

## 裁决

| id | 裁决 | 记录 |
|---|---|---|
| 20261107-126 | 已修 | fixed 0957989ee [#2613](https://github.com/qOeOp/trade/pull/2613)：换 provider 或 URL 必须重新输入 key |
| 20261107-132 | 已修 | fixed 59628ae8c [#2621](https://github.com/qOeOp/trade/pull/2621)（含更早的 b9abc34f7 [#2463]） |
| 20261107-133 | 已修 | fixed 81711cef1 [#2622](https://github.com/qOeOp/trade/pull/2622) |
| 20261107-134 | 已修 | fixed c4303568a [#2626](https://github.com/qOeOp/trade/pull/2626)（375px 由 14612e2c8 [#2255] 的手机布局覆盖）；以后 doctor 可在 main 上用 axe-core 4.10 跑 Market 页明暗两版，0 个对比度违规即 verified |
| 20261031-09 | 现在修 | B2 修复中：桌面研究线菜单逐线显示推荐与目标判定（门槛与下一方向部分已由 #2637 修复） |
| 20261031-15 | 已修 | fixed a52e3e3de [#2632](https://github.com/qOeOp/trade/pull/2632)；跨线逐条选择的部分并入 20261031-09 |
| 20261105-06 | 已修 | fixed cec1f5505 [#2623](https://github.com/qOeOp/trade/pull/2623) |
| 20261107-102 | 待用户 | 待用户确认：PP Supply Mono 授权是否允许在公开仓库、公开 IDE 镜像和公开文档站分发 .otf；确认后加 ide/web/fonts/LICENSE 并改 THIRD_PARTY_NOTICES.md:58 再关闭，字体文件与字族顺序不动 |
| 20261107-113 | 现在修 | B3 修复中：SCHEMA_MISMATCH 的下一步改为按账本代际用对应版本，绝不为过检重建或改写账本；权限部分已由用户 11-11 P5 决定 |
| 20261107-114 | 已修 | fixed [#2653](https://github.com/qOeOp/trade/pull/2653) + [#2783](https://github.com/qOeOp/trade/pull/2783)；演练见 docs/plans/ide-first-run.zh.md:141；设计站残句归 20261105-08 |
| 20261107-121 | 已修 | fixed b0ae2d016 [#2810](https://github.com/qOeOp/trade/pull/2810)：Live 门槛已落实；Paper 不设门槛；首次真实验证登记后由 doctor 核对 ledger review 的 validations_checked≥1 且 Live review 列出该验证，即标 verified |
| 20261107-138 | 已修 | fixed [#2233](https://github.com/qOeOp/trade/pull/2233) 及 03f258e65、5c2e57040 |
| 20261105-08 | 现在修 | B4 修复中：设计站说明 paper 库也有本机 dolt_backup；锚点与页面部分已由 #2311 关闭 |
| 20261031-10 | 已修 | fixed 15d73db7b [#2311](https://github.com/qOeOp/trade/pull/2311) |
| 20261029-34 | 不改 | 关闭：非产品缺陷；11-12 经用户批量批准已清理，剩余悬空镜像 2、卷 0；以后审计发现残留时作为待批清单报给用户，不再记为复发发现 |
| 20261026-05 | 已修 | fixed 18cf612a9 [#2612](https://github.com/qOeOp/trade/pull/2612)；新工具目录出现时补一行 .gitignore |
| 20261105-19 | 不改 | 关闭：Binance 已发布 2026-10-28 与 10 月归档，market-import 于 2026-11-13 健康；check 不改 |
| 20261105-02 | 已修 | fixed a7e8b2655 [#2700](https://github.com/qOeOp/trade/pull/2700)；以后 doctor 若见会话里 API 查找非零退出超过约 1/5 则重开 |
| 20261105-04 | 现在修 | B5 修复中：readiness 写明唯一镜像由 replay precheck 的 RUNTIME_DIGEST_AMBIGUOUS 检查；compose 部分已由 #2698 修复 |
| 20261105-05 | 已修 | fixed 35d7d8417 [#2698](https://github.com/qOeOp/trade/pull/2698) |
| 20261105-14 | 现在修 | B6 修复中：research-round 按消息区分 REPRODUCTION_MISMATCH，未比较的两种情况不当作结果变化 |
| 20261105-15 | 已修 | fixed a08ac6834 [#2185](https://github.com/qOeOp/trade/pull/2185) + cd6b979ac [#2672](https://github.com/qOeOp/trade/pull/2672) |
| 20261105-17 | 不改 | 关闭不改：登记前 hypothesis.md 已要求机制与前人工作；若以后用户在看到选后才找到的机制时改线或弃线，再在 research-start SKILL.md:84 加约 10 词重开 |
| 20261023-03 | 待测 | 待测：(1) 在隔离 ledger temp 库用 70000 字节 body 跑 judgment add --kind recommendation，记产品拒绝/原始库错误/静默截断（另立 20261113-01）；(2) 从旧账本只读副本与 gen-1 账本量每条线首个推荐的 body 字节数、权衡的他线候选数、推荐或取舍是否来自他线；任一 body >32KB、截断或他线权衡从未改变推荐，则把 review.md:12-13 改为首推只权衡 candidates 及表中未被支配的他线候选，all-comparable-candidates Q1 另开 PR；否则作为可接受成本关闭 |
| 20261101-05 | 已修 | fixed 627bc655e [#2674](https://github.com/qOeOp/trade/pull/2674) + 0f77238a1 [#2817](https://github.com/qOeOp/trade/pull/2817)；以后 doctor 在真实会话首次到期换思路时核对消息含两目标与可检测年化差即 verified |
| 20261025-06 | 不改 | 关闭为宿主行为；可选以后测：一次 Codex 会话里轮内用户输入工具能否在用户离开 30 分钟以上时挡住 Goal 继续，能才在 SKILL.md:126-129 加一句优先用它 |
| 20261020-38 | 待用户 | 待用户批准：源码审查简报只写四项名字、含义由审查者读 skill，简报不带以前结论或作者看法（收紧审查执行方式，判定标准不变）；圆桌建议批准 |
| 20261021-07 | 已修 | fixed d16fd02ac [#2710](https://github.com/qOeOp/trade/pull/2710) + f82c10df8 [#2775](https://github.com/qOeOp/trade/pull/2775)；以后研究会话审查者只读该切片即 verified |
| 20261031-14 | 已修 | verified：b5788262 会话登记 1-25（账本 pio1ucfk…）均引用相关来源或记录了检索，无复发；移入已关闭表；若视频根线再次只引根来源，用同一 id 重开 |
| 20261021-26 | 不改 | rejected：宿主属性非产品缺陷；用户再要严格盲测时，前提写进该测试自己的计划（关闭记忆加载、首个研究调用前读转录开头确认无注入历史） |
| 20261107-49 | 现在修 | B7 修复中：删去 market/sources.py 两个无人传入的 workers 参数 |
| 20261112-23 | 现在修 | B8 修复中：逐题复判确认后，从 user-first-miss 删除 Q2 及题面里关于目标顺序的叙述；research-start 的歧义另立 20261113-02 |
| 20261112-15 | 现在修 | B9 修复措辞；计数规则仍待测：对 dow-theory-btc-eth 每个研究运行只读跑 hypothesis compare，按 R0 现行/R1 回撤区间不含零也算区分/R2 与对照完全相同的运行不计/R3 可检测差大于目标差距的运行不计重放到期次数；R2 减少至少一次提示才采纳，R1 需回撤预测与 MARK 回撤同号≥4/5，R3 只报告用户；任何计数改动单独 PR 并先报用户 |
| 20261105-38 | 已修 | fixed 0617d4007 [#2672](https://github.com/qOeOp/trade/pull/2672)；研究会话在未跑过的合约上登记来源时即 verified |
| 20261107-143 | 待用户 | 待用户决定：Live 同一 run-id 重复 prepare 且传入标签已指向别的摘要时，是改为报 LIVE_RUN_CONFLICT，还是保持现状（实际运行的是第一次固定的摘要）并关闭；圆桌建议保持并关闭 |

批评者改动了主席前稿两处：20261020-38 由“现在修”改为“待用户”（它收紧了源码审查的执行方式，`AGENTS.md` 把收紧审计检查留给用户）；20261107-113 的拒绝文案不写“只加列”（没有升级命令，那样会指向不存在的路径）。

## 只存在于 /tmp 的证据

**20261031-14（verified）**。审计转储 `/tmp/audit-b5788262/behavior/regs.json`（账本提交 `pio1ucfkr3muki15rspcnf0ijl4jvqe5`）里会话 b5788262 的登记 1–25 都满足 `hypothesis.md` 的 `rationale.external` 规则：每条推导引用与本次改动相关的来源并给 DOI 与页码或图表号（如登记 5–7 引 Harvey 等 2018，8–10 引 Grossman–Zhou 与 Howden–Andreev，16–20 引 Kaminski–Lo 与 Clare 等）；新增 5 个来源包经 `evidence add` 写入；“找不到”写成“该包记录的检索未找到”（登记 6、21、24）；登记 23 写明没有新的外部来源并说明是研究者自己的选择。该会话加载了 research-sources 与 papers.md（`skill-heat.jsonl`）。b5788262 审计覆盖方法文献，未记复发。若视频根线再次只引根来源，用同一 id 重开。

**20261112-23（现在修，B8）**。`/tmp/audit-b5788262/evals-main/user-first-miss/result.json` 存的三份 `main` 答案（在 4997b5437 上跑）逐题读：Q1、Q3、Q4、Q5 三份都满足（对照先前输出核对选项、引 41 与 23 分钟、复用 20261020-07 记为 recurred、点名 Behavior and decision evidence）；三份都只在 Q2 失败。答案 0、1 把缺目标算到提问头上；答案 2 判 Agent 合规，但指出 research-start 自相矛盾（见 20261113-02）。Q2 考的是 research-start 的顺序，已由该 skill 自己的 `no-targets-asks-user` 覆盖，不是 product-doctor 的规则，所以错在题，不在 skill。删题前按 `AGENTS.md` 用 sonnet 与 haiku 逐题复判，复判表写在 B8 的 PR 里。

## 新发现

- **20261113-01** `judgment.body` 是 `TEXT`（`ledger/schema.sql:416`，65,535 字节），产品不查长度。A3 那种 187,955 字节的推荐正文存不下；超限时 Dolt 是拒绝、原始库错误还是静默截断没量过。待测：在隔离 `ledger temp` 库用 70,000 字节正文跑 `judgment add --kind recommendation`；原始错误或截断即为产品缺陷。
- **20261113-02** research-start `SKILL.md:83-86` 让新起点带上 Goal 目标、“一次选择同时批准线与 Goal”，`:112-118` 用用户的两个目标组成 Goal，`:101-102` 却在用户选完线之后才要目标；b5788262 因此多等 41 分钟。修复见 B10。
- **20261113-03** `report/graph.py:408` 与 `ide/web/src/model/types.ts:119` 说图里的 gates “按 `research state` 给出”，实际 `graph.py` 只取 `register.require_line_records`，没有 `research state` 另给的 `RUNTIME_UNSUPPORTED` 与 `MARKET_DAY_UNRESOLVED`。Agent 经 `research state` 会遇到这两道门，所以只改注释（B11）；图里要不要带上 `RUNTIME_UNSUPPORTED` 留给以后的 doctor。

## 待测（以后的 doctor 接手）

- **20261023-03**：(1) 同 20261113-01 的隔离探针；(2) 从旧账本只读副本与 gen-1 账本量每条线首个推荐的正文字节数、正文里权衡的他线候选数，以及推荐版本或所写取舍是否来自他线（11-07 数据：99f6 做了 122 次他线比较、ab8e 40 次，选中他线候选 0 次）。任一正文超过 32 KB、探针截断，或他线权衡从未改变推荐，则把 `research-round/references/review.md:12-13` 改为首个推荐只权衡 `candidates` 与表中未被支配的他线候选（约 +12 词），`all-comparable-candidates` 的 Q1 另开 PR；否则作为可接受成本关闭。
- **20261112-15 的计数规则**：B9 只改措辞。对 `dow-theory-btc-eth` 每个研究运行只读跑 `hypothesis compare`，按 R0 现行、R1 回撤区间不含零也算分出、R2 与对照逐日相同的运行不计、R3 可检测差大于目标差距的运行不计，重放到期次数。R2 至少少一次提示才采纳；R1 要回撤预测与 MARK 回撤同号至少 4/5；R3 只报告给用户。任何计数改动单独开 PR，合并前先报用户（用户 11-12：计数规则不变，量过再定）。
- 以后核对即可标 `verified` 的：20261107-121 首次真实验证登记后 `ledger review` 的 `validations_checked ≥ 1` 且 Live review 列出该验证；20261101-05 真实会话首次到期换思路时消息含两个目标与可检测年化差；20261107-134 在 `main` 上用 axe-core 跑 Market 页明暗两版，对比度违规为 0。

## 待用户

1. **20261107-102 字体授权**：MIT LICENSE、第三方声明与 SBOM 已齐。剩下的是 PP Supply Mono 的授权是否允许在公开仓库、公开 IDE 镜像与公开文档站分发 `.otf`。允许则加 `ide/web/fonts/LICENSE` 并改 `THIRD_PARTY_NOTICES.md` 后关闭；字体文件与字族顺序不动。
2. **20261107-143 Live 重复 prepare**：同一 run-id 再次 prepare 时，传入的标签若已指向另一个摘要，现在不报冲突，实际运行的仍是第一次固定的摘要。改为 `LIVE_RUN_CONFLICT`，还是保持并关闭？圆桌建议保持并关闭。用户 11-07 的前提（#2399 合入）已满足。
3. **20261020-38 源码审查简报**：简报只写四项检查的名字，含义由审查者读 skill，简报不带以前的结论或作者看法。判定标准不变，但收紧了审查的执行方式，需用户批准；圆桌建议批准。

## 修复批次

| 批次 | 发现 | 内容 |
|---|---|---|
| B2 | 20261031-09 | 桌面研究线菜单逐线显示推荐与目标判定 |
| B3 | 20261107-113 | `SCHEMA_MISMATCH` 下一步不再说重建账本 |
| B4 | 20261105-08 | 设计站写明 paper 库也有本机 `dolt_backup` |
| B5 | 20261105-04 | readiness 写明唯一镜像由 `replay precheck` 检查 |
| B6 | 20261105-14 | 按消息区分 `REPRODUCTION_MISMATCH` |
| B7 | 20261107-49 | 删去 `market/sources.py` 两个无人传入的 `workers` 参数 |
| B8 | 20261112-23 | `user-first-miss` 删去考 research-start 顺序的 Q2（评分器单独 PR） |
| B9 | 20261112-15 | 仓位大小同比缩放效应与可检测差 |
| B10 | 20261113-02 | 缺目标时在提供线的同一个问题里要 |
| B11 | 20261113-03 | 图的 gates 注释写明只含登记门 |

各批次的 PR 与合入提交记在 [index.zh.md](index.zh.md) 对应行。

## 结果

各批次已合入：B2 dd58353b9 [#2832](https://github.com/qOeOp/trade/pull/2832) + 679879ab3 [#2840](https://github.com/qOeOp/trade/pull/2840)、B3 8f4aac19f [#2836](https://github.com/qOeOp/trade/pull/2836)、B4 249b1389a [#2842](https://github.com/qOeOp/trade/pull/2842) + c8005e73b [#2846](https://github.com/qOeOp/trade/pull/2846)、B5 168bc09b3 [#2831](https://github.com/qOeOp/trade/pull/2831)、B6 3b18b4798 [#2835](https://github.com/qOeOp/trade/pull/2835)、B7 fe69ee7f5 [#2843](https://github.com/qOeOp/trade/pull/2843)、B8 99cc79ee0 [#2837](https://github.com/qOeOp/trade/pull/2837)、B9 75f61ab87 [#2834](https://github.com/qOeOp/trade/pull/2834)、B10 8bb6e5837 [#2833](https://github.com/qOeOp/trade/pull/2833)、B11 27d678dca [#2841](https://github.com/qOeOp/trade/pull/2841)。

- B6、B9、B10 新写的评测在新旧文本下都通过、分不出差别，按规则未收；三处只改 skill 文本。B8 删题前的复判 sonnet 符合门槛、haiku 在 Q3–Q5 判否；#2833 让原 Q2 的前提与 skill 矛盾，按“改 skill 弄错的题单独 PR 修”合入，`main` 上 0/3 → 分支 3/3。
- B2 第一版（#2832）未经审美复查即合入，用户看图说“组合起来布局丑不协调”。独立审美审查四轮后（对齐的列表、目标写进表头、只给未达目标着色、按开着与关闭分组）合入 #2840；用户另提两条尝试：去掉线菜单里的“Back to the axis start”被采纳（Home 键、命令面板、状态栏线名都能回轴起点），竖向分隔线被否（把行重新切成拼接的框、跨列行处断开、两侧间距不等）。
- 新立 20261113-05（`move-runs-before-rebuild` 的 Q3 在 `main` 上就不过）与 20261113-06（亮色 `--misses` 对比度不足，待用户）。

## 待用户项的结果

用户 2026-11-13 答：“字体你别管 你永远不许修改现在正在使用的字体 其他几个开圆桌会议做决断”。

- **20261107-102 字体授权**：用户自管，`rejected`，不改任何字体文件、字族或授权文字，以后的审计不再把字体授权列为发现或问题。
- 其余三项由第二次圆桌（三个视角各自提案、批评者在 `origin/main` 核对、主席裁决）决定，全部采纳修改：
  - **20261107-143**：重复 prepare 只要传了 runtime 且不等于首次固定的摘要（含任何标签）即 `LIVE_RUN_CONFLICT`，按字符串比较、不访问镜像仓库；产品路径本来只传摘要，行为不变，这是纵深防护。新子用例在旧代码上失败、改后全量 1737 个测试通过。372293b05 [#2858](https://github.com/qOeOp/trade/pull/2858)。
  - **20261020-38**：源码审查简报只写 api/causal/activity/readiness 四项名字，含义由审查者读 research-round，简报不解释任何一项、不带以前判定或作者看法；判定标准不变。本 id 的评测 `reviewer-reads-no-memory` 新文本 3/3、旧文本 0/3，逐题复判两模型都在“只给名字”一题上区分。80c363751 [#2856](https://github.com/qOeOp/trade/pull/2856)。
  - **20261113-06**：标记仍用验证色 `--misses` #C28013，文字改用 `--misses-fg` light-dark(#975A02, #CB8923)，四种底色上均 ≥4.5:1（亮 4.59–5.56，暗 4.88–5.96）。暗色原值在 popup 与 frame 上也只有 4.37，原发现“暗色没问题”不成立。圆桌给的亮色 #875806 在第一轮审美复查被否（偏橄榄棕、比 meets 与 fail 文字都重），改为 #975A02 后通过。axe-core 4.10.3 在线菜单、Runs、Paper 选择器、History 与手机两页明暗都是 0 个 misses 文字违规。涨跌色与字体未动。dfc708fbd [#2857](https://github.com/qOeOp/trade/pull/2857)。
- 新立 20261113-07：同类的 meets、fail、recommended 文字色与 misses 标记对比度不足，照 -06 的拆法以后修；涨跌色由用户定，不在内。
