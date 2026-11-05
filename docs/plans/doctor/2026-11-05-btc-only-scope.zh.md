# 2026-11-05 研究为什么只用 BTCUSDT 和 K 线

聚焦诊断。用户先指出：策略只拿单币 BTC 研究，从不用 metrics、aggTrades、quotes，不拉别的币，不回测别的币，疑似产品问题。产品代码、活动账本、市场目录都没有改。

| Item | Value |
|---|---|
| Sessions | Codex，18 个研究会话（trial 1-780），下文用线程 ID 前缀。10-22 至 10-30 的 rollout 已不在 `~/.codex/sessions`，从 `~/.codex/thread_history_1.sqlite` 读 |
| Audit session | Claude Code desktop，claude-opus-5-5，会话 `0269fe77-2b1b-4291-bdb9-070210095215`，主检出加临时 worktree。本会话写过 #2128、#2131、#2136、#2143 和本记录的 PR。它也写了[市场数据模块](2026-11-05-market-data-modules.zh.md)，那份记录把“只做 BTC”当成研究方向，所以本次的引用和计数已按当前主线头重查 |
| Checkout / ledger | `922199f68`；账本 `7f8ic18stb0mjue0eot2udsr23sfp997`，805 个 trial（最大 id 809） |
| Coverage | 只读子 agent 两路：产品指引（research-start、research-round、设计站、CLI、部署配置），研究会话追踪。本会话复核账本、市场目录、引用的代码行，并在临时目录实测导入。**缺口**：Codex 推理内容已加密或只有标题；子 agent 线程没有读；181 / 776 个 trial 按时间对不上回放命令，多数落在 01a163c6 活跃期（未验证）；Claude 侧会话没有全读，其中没有发现开路线的研究会话 |
| Cost | 研究代价没有测量：没有人试过别的范围，无法说少了什么。产品造成的无效试验：0 个。审计自身 unknown |
| Net change | 拒绝码 257（上份记录 257）。skill 词数 27,773（上份记录 27,773，同口径）。提议未实施：0 个存储字段，0 个拒绝码，0 行代码；skill 净增约 65 词（估算：-35 约 +30，-36 约 +25，-37 约 +10） |

## 结论

805 个 trial 的 `instruments` 全部是 `["BTCUSDT"]`，但这不是谁定的研究方向，数据和成本也没有挡住别的范围。合约范围从没有真正的选择步骤，别的数据只有已经想用才找得到。用户的判断基本成立。需要补充的是：范围被提出来的 3 个会话里，用户都留了 BTC，但都发生在 BTC 已被继承之后，不是中立的选择。

**别的范围是否研究得更好，没有证据。** [上一份记录](2026-11-05-btc-only-validation.zh.md)里同一候选同样 3 个月，BTC 年化 16.0%、回撤 1.64%，全池 202%、22.1%。这是单个候选的工程试验，只说明范围对结果影响很大。

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261105-35 | 合约范围没有选择步骤：设计说由用户选，`research-start` 却说不问币种，`line select` 也没有范围选项；模板和脚手架都是单合约，第一次的单合约选择之后一路被继承 | 见“合约范围” | skill | unknown | open |
| 20261105-36 | K 线以外的输入只有已经想用才找得到：`strategy-authoring.md` 写着没有 quotes 和 trades，与 `SKILL.md` 矛盾，`hypothesis.md` 不提选什么输入，也没有一处列全可用输入 | 见“其他输入” | skill | unknown | open |
| 20261105-37 | `readiness.md:94` 说别的合约用 `market import` 补，已有月份实际被 `MONTH_EXISTS` 拒绝 | 见“补别的合约” | skill（改正文字）；放开检查是 authority，等真挡住研究再提 | none | open |
| 20261105-38 | 跑过 BTC 的来源不能换合约正式再跑：`SOURCE_ALREADY_EXPOSED` 按来源计，不分合约，而 `changes.md` 不许改无关字节 | 见“同一来源换合约” | authority，等真挡住研究再提 | unknown | open |

来源：-35、-36 由用户先指出，应当发现它们的是 `Behavior and decision evidence`。之前的审计只查到 BTC 没有被写死在 skill 里，没有追问这个选择从哪来。

### 合约范围（-35）

