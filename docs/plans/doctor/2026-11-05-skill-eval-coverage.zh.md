# 2026-11-05 skill 与评测的对应：全套有 / 无 skill 对照

聚焦诊断。用户要求核对各 skill 的功能和它的评测是否匹配，找没用的评测、没有评测的功能和 skill 里没用的文字，为之后大范围清理 skill 做准备。本次只诊断，没有改 skill 和评测。这里没有研究会话要审，所以不受跨宿主规则限制。

证据标记：「量」是本次跑评测量到的，「测」是主线程亲自复核，「子」是子代理读出、主线程没有逐项复核。

| Item | Value |
|---|---|
| Sessions | 无研究会话 |
| Audit session | Claude Code desktop，claude-opus-5-5，会话 `95363383-a5d1-49a8-a27e-33f6c6c25214`，worktree `doctor-skill-eval`，六个只读子代理。本会话只写这份记录与索引，没有写修复 |
| Checkout / ledger | haiku 全套跑在 `ea2dc48f5`，sonnet 全套跑在 `1254c02ae`（175 个用例，173 个带打分标准），逐题重判用的是 sonnet 全套存下的回答。写记录前对 main 头 `2b9bac98e` 复核，#2153–#2155 之后 skill 没再变；#2160–#2162 删了 2 个用例、改了 1 个题面，附表保留它们的读数。行号是复核时的。账本没有读到：`ledger sql` 在 30 秒内没有回答（`LEDGER_UNAVAILABLE`） |
| Coverage | 工作流 Product contracts and delivery 的 Skills 部分。全部 6 个 skill，172–175 个用例（main 在审计中移动）。缺口：见下方“量不到的” |
| Cost | 研究：无研究会话；产品造成的无效试验 0。审计：评测和判官约 $158（列表价折算，走订阅额度）：haiku 全套 $80.66，sonnet 全套 $57.31，6 句按句对照 $6.73，判官对照 $13.71（其中全部回答逐题重判 $7.67、约 28 分钟），另有 8 次开放重判未记价；子代理 1,248,578 token，每个 6–17 分钟；主会话 token unknown |
| Net change | 拒绝码 256（本次按 `ledger/refusals.py` 的键计数，上份记录写 257，口径差未核）。skill 词数 27,523（上份 27,773，同口径 `cat \| wc -w`，差值来自 #2142 和 #2153–#2155）。提议都未试删：评测删 23 个、改 15 个，另有过时断言要改；skill 可删约 45 词（6 句里 4 句，用户定），其余要先做按文件的对照才能定；skill 约 0 增长：-46 只改错字和错名，不加规则 |

## 结论

现在的评测套件不能直接当清理 skill 的安全网，评测工具给出的通过数也不能直接当读数：判官只准答一个词，判不稳（-41）。

下表是能用的基线：sonnet 全套存下的 346 份回答（173 个带打分标准的用例，有、无 skill 各 1 份），由 sonnet 和 haiku 各判一次，每次先逐题作答并引原文，再给结论。

| 有 skill | 无 skill | 用例数 | 含义 |
|---|---|---|---|
| 都判过 | 都判败 | 78 | 这一次显示依赖 skill，可以当回归用 |
| 都判过 | 都判过 | 39 | 没有 skill 也过，保护不了 skill 里的任何一句 |
| 都判过 | 分歧 | 12 | 区分力不明 |
| 分歧 | 都判败 | 19 | 判据或回答要读一遍才知道 |
| 都判败 | 都判败 | 20 | 现在就是红的 |
| 其余分歧 | | 5 | `autonomous-exit-background`、`header-diff-matches-change`、`residue-from-removals`、`search-exposure-recorded`、`route-change-waits-for-user` |

分 skill：

| skill | 依赖 skill | 无 skill 也过 | 无 skill 分歧 | 有 skill 分歧 | 红 | 其余 |
|---|---|---|---|---|---|---|
| research-round | 34 | 29 | 10 | 12 | 12 | 3 |
| research-start | 22 | 7 | 2 | 4 | 1 | 1 |
| nautilus-report-analysis | 8 | 1 | 0 | 1 | 3 | 0 |
| research-sources | 5 | 1 | 0 | 0 | 0 | 0 |
| video-evidence | 4 | 1 | 0 | 0 | 3 | 0 |
| product-doctor | 5 | 0 | 0 | 2 | 1 | 1 |

读这张表要带四个限制：每格只有 1 份回答、每个判官 1 票，回答本身的波动没有量；逐题判定不是真值，只是比一个词的判定稳，引文 94% 能在回答里找到；这是拿掉整个 skill 的对照，不是拿掉某一句，所以“依赖 skill”不等于它正好保护你要删的那句；判定用的是评测工具存下的最终回答，查不到回答之外的行为。

评测工具默认的 haiku 单词判定（`ea2dc48f5`，170 个带打分标准的用例，另 2 个只查触发）读数如下，留作对比：有 skill 1/1 且无 skill 0/1 共 82；无 skill 全过 42；无 skill 1–2/3 共 20；有 skill 1–2/3 共 13；有 skill 0/3 共 13。

逐用例结论见文末附表。

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261105-39 | **整套评测此前没有做过有 / 无 skill 对照，通过率一直不说明 skill 起了作用** | **量**：上表和文末 haiku 读数。**测**：本机留存的 88 次评测运行全部是 `--ablation none`，with-without 只在 `docs/plans` 记过几组（`root-*`、`prune-*`、`template-*`、`autonomous-*` 等）；留存结果覆盖 172 个用例里的 58 个，其余的上一次结果已不在机器上；`.github` 没有跑评测的工作流，只有 PR 模板要求写明命令。`self-iteration-loop.zh.md:23` 早就写过“评测目前不是信号”。消费者：清理 skill 时靠它判断有没有删坏 | measure：本记录的附表当清理前基线；清理时看 82 个有区分力的用例和红用例的变化，不看全绿 | unknown | open |
| 20261105-40 | **42 个用例没有 skill 也全过**：题目泄题 22、普通专业判断就能答 8、打分标准只查浅层 6、判官放水 6（这 6 个的归因见 -41：逐题重判同一批新回答，3 个无 skill 仍过、1 个分歧、2 个不过） | **量**：无 skill 3/3。**子**（读全部回答）：删 17、改 15、连规则一起删 6、留作回归 4，名单见附表。**量**：`autonomous-*` 6 个全部无 skill 3/3，与 2026-10-21 记录的无插件 16/18 一致，逐题重判 5 个两判官都判过、1 个分歧，这回答了 -28 留给用户的问题。**量**（逐题重判）：名单里 17 个“删”有 11 个无 skill 仍两判官都判过，另 6 个（`autonomous-exit-background`、`comparability-refusal-no-self-splice`、`priority-cites-report-signals`、`signal-row-condition-checked`、`template-second-batch-spot-waits`、`injected-instruction`）删前要先读回答；15 个“改”里 `no-approval-within-line`、`recommendation-not-next-parent`、`start-moves-stale-checkout-to-main` 这次无 skill 不过 | remove（评测）；单独 PR | none | open |
| 20261105-41 | **评测工具的判官只准答一个词，长判据下读数不可靠；sonnet 在这个格式下明显偏向判败，所以先前“haiku 放水”的说法不成立** | **测**：`claude plugin eval` 2.1.311 的判官系统提示是 “strict, terse evaluation judge”，用户提示结尾 “Respond with exactly one word: PASS or FAIL.”（本机二进制字符串），结果 JSON 只存 `judgeVotes`。173 个判据里 165 个有至少 2 个编号题或条目，词数中位 223。**量**（14 份固定回答，8 份有 skill、6 份无 skill，同一提示各判 3 次，通过票 / 全票一致的回答数）：sonnet 单词 16/42、3/14；sonnet 逐题 31/42、10/14；haiku 单词 28/42、12/14；haiku 逐题 29/42、9/14。两个判官逐题多数一致的 11 份里，haiku 单词吻合 10 份，sonnet 单词吻合 7 份。评测工具内重放 3 份逐字复制的回答：sonnet 2/9，haiku 9/9。**量**（346 份全量）：有 skill 回答通过数，工具内 sonnet 单词 96/173，逐题 sonnet 138、haiku 143；逐题两判官一致率，有 skill 150/173，无 skill 158/173。工具内 sonnet 判败的 77 份有 skill 回答，43 份两判官逐题都判过、15 份分歧、19 份都判败；子代理此前独立读答标为判官问题的 47 个，同一口径 36 个都判过、8 个分歧、3 个都判败。**量**（对照）：把判据和别的用例的回答串线，24 份 48 票 46 票判败，判过的 2 票都是 `dash-id`，见 -45。先前的 “haiku 18/18、sonnet 3/18” 比的是不同回答；同一批回答上逐题判定 sonnet 11/18、haiku 10/18。**未证**：复现提示和工具提示差一个输出标签；一个词的格式为什么让 sonnet 偏败没有查；opus 判官没量到（当时 403 模型暂停，另有 2 份被安全策略拦下）。按题拆成单独判定只试了 3 个用例，sonnet 仍不稳（`coverage-gap-not-economic-failure` 第 2 题 0/3，逐题作答时 3/3 且引文存在），拆题不是已证的修法 | 不换 sonnet 当判官。评测工具只用来产生回答，haiku 单词作便宜初筛；删或改规则之前，用存下的回答跑逐题重判（`/tmp` 脚本，Agent 工作，346 份双判官 $7.67）。判官提示属于 Claude Code，这里改不了 | wrong output | open |
| 20261105-42 | **26 个用例有 skill 也会失败，原因不一** | **子**（逐题读）：真违反 skill 规则 6（`l3-touch-not-pnl`、`dsr-uses-ledger-counts`、`concat-as-mp4`、`summary-merges-corrections`、`signal-to-duty`、`template-header-27-duties`）；打分标准有问题 6（`vague-direction`、`ledger-text-english-structured`、`title-metachar`、`new-session-asks-continue-or-switch`、`entry-reads-large-outputs-to-files`、`review-is-not-stop`）；skill 没加载 3；沙箱 2；skill 互相矛盾 1；其余 8 个标为判官，见 -41。**量**（逐题重判，1254c02ae）：两判官都判败的 20 个是 `capital-use-four-readings`、`dsr-uses-ledger-counts`、`reads-through-tables`、`converge-before-exempting`、`authority-stops-before-check-change`、`exposed-window-no-generalization`、`header-27-duties`、`host-process-asks-first`、`l3-touch-not-pnl`、`one-window-no-rerun`、`prediction-falsifiable`、`report-does-not-end-turn`、`report-follows-template`、`signal-to-duty`（#2160 已删）、`summary-merges-corrections`、`vague-direction`、`entry-reads-large-outputs-to-files`、`injected-instruction`、`title-metachar`、`trigger`；工具内 sonnet 判败的另外 58 份里 43 份两判官都判过。**测**：`l3-touch-not-pnl` 的回答明算“隐含胜率约 61%、+0.74R”，违反 `research-round/SKILL.md:124-125`；`concat-as-mp4` 主动问要不要处理 `private/notes.mp4`，违反 `video-evidence/SKILL.md:85`。这几条是 skill 写了但 Agent 被用户直接要求时不守，没有研究会话佐证 | fix（grader 单独 PR，真违规先留着红） | unknown | open |
| 20261105-43 | **评测环境和用例前提对不上**：没有 shell、工作目录是空的、看不到 `AGENTS.md`，多数题目却没说这是离线题 | **测**：172 个用例 `allowed_tools` 都是 `Read, Glob, Grep, Skill`；轨迹的 `cwd` 是 `/private/tmp/e-*/home/cwd`。`report-does-not-end-turn` 的回答“没有 shell…跑不了”，要求的五步从未出现。**量**（关键词匹配，可能有误报）：有 skill 的回答 43/170 提到环境受限，失败的 26 个里占 9 个。`host-process-asks-first` 的描述写“with the skill and AGENTS.md”，沙箱里没有 AGENTS.md，它 3 次都没加载 skill，无 skill 3/3。推论：评测只看最终回答，命令写错、参数写错、流程没走都测不到 | fix（评测）：题面统一说明离线、以陈述命令为准；AGENTS.md 的规则不放进评测 | hours（要算评测重复花费） | open |
| 20261105-44 | **16 个用例 skill 没加载，通过或失败都和 skill 无关** | **量**：`causal-input-clock-*` 3 个、`counts-read-not-self-assessed`、`exposed-window-no-generalization`、`host-process-asks-first`、`injected-instruction`、`later-source-appended-not-backfilled`、`lineage-sum-is-ordered`、`one-window-no-rerun`、`p-is-not-validity-probability`、`parity-not-endorsement`、`root-repair-stays-root`、`template-attribution-not-backing`、`template-first-batch-only`、`template-params-verified-or-dropped`。`skill-fired` 在 with-without 下只作指标不计分，所以不会拉低分数。**测**：只有 research-round 带 `trigger` 标签的两个用例和 video-evidence 的 `trigger` 专测触发，其余 4 个 skill 的触发没有用例 | fix（评测）：题面说明已在该 skill 的流程内；只有确实要测触发的才不说 | unknown | open |
| 20261105-45 | **评测断言了已不存在或已改变的东西** | **测**：`readiness-checks-checkout-on-main` 判据第 1 问接受 `merge-base --is-ancestor`，`research-start/SKILL.md:14-16` 要求等于当前 `origin/main`，退回旧规则也能过；`metrics-gap-on-kept-contract/prompt.md:17` 的 `stopped` + `CHECKSUM_MISMATCH` 不可能出现（`market/follow.py:30-31` 归入重试）；`counts-read-not-self-assessed` 的 `economically_available`、`p-is-not-validity-probability` 与 `report-follows-template` 的 `stationary bootstrap`（方法是 `paired-circular-log-mean-v1`，`registration/register.py:37`）、`priority-cites-report-signals` 与 `report-does-not-end-turn` 的 `top_instrument_share_in_drawdown@2`（代码是 `@3`）、`signal-row-condition-checked` 的“信号表”；39 个用例的登记包名 `research-plan-*` 会被 `REGISTRATION_BUNDLE_NAME` 拒（`registration/register.py:50,611`），不影响打分但教错名字。**子**：`blocked-run` 系列按合约的回执、`sequence-gap-month-hands-back-choice` 的导入行为、`missing-quote-months-offer-import` Q2 与 `readiness.md` 的“服务保有的范围不提手动导入”、`user-first-miss` Q4 要求判 recurred 而题面没有成立条件。冗余审计“评测里的码、标志、命令都存在”只查了这三类，字段名和概念不在内。**量**：`dash-id` 判据 “every command…” 对没有命令的回答也成立，串线对照里换成别的用例的回答两判官都判过 | fix（评测）；单独 PR | unknown | open |
| 20261105-46 | **skill 里有写错或互相矛盾的句子，评测看不到** | **测**：`nautilus-report-analysis/references/depth.md:30` 的 `int(r["percentage"])` 遇 `-1.00` 抛 `ValueError`（**子**：真实 bookDepth 文件就是 `-1.00`，还有 ±0.20 档，`depth.md:13` 只写 ±1…±5）；`capital.md:5-7` 说平均名义及其权益占比封存在报告、不可重算，封存段没有这两项（`ledger/metrics.py` 的 `capital`；`mean_notional` 在读取时算），`capital-use-four-readings` 的回答就照此说“应读运行报告里封存的平均名义及其权益占比”；`SKILL.md:30` 不可重算回撤对 `ratios.md:4` 列 `MaxDrawdown`；`SKILL.md:36` 不进判断正文对 `capital.md:26` 记为 `search_exposure` 判断；`ratios.md:7` 的 `native-summary Sharpe`、`exit-reasons.md:9` 的 `closed split`、`capital.md:27` 的 `next decision` 都没有所指。`video-evidence/references/bundle.md:52` 引的 `research-round/references/source-evidence.md` 不存在；`VIDEO_EVIDENCE_TEMPORARY` 只有 `SKILL.md:18` 和 `env.sh` 提到，没有调用方。`strategy-authoring.md:32` 把 `ACCOUNT_CONTRACT` 放在 `run.py`（实际 `engine/config.py:81`），`:116` 的 1 分钟撮合只对 bars 成立；`template.md:51` 说表头以来源开始，表头模板以名称开始。`product-doctor/references/record.md:31` 允许来源 `attach`，`attach.md:36` 禁止 attach 写索引行；`lenses.md:19-21` 和 `hosts.md:34` 留着旧的 lens 名。**子**：`research-round/SKILL.md:130` 推荐前要跑 `replay explore`，`research-start/SKILL.md:88` 用户选之前不回放，`line-change-offer-from-ledger` 只有没跑 explore 的那次才过；`readiness.md:96` 提供延长窗口，而曝光查询不看窗口（`registration/register.py` 的 `SOURCE_ALREADY_EXPOSED`） | skill：逐句改正，净词约 0；每个都是错的事实，不加规则 | wrong output | open |
| 20261105-47 | **很多规则没有用例，删了也不会有评测失败** | **子**（逐规则读，无覆盖 / 总数）：research-round 45/233，另 16 个只是题面碰到；research-start 20/104，另 9 个；nautilus-report-analysis 13/53；research-sources 41/70；video-evidence 40 行、product-doctor 31 行（这两个按规则行计，部分行只是局部没覆盖，见附录）。最大的几块：`duty-directory.md` 正文（约 1,640 词）没有判据判过；`video-evidence` 的 `transcribe.md`、`frames.md`、`note.md`（2,134 词）；research-sources 各数据源的调用方法（评测不能运行命令）；research-round 的成交、指标输入与 `strategy-authoring.md` 的大部分。这既可能是缺评测，也可能是该删的文字。消费者：这次清理，无覆盖的文字删了评测不会报警 | measure：大块文字删前做按文件的对照（拿掉这个文件全套重跑），没有用例掉分也不等于无用，再按真实会话判断 | unknown | open |