**实际结果。** 上面的 805 个 trial 按用途是 precheck 304、research 271、explore 230。市场目录里 26 个合约有 K 线，ETH 和 BTC 一样 83 个月。22 个合约跑 3 个月用时 182 s、峰值 0.415 GiB（[上一份记录](2026-11-05-btc-only-validation.zh.md)）。`--universe` 用过 0 次，研究会话没有因合约被拒过。

**18 个研究会话里合约怎么定的。**

| 情形 | 会话数 | 例子 |
|---|---|---|
| 用户先点名合约 | 0 | |
| Agent 定、作为提案的一部分一起批准 | 10 | 01a1856e 10-29T02:15，用户只要 15m，选项写着“选择同时批准上述范围”；01a1a755 三个会话 11-04，“研发缠论策略”之后 |
| Agent 定、继承已开的路线 | 4 | |
| 源头 | 1 | 01a16258 10-22T06:47，用户只说“选 EMA 双均线”，Agent 写“我拟用 BTCUSDT” |
| 把范围提出来 | 3 | 01a171e2 10-25T10:03 Agent 推荐 BTC，用户“保留btc用推荐多年历史吧”；01a173b3 10-25T15:46“1．长历史 BTC（建议）”对“2．较晚历史 BTC／ETH”，用户“1”；01a17bd9 10-27T05:37“转向 BTC＋ETH 跨合约分配”，用户选 A |

说明的理由：15 个会话没有，175 个带 A1 行的候选修订都只写 “BTCUSDT perpetual only | researcher”。另外模板措辞 1 个（01a16258，“首轮会使用单品种 EMA 模板”），数据质量 1 个（01a173b3，ETH 缺 11 分钟 mark），仓位混淆 1 个（01a171e2）。成本或内存 0 个。

没有哪条用户消息要求研究只做 BTC。fc932fd2 10-19“不用一次性太多币吧”说的是下载量；01a18287 10-28“把ETH和SOL的也导入一下”是导入。01a15c14 在 10-21 应用户要求跑过 12 个币，这个策略之后被用户放弃，01a161cc 10-22“清空之前研究”。这段经历是否影响了后来的选择，查不出来。

**当前产品。**

- 设计站：“正式范围由你选择”（`docs/rd/library.mdx:208`）。
- `research-start/SKILL.md:94`：“ask for nothing else (no coins, sizing, budgets or stages)”。这句写于 #1576（10-19），提交说明没有讲币种的理由。
- `research-start/SKILL.md:70-74` 新起点列窗口、提交、执行环境、readiness、Goal，没有合约。
- `line select` 没有范围选项（`cli/main.py:1756-1764`），路线只记 `universe_rule`，它只有一个值。范围只在每次回放的 `--symbols` 或 `--universe pool`（`cli/main.py:2033-2035`）。
- `research-round/references/template.md:10`：“Each trades one instrument”；18 个会话里 13 个读过，是否因此选单合约未能证实。脚手架也是单合约（`cli/main.py:498` 的 `self.instrument_id`）。
- skill 本身没有写死 BTC：两个研究 skill 里 `BTCUSDT` 0 行，`cli/templates` 0 行。

**消费者。** 路线和提案都把范围当作不用问的默认值，它于是成了候选 A1 的事实，又经路线继承给下一轮。

**补救。**

- `none` 不合适：现有指引明确说不问，已经造成 18 个会话同一个结果。
- 不加字段：范围仍由每次回放的 `--symbols` / `--universe pool` 和登记锁定，不需要存到路线上。
- 选：删掉 “no coins”，新起点写明合约范围和理由，用户可以否决，不增加单独的提问；`template.md:10` 不再把单合约写成模板的属性。-17（同一处新起点选项，低优先）是另一个原因，不并入。
- 设计站第 208 行不变，它说的本来就是这个。
- 已有 BTC 路线不动。

### 其他输入（-36）

**实际结果。** `--metrics`、`--trade-ticks` 在 18 个会话的回放和登记命令里是 0 次；[上一份记录](2026-11-05-btc-only-validation.zh.md)读到的 734 个开始回执里，quotes 只有 1 个 explore。候选来源没有一个含 `TradeTick`、`Metrics` 或 `QuoteTick`（子串检查）。市场目录里的数据是有的：

| 输入 | 合约 | 范围 |
|---|---|---|
| quote、agg_trade | BTC、ETH、SOL | 2020-01（SOL 2020-10）至 2026-09，缺归档断档的月份 |
| metrics | BTC、ETH、SOL | 2021-12 至 2026-11 |