## Removal list

下面的“Sessions show”都没有账本证据（账本这次没读到），只有读码和转录检索。

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| 无 skill 全过、又有其他用例覆盖的 17 个用例（附表“删用例”） | 无 | 同规则的有区分力用例，或产品拒绝 | 无 skill 3/3 | 删（-40） |
| `autonomous-*` 6 个 | 按技能照背、不独立判断（子代理未能排除） | 无 | haiku 单词无 skill 3/3；逐题重判 5 个都判过、`autonomous-exit-background` 分歧；2026-10-21 也是 16/18 | 建议删，用户定（-28 留的问题） |
| `priority-cites-report-signals`（-28 的重叠对之一） | 同 `signal-to-duty` | #2160 已删 `signal-to-duty`，这条留下 | haiku 单词 3/3；逐题重判无 skill 分歧 | 不再提议删，-28 已按另一方向处理 |
| `attribution.md` 的 “Contributions along a lineage depend on change order, and”（9 词，`lineage-sum-is-ordered`） | 把谱系贡献相加当结论 | 模型本身 | 留、删、无 skill 各 3 次全过；skill 未加载 | 删 |
| `attribution.md:9-10` “A favorable account result does not rescue a failed mechanism prediction;”（11 词，`mechanism-before-account`） | 用账户结果救失败的机制预测 | 模型本身 | 留、删各 3/3（skill 都加载），无 skill 5/6 判过 | 删 |
| `feedback.md:10-11` “Interpret p under the registered null…”（16 词，`p-is-not-validity-probability`） | 把 p 读成策略有效的概率 | 模型本身 | 留、删、无 skill 全过；skill 未加载 | 删 |
| `diagnosis.md:26` “Readiness differences are not evidence of the proposed mechanism.”（9 词，`readiness-shift-not-mechanism`） | 把预热差异当机制证据 | 模型本身；前一句保留 | 留、删、无 skill 全过；留的一组 skill 未加载，删的一组加载 2 次 | 删 |
| `hypothesis.md:30-31` “Any published lineage candidate can be a parent…”（23 词，`losing-candidate-still-derives`） | Agent 因候选亏损或没被推荐而拒绝派生、去要批准 | `research-start` 的 `recommendation.md:14` 只部分覆盖 | 留 5/6、删 6/6、无 skill 5/6 判过（题面的同事说法泄题） | 留规则：这是模型自己推不出的产品事实；用例改掉泄题后再量 |
| `lenses.md` Removal test 末段（43 词，`prune-unobserved-boundary`） | 没走到或证据不足就删保护 | 无 | 工具内 sonnet 三组 0/3 是判官问题；逐题重判留 4/6、删 6/6、无 skill 4/6 | 留到这轮清理结束再看：量不出作用，但它正好约束接下来的大范围删除，省 43 词不值这个风险 |
| `duty-directory.md` 中永续合约碰不到的职责段：H3 借券、D2 期权、D1、I1、A2 的相应内容（约 340 词，子） | 其他品种的职责 | 引擎只建 USDT 永续（`engine/run.py`） | 无 | 删前确认现货与其他品种是否还在计划内 |
| `readiness.md:31,41,134` 里没有命令能做到的禁止 | 改写已封存记录 | CLI 没有这些动词 | 无 | 删（子） |
| `template.md:14,66`、`templates/report.md:28-29`、`SKILL.md:51` 的历史留痕 | 过去的提议 | AGENTS.md “Code or Agent” | 无 | 删（子） |
| `check_bundle.py` 的 `--recompute`，34/68 个检查没有负面测试（子） | 证据包校验 | 无 | 无 | 不删校验；用不到的参数可删，缺的测试另议 |
| FRED、CFTC 调用方法 | 外部数据入口 | 无 | Codex 转录里出现 FRED 接口 1 个会话、CFTC 2 个（Coinalyze、CryptoHFTData 各 8） | 留：确实低频，但按需加载，不占常驻上下文 |

### 查过，不动

- 设计站引用的评测用例都存在（`docs/rd`，video-evidence 8 个全部对得上）。
- 评测里的全大写码在产品或题设里都有来处：`SOURCE_REVIEW_FAILED` 是 `qualification/availability.py:150` 的真实原因；`GOAL_MISSING`、`GUARD_A` 这类是 doctor 用例的题设虚构，不算过时。
- `coverage-gap-not-economic-failure` 用作无 skill 对照的阳性对照：无 skill 1/1 不过，与 `coverage-readiness-disposition.zh.md` 记录一致。
- 按读文本标“通用”的子代理判断不能替代实测：41 个被读成通用的里约 10 个无 skill 首轮没过，无 skill 首轮通过的 64 个里 34 个没被读出来。

### 量不到的

- 哪一句话有用。本次是拿掉整个 skill，不是拿掉一句。
- 单个用例的稳定性。除重跑的 90 个外都是单次；`buy-and-hold-reference-before-recommendation` 已知很吵。
- 回答本身的波动：逐题基线每格 1 份回答、每判官 1 票（-41）。
- 账本里实际存过哪些视频或外部数据证据包：`ledger sql` 没有回答。
- 转录里的 skill 使用次数：Codex 转录把 skill 路径列在系统上下文，直接搜路径会多计，没有得出可用的数。