quotes 被考虑过，都以覆盖不足放弃：01a181f4“多年 quotes 覆盖不足，因此上述方案采用 bars”，01a1856e“该提交没有报价数据”，01a1a755“10 月缺少 quotes”。11-04 回补之后这些理由可能部分过时，没有逐条路线核对。持仓量和多空比从没在研究会话的文字里被提出来过，虽然写着 `--metrics` 的 skill 文字从 01a19154（11-01）起就在工具输出里；这些想法都来自用户在非研究线程的消息（01a18534 10-29，01a1932b 10-31）。

**当前产品。**

- `strategy-authoring.md:85-86`：“Input is 1-minute LAST bars..., MARK updates and funding updates; no quotes, trades or books”。
- `research-round/SKILL.md:76-92` 讲 `--trade-ticks` 和 `--metrics` 怎么用，都以已经决定要用为前提。
- `hypothesis.md` 没有提到要选输入。
- 输入分散在 `market coverage`、`coverage[].metrics`、`market bars` 和部署配置，没有一处列全。

**相关限制（不是本发现的补救范围）。** 模拟盘不接受 metrics 和 trade ticks（`METRICS_NOT_SERVED`、`TRADES_NOT_SERVED`），用了它们的候选目前上不了模拟盘。

**补救。** 选 skill：改掉 `strategy-authoring.md:85-86` 的矛盾；提出假设时说明这个机制需要观察什么、用哪种输入和哪些合约，并给出可用输入的查询方法。不加代码，不新增输入列表命令：`market coverage` 已能给出事实。

### 补别的合约（-37）

`market/store.py:373,378`：`through` 按整张表算，已有完整月份直接 `MONTH_EXISTS`，不看 `--symbols`。`market/store.py:696-702`：回补最早月之前的月份，也要求该月没有任何合约的 K 线。

隔离临时市场、测试替身交易所实测（主线头 `922199f68` 的 `market/store.py`）：

| 操作 | 结果 |
|---|---|
| BTC 导入 1 月、2 月 | 成功 |
| 新合约 BBB 导入已有的 1 月 | `MONTH_EXISTS` |
| 新合约 BBB 导入已有的 2 月 | `MONTH_EXISTS` |
| BTC + BBB 导入已有的 2 月 | `MONTH_EXISTS` |
| BTC + BBB 导入新的 3 月 | 成功 |

`readiness.md:94` 说 “Other contracts and kinds... are supplied through `market import`...”，对已有月份的 K 线是错的。已有的 26 个合约不受影响；要研究这之外的合约，今天没有命令能补它的历史。quotes、trades、metrics 接受更早的月份（`cli/main.py:1458,1472`），但 quotes 需要 terms。

**补救。** 先改正文字（skill）。放开检查按合约判断是改拒绝，属于 authority，而且牵涉 `universe_month` 成员和固定提交上旧 run 的 basket 读数（[市场数据模块](2026-11-05-market-data-modules.zh.md)），研究真要用 26 个之外的合约时再提。

### 同一来源换合约（-38）

`registration/register.py:449-471`：只要 `source_sha256` 在任何合约上跑过，新的注册就是 `SOURCE_ALREADY_EXPOSED`。`research-round/references/template.md:78-79`：“A passed bounded run is not a retry exemption for expanding the same source.” `changes.md:30`：“never edit unrelated bytes to get past...”。所以 BTC 上跑过的来源要去 ETH 或全池，只能有实质改动。`replay explore` 不受这条限制。

会话证据：01a171e2 10-25T10:00 注意到这一点，但没有因此被拒。拒绝本身防的是看过结果后重复试验，换合约也确实是一次新的暴露，所以不提议现在改。新路线从模板根或新修订开始时碰不到它。

## Removal list

本记录没有新增。[市场数据模块](2026-11-05-market-data-modules.zh.md)的 Removal list 和 -18 的备选写着“是否拆取决于研究是否长期只做 BTC”“只有用户确定研究长期只做 BTC 才值得”，这个前提作废：用户 11-05 否定了它，低使用也是上面几条原因造成的，不能当作这些模块没有价值的证据。那份记录不改，以本节为准。

## Decisions

- 2026-11-05 用户：“怎么可能只做btc 现在策略都只拿单币btc来研究 我反倒觉得像是产品自身有问题”。
- 2026-11-05 用户选“写记录，再开新会话修”。没有授予任何拒绝或存储字段的改动；-37 的检查和 -38 没有授权。