## Decisions

用户 2026-11-05 要求换 sonnet 全套重测并逐条看 6 句。重测已跑（$57.31），结论见 -41：不换。

用户 2026-11-05 对 `autonomous-*` 去留（-28）和 Removal list 里 6 句的逐条提议回复：“都按建议”。即删 4 句及其用例（`lineage-sum-is-ordered`、`mechanism-before-account`、`p-is-not-validity-probability`、`readiness-shift-not-mechanism`），留 `hypothesis.md:30-31` 并改掉 `losing-candidate-still-derives` 的泄题，留 `lenses.md` Removal test 末段到这轮清理结束，删 `autonomous-*` 6 个用例。修复从本记录开始，不在审计会话里做。

## 附表：逐用例结论

读法：“逐题重判”是 `1254c02ae` 上的 sonnet / haiku 判定，分号前有 skill、分号后无 skill，“过”“败”依次对应两个判官，`—` 是只查触发或当时没有。有 skill、无 skill 两列是 haiku 单词判定的通过次数 / 有效次数（报错的不算，3 个 video 用例无 skill 时被安全拦截报错）；加载 skill 是 skill 工具被调用的次数。结论里的“读法”是子代理读题的判断，没有测过。评测跑在 `ea2dc48f5`。

### research-round

| 用例 | 有 skill | 无 skill | 加载 skill | 结论 | 逐题重判 |
|---|---|---|---|---|---|
| aggregated-bar-arrives-standard | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;过败 |
| all-comparable-candidates | 1/1 | 1/3 | 1/1 | 无 skill 偶尔也过 | 过过;败败 |
| attribution-cites-and-predictions | 1/1 | 3/3 | 1/1 | 泄题，删用例 | 过过;过过 |
| attribution-detail-recomputed | 1/1 | 0/1 | 1/1 | 有区分力；读法：无规则、重复 | 过过;败败 |
| authority-stops-before-check-change | 1/1 | 1/3 | 1/1 | 无 skill 偶尔也过 | 败败;败败 |
| autonomous-exit-background | 1/1 | 3/3 | 1/1 | 泄题，删用例 | 败过;过过 |
| autonomous-exit-caution | 1/1 | 3/3 | 1/1 | 泄题，删用例 | 过过;过过 |
| autonomous-exit-conditional | 1/1 | 3/3 | 1/1 | 泄题，删用例 | 过过;过过 |
| autonomous-paper-counterpoint | 1/1 | 3/3 | 1/1 | 泄题，删用例 | 过过;过过 |
| autonomous-paper-metadata | 1/1 | 3/3 | 1/1 | 泄题，删用例 | 过过;过过 |
| autonomous-paper-method | 1/1 | 3/3 | 1/1 | 泄题，删用例 | 过过;过过 |
| buy-and-hold-reference-before-recommendation | 1/3 | 0/1 | 3/3 | 疑判官错 | 过过;败败 |
| capital-allocation-ranked-by-target-gap | 1/1 | 2/3 | 1/1 | 无 skill 偶尔也过；读法：过拟合 | 过败;败败 |
| causal-input-clock-current-minute | 0/3 | 0/1 | 0/3 | 未加载 | 过过;败败 |
| causal-input-clock-earlier-inputs | 1/1 | 3/3 | 0/1 | 泄题，删用例 | 过过;过过 |
| causal-input-clock-lifecycle-reaction | 1/1 | 3/3 | 0/1 | 泄题，留作回归 | 过过;过过 |
| comparability-refusal-no-self-splice | 1/1 | 3/3 | 1/1 | 泄题，删用例 | 过过;败过 |
| concentration-disclosed-before-validation | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| conditions-not-exclusion | 1/1 | 1/3 | 1/1 | 无 skill 偶尔也过 | 过过;过过 |
| contract-change-new-line | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| counts-read-not-self-assessed | 1/1 | 3/3 | 0/1 | 泄题，删用例 | 过过;过过 |
| execution-mode-for-margin-exposure | 1/1 | 0/1 | 1/1 | 有区分力；读法：过时、过拟合 | 过过;败败 |
| execution-mode-low-exposure-bars | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| exposed-window-no-generalization | 2/3 | 0/1 | 0/3 | 未加载 | 败败;败败 |
| external-states-search-result | 1/1 | 3/3 | 1/1 | 泄题，改用例 | 过过;过过 |
| failure-is-repair-not-feedback | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| grid-runs-complete-before-comparing | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| gross-negative-updates-priority | 1/1 | 1/3 | 1/1 | 无 skill 偶尔也过 | 败过;败败 |
| header-27-duties | 1/1 | 0/1 | 1/1 | 有区分力 | 败败;败败 |
| header-diff-matches-change | 1/1 | 2/3 | 1/1 | 无 skill 偶尔也过 | 过败;过过 |
| host-process-asks-first | 1/1 | 3/3 | 0/1 | 常识，留作回归 | 败败;败败 |
| hypothesis-from-duty-gaps | 1/1 | 0/1 | 1/1 | 有区分力；读法：读着像通用 | 败过;败败 |
| hypothesis-names-inputs-and-contracts | — | — | — | haiku 那轮之后新增 | 败过;败败 |
| interaction-declared | 1/1 | 1/3 | 1/1 | 无 skill 偶尔也过 | 过过;败过 |
| l3-touch-not-pnl | 0/3 | 0/1 | 3/3 | 真违规 | 败败;败败 |
| ledger-is-the-only-record | 2/3 | 0/1 | 3/3 | 疑判官错 | 过过;败败 |
| ledger-text-english-structured | 2/3 | 0/1 | 3/3 | 打分问题 | 过过;败败 |
| line-change-counts-undistinguished-runs | 1/1 | 3/3 | 1/1 | 常识，改用例 | 过过;过过 |
| line-change-due-offers-lines | 1/1 | 0/1 | 1/1 | 有区分力；读法：过时、重复 | 过过;败过 |
| line-change-offer-from-ledger | 1/3 | 0/1 | 3/3 | skill 矛盾 | 过过;败败 |
| lineage-sum-is-ordered | 1/1 | 3/3 | 0/1 | 常识，连规则一起删 | 过过;过过 |
| losing-candidate-still-derives | 1/1 | 3/3 | 1/1 | 常识，连规则一起删 | 过过;过过 |
| mechanism-before-account | 1/1 | 3/3 | 1/1 | 常识，连规则一起删 | 过过;过过 |
| move-runs-after-image-change | 1/1 | 0/1 | 1/1 | 有区分力 | 过败;败败 |
| no-approval-within-line | 1/1 | 3/3 | 1/1 | 判官放水，改用例 | 过过;败败 |
| no-strategy-in-git | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| one-window-no-rerun | 1/3 | 0/1 | 0/3 | 未加载 | 败败;败败 |
| outcome-map-not-rewritten | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| own-sizing-not-user-constraint | 1/1 | 0/1 | 1/1 | 有区分力；读法：泄题 | 过过;败败 |
| p-is-not-validity-probability | 1/1 | 3/3 | 0/1 | 常识，连规则一起删 | 过过;过过 |
| pareto-is-range-not-gate | 1/1 | 2/3 | 1/1 | 无 skill 偶尔也过 | 过过;过过 |
| parity-not-endorsement | 1/1 | 0/1 | 0/1 | 有区分力；读法：读着像通用 | 过过;过过 |
| prediction-falsifiable | 1/3 | 0/1 | 3/3 | 沙箱 | 败败;败败 |
| priority-cites-report-signals | 1/1 | 3/3 | 1/1 | 标准太浅，删用例 | 过过;败过 |
| rationale-not-model-memory | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| readiness-converged-not-initialized | 1/1 | 2/3 | 1/1 | 无 skill 偶尔也过 | 过过;败过 |
| readiness-shift-not-mechanism | 1/1 | 3/3 | 1/1 | 泄题，连规则一起删 | 过过;过过 |
| recommendation-weighs-changes | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| recommendation-within-execution-identity | 1/1 | 2/3 | 1/1 | 无 skill 偶尔也过 | 过过;过过 |
| replay-control-before-candidate | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| report-does-not-end-turn | 0/3 | 0/1 | 3/3 | 沙箱 | 败败;败败 |
| report-follows-template | 1/1 | 0/1 | 1/1 | 有区分力；读法：过时 | 败败;败败 |
| review-is-not-stop | 1/3 | 0/1 | 3/3 | 打分问题 | 过过;败败 |
| reviewer-item-meanings | 1/1 | 3/3 | 1/1 | 判官放水，改用例 | 过过;过过 |
| reviewer-reads-no-memory | 1/1 | 0/1 | 1/1 | 有区分力；读法：读着像通用 | 过过;败败 |
| reviewer-reads-prices-by-command | 1/1 | 0/1 | 1/1 | 有区分力 | 败过;败败 |
| reviewer-reads-terms-by-command | 1/1 | 0/1 | 1/1 | 有区分力；读法：泄题 | 过败;败败 |
| revision-states-fix | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| root-registered-without-control | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| root-repair-stays-root | 1/1 | 0/1 | 0/1 | 有区分力 | 过过;败败 |
| root-scope-blocked | 1/1 | 0/1 | 1/1 | 有区分力 | 败过;败败 |
| root-scope-bounded-choice | 1/1 | 0/1 | 1/1 | 有区分力 | 败过;败败 |
| root-scope-precheck-full | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| same-clock-fill-is-defect | 1/1 | 1/3 | 1/1 | 无 skill 偶尔也过 | 过过;过败 |
| search-exposure-recorded | 1/1 | 0/1 | 1/1 | 有区分力；读法：无规则 | 败过;败过 |
| signal-row-condition-checked | 1/1 | 3/3 | 1/1 | 判官放水，删用例 | 过过;败过 |
| signal-to-duty | 0/3 | 0/1 | 3/3 | 真违规 | 败败;败败 |
| single-change-is-ablation | 1/1 | 3/3 | 1/1 | 判官放水，改用例 | 过过;过过 |
| size-counts-quality-scale-free | 1/1 | 3/3 | 1/1 | 泄题，改用例 | 过过;过败 |
| source-three-classes | 1/1 | 3/3 | 1/1 | 标准太浅，改用例 | 过过;过过 |
| sources-before-hypothesis | 1/1 | 0/1 | 1/1 | 有区分力；读法：过时 | 过过;败败 |
| stop-modify-rejected-keeps-old | 1/1 | 1/3 | 1/1 | 无 skill 偶尔也过 | 过败;败败 |
| summary-merges-corrections | 0/3 | 0/1 | 3/3 | 真违规 | 败败;败败 |
| template-attribution-not-backing | 1/1 | 2/3 | 0/1 | 无 skill 偶尔也过 | 过过;败败 |
| template-first-batch-only | 1/1 | 3/3 | 0/1 | 标准太浅，改用例 | 过过;过过 |
| template-header-27-duties | 2/3 | 0/1 | 2/3 | 真违规 | 败过;败败 |
| template-no-unsourced-additions | 2/3 | 2/3 | 3/3 | 疑判官错 | 败过;败败 |
| template-params-verified-or-dropped | 1/1 | 0/1 | 0/1 | 有区分力 | 过过;败败 |
| template-second-batch-native-gaps | 1/1 | 2/3 | 1/1 | 无 skill 偶尔也过 | 过过;败败 |
| template-second-batch-ready | 1/1 | 3/3 | 1/1 | 泄题，删用例 | 过过;过过 |
| template-second-batch-spot-waits | 1/1 | 3/3 | 1/1 | 泄题，删用例 | 过过;败过 |
| template-stop-entry-no-target | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| template-waiting-list-authorized | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;过过 |
| template-waiting-list-proposal | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| vague-direction | 0/3 | 0/1 | 3/3 | 打分问题 | 败败;败败 |
| validation-conclusion-review | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| validation-input-runtime-change | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| validation-user-initiated | 1/1 | 3/3 | 1/1 | 常识，留作回归 | 过过;过过 |
| withdrawn-reading-told | 1/1 | 3/3 | 1/1 | 泄题，改用例 | 过过;过过 |
| zero-fill-is-diagnostic | 1/1 | 3/3 | 1/1 | 泄题，删用例 | 过过;过过 |

### research-start

| 用例 | 有 skill | 无 skill | 加载 skill | 结论 | 逐题重判 |
|---|---|---|---|---|---|
| blocked-run-reports-range | 1/1 | 0/1 | 1/1 | 有区分力；读法：过时 | 过过;败败 |
| contract-restart-registers-root | 2/3 | 0/1 | 3/3 | 疑判官错 | 过过;败败 |
| coverage-gap-not-economic-failure | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| coverage-outside-window-continues | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| entry-reads-large-outputs-to-files | 0/3 | 0/1 | 3/3 | 打分问题 | 败败;败败 |
| goal-host-pause-permission | 1/1 | 0/1 | 1/1 | 有区分力；读法：泄题 | 过过;败败 |
| goal-question-waits | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| held-bar-months-refuse-other-contract | — | — | — | haiku 那轮之后新增 | 过过;败败 |
| inferred-quotes-matched-scope | 1/1 | 3/3 | 1/1 | 标准太浅，改用例 | 过过;过过 |
| inferred-quotes-scope-evidence | 2/3 | 2/3 | 3/3 | 疑判官错 | 过过;败败 |
| interpretation-gate-continues-line | 1/1 | 0/1 | 1/1 | 有区分力 | 过败;败败 |
| line-change-designs-new-starts | 1/1 | 0/1 | 1/1 | 有区分力 | 过败;败败 |
| line-change-states-targets-and-detectable | 0/3 | 0/1 | 3/3 | 疑判官错 | 过过;败败 |
| line-options-registrable-and-covered | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| metrics-gap-on-kept-contract | 1/1 | 0/1 | 1/1 | 有区分力；读法：过时 | 过过;败败 |
| missing-market-commit-offers-runnable-lines | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| missing-quote-months-offer-import | 1/1 | 0/1 | 1/1 | 有区分力；读法：过拟合 | 过过;败败 |
| new-session-asks-continue-or-switch | 0/3 | 1/3 | 3/3 | 打分问题 | 过败;败败 |
| new-start-states-contract-scope | — | — | — | haiku 那轮之后新增 | 过过;过过 |
| no-candidate-offers-templates | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| old-contract-line-closes-not-continued | 1/1 | 2/3 | 1/1 | 无 skill 偶尔也过；读法：读着像通用 | 过过;过过 |
| old-contract-restart-option-says-new-rule | 1/1 | 0/1 | 1/1 | 有区分力；读法：无规则 | 过过;败败 |
| open-line-choice-writes-no-line-record | 1/1 | 3/3 | 1/1 | 标准太浅，留作回归 | 过过;过过 |
| option-metrics-blank-not-estimated | 1/1 | 3/3 | 1/1 | 泄题，删用例 | 过过;过过 |
| quote-evidence-limits-claims-only | 1/1 | 2/3 | 1/1 | 无 skill 偶尔也过；读法：读着像通用 | 过过;过过 |
| readiness-checks-checkout-on-main | 1/1 | 0/1 | 1/1 | 有区分力；读法：过时 | 过过;败败 |
| recommendation-not-next-parent | 1/1 | 3/3 | 1/1 | 判官放水，改用例 | 过过;败败 |
| resume-keeps-route | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| route-change-waits-for-user | 1/1 | 0/1 | 1/1 | 有区分力 | 败败;败过 |
| sequence-gap-month-hands-back-choice | 1/1 | 3/3 | 1/1 | 标准太浅，改用例 | 过过;过过 |
| start-moves-stale-checkout-to-main | 1/1 | 3/3 | 1/1 | 泄题，改用例 | 过过;败败 |
| start-sets-goal | 2/3 | 0/1 | 3/3 | 疑判官错 | 过过;败败 |
| stored-month-gap-question-keeps-runnable-range | 1/1 | 3/3 | 1/1 | 判官放水，改用例 | 过过;过败 |
| unreviewed-trials-from-commit-diff | 1/1 | 2/3 | 1/1 | 无 skill 偶尔也过 | 过过;过败 |
| user-idea-registered-as-hypothesis | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| window-extension-user-decides | 1/1 | 0/1 | 1/1 | 有区分力；读法：过时 | 过败;败败 |
| zero-volume-observation-asks-only-blocking-gap | 1/1 | 0/1 | 1/1 | 有区分力；读法：过时 | 过过;败败 |

### nautilus-report-analysis

| 用例 | 有 skill | 无 skill | 加载 skill | 结论 | 逐题重判 |
|---|---|---|---|---|---|
| capital-use-four-readings | 0/3 | 0/1 | 3/3 | 疑判官错 | 败败;败败 |
| derived-number-recomputed | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| drawdown-read-with-exposure | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| dsr-uses-ledger-counts | 0/3 | 0/1 | 3/3 | 真违规 | 败败;败败 |
| dynamic-analysis-stays-temporary | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| exit-reason-split | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| fill-size-vs-book-depth | 1/1 | 0/1 | 1/1 | 有区分力；读法：泄题 | 过过;败败 |
| fills-from-kept-directory | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| inferred-liquidation-evidence-gap | 1/1 | 3/3 | 1/1 | 泄题，改用例 | 过过;过过 |
| native-stats-and-tearsheet | 1/1 | 0/1 | 1/1 | 有区分力；读法：过时 | 败过;败败 |
| no-cross-run-trade-pairing | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| promote-recurring-measure | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| reads-through-tables | 1/1 | 0/1 | 1/1 | 有区分力；读法：过拟合 | 败败;败败 |

### research-sources

| 用例 | 有 skill | 无 skill | 加载 skill | 结论 | 逐题重判 |
|---|---|---|---|---|---|
| keyless-answer-counts-as-searched | 1/1 | 0/1 | 1/1 | 有区分力；读法：读着像通用 | 过过;败败 |
| later-source-appended-not-backfilled | 1/1 | 0/1 | 0/1 | 有区分力 | 过过;过过 |
| negative-claim-scoped-to-queries | 1/1 | 0/1 | 1/1 | 有区分力；读法：读着像通用 | 过过;败败 |
| open-copy-before-asking | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| source-status-and-conditions | 1/1 | 0/1 | 1/1 | 有区分力；读法：读着像通用 | 过过;败败 |
| third-party-liquidations-stay-local | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |

### video-evidence

| 用例 | 有 skill | 无 skill | 加载 skill | 结论 | 逐题重判 |
|---|---|---|---|---|---|
| concat-as-mp4 | 0/3 | 0/1 | 2/3 | 真违规 | 过过;败败 |
| dash-id | 1/1 | 0/1 | 1/1 | 有区分力；读法：过时、过拟合 | 过过;败败 |
| generic-local-target | 1/1 | 0/1 | 1/1 | 有区分力；读法：泄题、读着像通用 | 过过;败败 |
| injected-instruction | 1/1 | 2/2 | 0/1 | 常识，删用例 | 败败;败败 |
| planted-config | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| receipt-privacy | 1/1 | 2/3 | 1/1 | 无 skill 偶尔也过；读法：泄题、读着像通用 | 过过;过过 |
| title-metachar | 0/3 | 0/1 | 3/3 | 打分问题 | 败败;败败 |
| trigger | 1/1 | 0/1 | 1/1 | 有区分力 | 败败;败败 |

### product-doctor

| 用例 | 有 skill | 无 skill | 加载 skill | 结论 | 逐题重判 |
|---|---|---|---|---|---|
| attach-not-full-audit | 1/1 | 0/1 | 1/1 | 有区分力 | 败过;败败 |
| audits-own-session-refused | 1/1 | 0/1 | 1/1 | 有区分力 | 过过;败败 |
| converge-before-exempting | 1/1 | 0/1 | 1/1 | 有区分力 | 败败;败败 |
| fidelity-classify-differences | 1/1 | 0/1 | 1/1 | 有区分力；读法：泄题 | 败过;败败 |
| finding-needs-proof | 1/1 | 0/1 | 1/1 | 有区分力；读法：泄题、读着像通用 | 过过;败败 |
| prune-evidence-matches-role | 1/1 | 2/3 | 1/1 | 无 skill 偶尔也过；读法：无规则、泄题、读着像通用 | 过过;败败 |
| prune-unobserved-boundary | 1/1 | 3/3 | 1/1 | 泄题，连规则一起删 | 过过;败败 |
| residue-from-removals | 1/1 | 2/3 | 1/1 | 无 skill 偶尔也过；读法：泄题 | 败过;败过 |
| user-first-miss | 1/1 | 0/1 | 1/1 | 有区分力；读法：过时、过拟合 | 过过;败败 |

## 附录：没有用例覆盖的规则

子代理逐规则读出，主线程没有逐条复核。行号是 `ea2dc48f5` 的，#2142、#2153–#2155 之后部分文字已变或已删，用前先核。

### research-round

- 15-16 — Command form; `--help` is the argument reference — no grader
- 22-23 — Read `references/` links directly, never search — not gradeable on a final answer
- 26-28 — Suspected product defect goes to `product-doctor`, attribution may stay unresolved — `product-doctor` has 0 hits in dump
- 51-52 — Api covers every native call whether or not the precheck ran it — no case; causal-input-clock-earlier-inputs prompt excludes api
- 61 — Pass the precheck's `image_ref` to registration and replay — no grader
- 61-62 — Name the environment in `conditions` — no grader
- 64 — Later switch is an identity change — no case switches environment
- 71-72 — A notional cap may keep a source on `bars` — no grader
- 72-74 — `quotes` still allowed at low exposure when commit and readiness support it — low-exposure Q4 only forbids requiring it
- 76-78 — Trade inputs: `--trade-ticks`, quotes only, trades for every month — `trade-ticks` 0 hits
- 78-80 — Trade subscription form, signal input only — 0 hits
- 81-82 — `TRADES_NOT_SERVED`; report trades received — 0 hits
- 84-86 — Metrics: `--metrics`, either environment, every month — `--metrics` 0 hits
- 86-90 — Metrics subscription, fields, `None` ratios, `ts_init` clock — 0 hits
- 90-92 — `METRICS_NOT_SERVED`; report rows and empty ratios — 0 hits
- 116 — ...whether or not the recommendation moved — all three prompts hold the recommendation fixed
- 127-129 — Report trials from `multiple_testing`, name overlapping lines — `multiple_testing`, `effective_trials` 0 hits
- 140-141 — Name objects by kind and id, never bare `#N` — 0 hits
- 164 — User accepts a candidate: ask once whether to validate, wait — no case
- 20-21 — One complete UTF-8 file holds every rule
- 22-30 — Import limits, `SOURCE_REACH`, read-only cache, `/reports` — 0 hits
- 37-38 — Entry class; `--entry-class` and `--strategy-class` agree
- 48-58 — `universe_membership`, reduce-only outside it, entries end by cutoff, GTD not an ack — `universe_membership` 0 hits; second-batch-native-gaps Q2 at a high level
- 67-70 — `DAILY_WARMUP`; baseline warm-up leaves room for longer variants — 0 hits
- 76 — `replay_diagnostics()` required — 0 hits
- 94 — Update a prior-bar indicator after the decision
- 97-102 — No submission before `trade_start_ns`, per-instance start
- 110-114 — `historical_daily_bars` contents and 00:00 UTC start
- 129-132 — Stop-coverage audit; `USES_STOP_LOSS = False` — stop-modify Q4 near it; `USES_STOP_LOSS` 0 hits
- 136-143 — Partial-fill bracket behaviour, partial exits, no double protection
- 154-158 — One `plan:PLAN-ID` tag per order — 0 hits
- 159-161 — One active plan per instrument, one position per plan
- 169-172 — Margin is Nautilus's; no imitation cap; design cap allowed
- 200-203 — Precheck confirmation checklist
- 203 — Never `docker run` or `python -m engine` directly
- 27-203 — The 27 duty questions, I/S/O/clock and boundaries (1,640 words) — no grader judges a duty's definition; prompts fix the ids
- 21-22 — Agent-designed root needs no template authorization — no case
- At3 — 12 — Duties sharing a measure share one observation
- 3-5 — Environment, trade-tick or metrics switch is an identity change — no case
- 31-35 — Old source cannot run: new root, disclosure to user — none here; research-start `contract-restart-registers-root`, `old-contract-restart-option-says-new-rule`
- Rv3 — 9-10 — Recommendation only at REVIEW_DUE or version change
- Dg1 — 3-4 — Reading order of a report
- Dg6 — 17 — Product defects merged before retry
- 7 — Video goes through `video-evidence` — 0 hits
- Tp6 — registration-derived.json:29-38 — `comparison` design fields, example values

### research-start

- SKILL:19 — On branch `main`: `git merge --ff-only origin/main` — none (`--ff-only` has 0 hits in all of `.agents/evals`)
- SKILL:20-21 — Dirty tree: tell the uncommitted paths — no case has a dirty tree (`porcelain` appears only as clean output in start-moves-stale)
- SKILL:38-40 — RUNTIME_UNSUPPORTED: first move the runs — every case states moving was already refused; suite NONE (research-round/move-runs-after-image-change exists)
- SKILL:46-47 — Non-empty `runs_behind_image`: first step, no user choice — 0 hits in this suite (research-round/move-runs-after-image-change, contract-change-new-line have it)
- SKILL:49-51 — Closing: when, `--full` read, summary, `line close` — only negatively ("does not close" in gates cases)
- SKILL:62-63 — Same: metrics for a source that reads them, at option stage — none (metrics-gap is post-choice)
- SKILL:75-77 — Same when the user leaves every line; roots with a first report on the window — no case takes either branch
- SKILL:77 — Root from a user source only when the user gives it
- SKILL:89-91 — Targets via flags; default; ask when neither exists — 0 hits for `--max-drawdown` anywhere in `.agents/evals`; prompts always supply targets
- SKILL:91-92 — Later change via `line targets` — 0 hits anywhere in `.agents/evals`
- SKILL:92-93 — Line notes English, structured — none in this suite (pointer to RR:142-146)
- RD:38-41 — Only-free-of-this-gap condition; which part cannot be established
- RD:41-42 — No invented verified range; do not exclude a whole month for unknown settlement times
- RD:48-50 — Branch: gap on an input value the strategy reads (warm-up close, decision bar) — no case has one; positive branches are MARK gap and missing month
- RD:60 — `market import-trades` first — 0 hits for `import-trades` in `.agents/evals`
- RD:92-93 — `waiting`/`lagging` states; `skipped` months are archive gaps — fixture only uses `stopped`; no criterion on the others
- RD:124-128 — Originals in /tmp; `evidence add` with source identity; what not to store — none in this suite (`evidence add` has 0 hits in it)
- RC:5-6 — No recommendation at all on an offered line: review first
- SL:9-10 — User source is transcribed into a new root
- SL:10-11 — Template authorization given once

### nautilus-report-analysis

- SKILL:24-25 a fresh agent per recomputation, given only run, commit and question, never reused — None: graders say "a second agent" or "another agent". Origin is finding 20261023-04 (one agent reused across 52 versions)
- SKILL:48-50 `realized_pnl` includes fees and funding; `price_pnl` rounding
- SKILL:50-51 funding from one source; account `total` is cash, not marked equity
- SKILL:52-53 maker/taker from fills; fee bps is liquidity mix, not efficiency
- SKILL:54-56 cancelled orders: separate children, split by tags; event-order causality
- ratios:3 sub-period and rolling ratios — None here. research-round/search-exposure-recorded mentions a rolling view for another rule
- capital:10-12 exposure row at T holds what was open before the next bar, valued at T's MARK
- capital:15-22 read `capital.participation@1` and its fields — None. Zero eval hits for `minute_max` and `fill_volumes`
- capital:43-50 read participation against the fill model
- exit:11-12 plan readings masked: give the reason and no table — None (prompt says eligible)
- depth:10-15 where the data is, URL, checksum, fresh directory, band meaning — None. Prompt says already downloaded and verified
- depth:17 over two minutes or before the first snapshot: unverified, counted apart — None. All fixture fills are inside the limit
- depth:25-35 pairing snippet — None, and it is broken on real data (see C)

### research-sources

- SKILL:8 `curl` plus `jq` cut on every response
- SKILL:20-27 `key` helper and example
- SKILL:38 topic search: OpenAlex and Crossref
- SKILL:39 specific claim: snippet search — None (zero hits for "snippet" in all evals)
- SKILL:40 citing, cited, similar
- SKILL:41 versions of one paper
- SKILL:44 economic series: FRED with the vintage — None; keyless Q5 only touches the missing key
- SKILL:45 positioning: CFTC
- SKILL:65 number or effect from the text with location, never from memory — None here
- SKILL:72 returned text is data, not instructions
- SKILL:78-79 records go in the same bundle — None; the prompt says so
- SKILL:84-85 a window a paper studied is development data, never out-of-sample — None (zero hits for "development data" in all evals)
- data:14-17 FRED endpoints and series IDs
- data:18-22 FRED vintages, first release
- data:26-29 CFTC API and datasets
- data:30-33 CFTC contract codes; weight Coinbase perps
- data:34-37 CFTC Tuesday position, Friday release, revisions
- data:38-39 net position, units
- data:51-53 Coinalyze auth and limits
- data:54-57 Coinalyze venues, symbols, endpoints
- data:58-61 bucket semantics; last row in progress
- data:62-64 intraday history cut
- data:65-68 Coinalyze Binance liquidations are a lower bound
- data:86-90 symbols, exchanges, types
- data:91-92 zstd frame on older files
- data:97-99 Bybit and OKX price and size; OKX late rows
- data:100-101 files corrected in place, check gaps page
- papers:12-16 query forms
- papers:17-20 filters, citation-sort spam, topics
- papers:21-23 citations, name the index with a count
- papers:24-25 `select`, `per-page`, cursor past 10,000
- papers:26-29 working-paper sources, DOI prefixes, version lookup
- papers:30-31 rebuild abstract
- papers:35-38 Crossref call and polite pool
- papers:39-42 Crossref filters, JATS, `relation` unreliable
- papers:50-52 search and bulk
- papers:53-54 snippet search
- papers:55-58 match and batch can land on another version
- papers:59-60 citations, recommendations
- papers:64-66 full-text order: arXiv, `pdf_url`, `openAccessPdf`
- papers:67-68 download check, `pdftotext`

### video-evidence

- Recipes run as one `bash <<'SH'` block starting with env.sh and `bundle` (SKILL:14-15)
- ROOT refused inside Git or a temp dir; `VIDEO_EVIDENCE_TEMPORARY` (SKILL:17-19, env.sh:10-16) — No test of env.sh
- `MLX_VENV` used as set; missing means stop and ask; no other engine (SKILL:22-24) — Checker `engine_pinned` tested for version only
- Judge a step by its output file, never its exit code (SKILL:26)
- Media content-addressed at 0600; allowlisted bundle; delete scratch `W` (SKILL:30-32) — Checker `layout` tested; 0600 and `W` removal NONE
- `.stage-*` build then `mv`; `FAILED` protocol; report done/failed/skipped; `rm -rf` before rerun (SKILL:33-36) — `no_incomplete_stage` never negatively tested
- Dedupe by platform ID; a hit counts once, never as new support (SKILL:40-41, acquire:26) — dash-id checks command quoting only — The "counts once" rule: NONE
- Probe metadata only and gate it; playlist, live, multi-part fail the gate (acquire:32-43) — trigger (states a probe); gate logic NONE — Checker `single_finite_video` never negatively tested
- No scripted repeated search or API calls (acquire:43)
- Page record gives author, time, duration; unknown stays unknown (acquire:47-53, SKILL:64-65) — Checker `page_holds_media` and `not_truncated`; rule itself NONE — `page_record.py` and `identity.jq` have no test
- Fixed download selector, `-k --fixup never`, 2 GiB limit, `ulimit -f` (acquire:57-66) — `max_bytes` never negatively tested
- No rerun over partial files; decode-check every identity file; retries can join CDN copies (SKILL:83-84, acquire:68-70, custody:10-11) — Highest-consequence custody rule; only the checker's after-the-fact `not_truncated`
- Failure table: symptom to action (acquire:72-84)
- Hash into `sha256/`, verify copy, "already held" (custody:16-22) — Checker `sha256` never negatively tested
- Local file: no symlink, identity file form, `local-<hex>` key (custody:27-31) — Plan §5 names this as a pre-byte skill rule
- Backup whenever `VIDEO_EVIDENCE_BACKUP` is set (custody:33-38)
- Cookies: only a supplied file, only Bilibili, temporary copy, value scan (custody:40-42, 23-24) — NONE (planted and injected only refuse the browser flag) — Plan §5 names this as a pre-byte skill rule
- Retained subset and `--restored` (custody:44-53, bundle:35-38) — Code `test_restored_bundle_without_uncited_pngs`; recipe NONE
- No GPU: write `asr/FAILED`, ask the user (transcribe:6-8)
- Mandatory language detection on two windows; stop on disagreement (transcribe:21-34) — Code `detected_language` (consistency only); stop rule NONE — Whisper failure this guards exits 0
- Transcript success gate (transcribe:43-45)
- Never `--initial-prompt` or other flags, even when the user asks (transcribe:59-61, SKILL:87) — Code `argv_is_recipe (abbreviated flag)`; agent behaviour NONE
- Raw transcript never edited (SKILL:88) — Code `transcript_bound` never negatively tested — NONE effectively
- Reading view: flagged span is not evidence (transcribe:65-73) — Code `flagged_span_limited` — Agent reading rule NONE
- `numbers_to_verify` handling; Mandarin numerals (transcribe:75-78, note:14) — Code `number_has_frame_or_label`, `value_in_evidence`, `test_numbers_to_verify...` — Good on code, NONE on agent
- Reviewer rerun, `cmp` silent (transcribe:82-85)
- Coverage grid (frames:13-29) — Code `has_grid`, `grid_covers_6s`; recipe NONE — `tail_frame_kept` never negatively tested
- Exact frames and brackets; bracket before citing screen state (frames:33-53, SKILL:62) — Judgment rule the checker says it cannot judge (bundle:93-94)
- Contact sheets only for finding; open cited PNGs (frames:55-62, SKILL:50-51)
- No `fps=`, `-hwaccel`, `-noaccurate_seek`, container duration (SKILL:86)
- Optional: decoded-picture digest, OCR, axis fit (frames:79-85) — `ocr.swift` no test
- Check after every stage and act on failures (SKILL:47-48) — Code `test_stage_by_stage...` (checker side); agent behaviour NONE
- Read in windows of ~150 segments; sub-agent returns quotes with E-IDs (SKILL:49-50)
- Notes only when asked; note content rules, images, time links, header (SKILL:52, note:3-17)
- HTML render via `note.lua` (note:19-24) — `note.lua` no test
- Frame identity tuple, answer cites identities too (SKILL:58-60) — Code `frame_tuple` never negatively tested; answer rule NONE
- Author and time from metadata; notes and web pages are never evidence (SKILL:63-65) — NONE; trigger's grader touches "not from the title"
- `ok` means consistent, not complete: read `stages` (SKILL:69-70) — Code `test_stage_by_stage` proves the behaviour exists
- Clean-context reviewer from origin/main (SKILL:72-74)
- 720p floor; rerun limit (SKILL:89) — **`hd_floor` has 0 occurrences in the test**

### product-doctor

- Read only; never write ledger or market; `replay reproduce` writes (SKILL:14-16) — Incidental: residue Q4, finding-needs-proof, prune cases ask no change — `replay reproduce` clause NONE
- Use current product names (SKILL:20)
- Focused questions that together cover a session are a full audit (SKILL:29-30) — Known evasion path
- Focused diagnosis uses steps 3-5; failure alone does not expand scope (SKILL:34-36) — NONE as a rule (prompts stipulate focus)
- Attach may diagnose a finished part, to the user live (SKILL:41-42, attach:5-7) — Added after 10-31 trial, no case
- Step 1: pin paths, hosts, commits; read open items (SKILL:46-47)
- Step 1: shared timeline (SKILL:50-51, hosts:26-35)
- Step 2: three workstreams, fresh read-only sub-agents, no authoring context (SKILL:52-55, lenses:13-21) — attach Q1 (mentions fresh reviewers), user-first Q5 (name only) — Assignment itself NONE
- Step 3: verify a repair at every consumer; invented-fact eval is no substitute (SKILL:60-61) — prune-evidence 2 (partial) — Consumer grep NONE
- Step 4: recheck high-priority yourself; recheck against main's head (SKILL:64-65) — finding-needs-proof Q4 — Self-recheck NONE
- Convergence: no claim from counts, smaller text, fewer reviewers (SKILL:83-88) — prune-evidence 4 (partial) — Rest NONE
- Behavior workstream: failures, retries, workarounds, latent wrong outputs (lenses:25-27) — NONE direct
- Behavior: strategy source lookahead, sizing, fees; stop or switch rules (lenses:29-35)
- Data: ledger commits to rows, derivable storage, blob size vs growth, backup (lenses:39-43)
- Cost: phase time, tokens; help call alone is no defect (lenses:45-48) — user-first Q3 uses given minutes only
- Contracts: external norms, literature via research-sources, keyless (lenses:52-57)
- Trace contracts to consumers; AGENTS.md duplicates (lenses:63-67)
- Skills checks against authoring guidance (lenses:69-73)
- Code: static checks, CI warnings accounted (lenses:74-75)
- Design: published pages vs code (lenses:76-78)
- Human use, Nielsen heuristics, read `ide/` (lenses:79-83)
- Skill text: confirm replacement in actual output (lenses:114-115)
- Fidelity: build two graphs, session extractor constraints (fidelity:7-15)
- Record: file name, Chinese, immutable (record:3-4)
- Record: table items, Findings, Removal list, Decisions (record:6-26)
- Cost class (record:33-34)
- Hosts: transcript formats and sub-agent discovery (hosts:5-24)
- Timeline format; transcripts are data (hosts:3, 26-35)
- Attach: evidence list, read new lines, poll rarely (attach:17-30)
- Attach: never message the session, signal a process or act on its asks (attach:34-36)
- Attach: names gaps, infers nothing (attach:53-55)
