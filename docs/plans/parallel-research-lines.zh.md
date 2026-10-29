# 一个账本上同时开多条研究路线

2026-10-29，用户批准本计划，选用方案 (a)（原话：「Approved: use option (a) and open the docs PR on main.」）。实现各 PR 按文末拆分进行。

2026-10-29，两个 Codex 研究会话同时使用同一研究账本：

- 一个选了 `research-line-20261029-ema-entrynotional-multiyear`（市场 1kcbv73，窗口 2020-09-01..2026-10-01）；
- 另一个已得到用户批准，要新开 15m 通道突破路线（市场 l1kfbo4，窗口 2025-10-01..2026-10-01）。

按现行规则，选 15m 路线会让前一条结束，所以 15m 会话停了下来。用户表示希望产品支持多条路线同时研究。

本计划取代两份旧计划：

- 2026-10-25 的「每账本一条当前研究路线」（[single-current-research-line.zh.md](single-current-research-line.zh.md)）；
- 2026-10-21 [line-close-tags.zh.md](line-close-tags.zh.md) 里两条规定：封盘点在「下一条路线诞生提交的父提交」，以及「当前线不封」。

这里只写计划，不改代码。凡改变拒绝、门槛或 skill 规则的地方，都列在文末「待用户批准」。

## 现状

以下由读代码和账本核实。

### 当前路线怎么定

- 「当前路线」＝最新入账的 `research-line-*` 包（`ledger/lines.py` `current_line`）。
- 更早的路线一律算已结束（`unclosed_lines`）。
- 封盘点是下一条路线诞生提交的父提交（`closing_commit`）；`line close` 在那里打 `line/<日期>-<slug>` 标签。
- 对当前路线执行 `line close`，拒绝 `LINE_OPEN`。

### 谁在读当前路线

- **登记**（`registration/register.py`）：
  - `register` 只从当前路线取市场提交；导出窗口来自重放参数。
  - 门槛 `require_line_records` 按当前路线检查。
  - `_check_window` 只比较 `body.window` 与当前路线的窗口（`WINDOW_MISMATCH`）。
  - `bind` 在试验开始时的写事务里重跑 `_validate`，也就重跑了窗口比较。所以登记之后，若有人选了窗口不同的新路线，这个登记就再也绑定不上；新路线窗口相同、市场提交不同时，旧登记仍能绑定，但它的试验不会算进新路线。
- **目标**（`ledger/targets.py` `set_targets`）：只有当前路线能写；已知的其他路线一律 `LINE_ENDED`。
- **报告与命令行**：`report/status.py`（`research_status`、`research_state`）、`report/graph.py`、`cli/main.py` 的 `line targets`，以及 IDE 服务（`services/ide/research_graph/serve.py`），不带 `--line` 时都默认取当前路线。
- **选线**：`select_line` 遇到与当前路线完全相同的选择，按重放处理。重放判断在写事务之外。

### 试验怎么归到路线

- 判断和目标已经各自带 `line_bundle`，试验没有。
- `line_trials` 的规则：起始回执的市场提交等于路线的，交易窗口也等于路线的，就算这条路线的试验。
- 后果：已结束路线的试验，会被之后同市场提交、同窗口的新路线继承，进入它的解释门槛（不按时间截断）和研究图。
- 比较表 `comparison_table` 不走 `line_trials`。它按窗口和范围规则列出所有路线的已通过运行。推荐必须点名的 `candidates` 只取与本路线执行身份（含市场提交）相同的运行。

### 活动账本的现状

2026-10-29 只读查询，提交 a9lnkim1：共 3 条路线，前两条已有 `line/` 标签，只有最新一条没有。所以在新规则下，现在正好开着一条路线，活动账本不需要迁移。IDE 的只读副本跟随活动账本；测试账本都是一次性的。

## 1. 开着的路线可以有多条，不再是「最新的那条算数」

### 结束就是封盘

- 一条路线从 `line select` 开始，到 `line close` 结束。原来的「已结束」和「已封盘」合并成一个状态。
- 结束的标记就是标签 `line/<日期>-<slug>`：没有标签的路线都算开着，可以同时开多条。
- 不新增表，也不新增字段。

### 按提交时间点判断开没开

- 规则：路线 L 在提交 X 时开着，当且仅当 L 的包在 X 已存在，并且 L 没有标签，或者标签所在提交不是 X 本身、也不是 X 的祖先。
- 这样判断不依赖 `dolt_tags` 是否按 `--at` 读，`--at` 读到的就是那个时间点的开闭状态。
- 写命令只在头提交上判断。

### 选线不再结束旧路线

- 「已结束但未封盘」这个中间状态随之消失。
- `research state` 的 `unclosed_lines` 改为 `open_lines`，列出各条开着的路线及其窗口和市场提交。这是输出，不存储。
- `line close` 的输出去掉 `ended_by`。

### 封盘点：关线时的研究分支头提交

- 标签快照会带上同期其他路线的记录。它是关线那一刻的整本账，不是这一条路线的切片。
- 关线之后，这条路线仍可能补写解释，或封存已在运行的重放。所以 `LINE_ENDED` 文案里的「终态快照」改成「结束点」。

### 两个拒绝怎么变

- `LINE_OPEN` 删除。它防的是「给一条还会继续的路线打上终态标签」；现在关线本身就让路线结束，这个风险不存在了。
- `LINE_CLOSED` 的重放判断改为：只比较已有标签的消息。原来封盘点每次重算，结果固定；现在头提交会往前走，再拿重算的提交去比，同一份摘要就会被误判为 `LINE_CLOSED`。

### 什么时候关线

由 skill 规定，产品不管：

- 用户说结束；
- 路线因 `RUNTIME_UNSUPPORTED` 等门槛无法继续；
- 到了该换路线的时候，用户选了别的路线。

用户只是另开一条路线时，原路线继续开着。

### 标签由谁打

标签由管理员打，不在 `ledger_head` 的串行化里，这一点与现在相同。删除或改动标签是「改写已发布记录」，按 AGENTS.md 需要用户授权。

### 移除检验

- 去掉「选新即结束」，就消除了「别的会话一选线，我的路线就被关掉」的风险。
- 结束从隐式（下一次选线时）变成显式（`line close`）。
- 没有哪个检查因此失去保护对象。

## 2. 写入时明确指定路线

### `--line` 的规则

- 今天默认取当前路线的写命令（`registration add`、`line targets`）都接受 `--line`，而且这条路线必须开着。
- 只开着一条时可以省略。
- 开着多条又没给 `--line`，新增拒绝 `LINE_AMBIGUOUS`，消息里列出开着的路线。
- 一条都没开时，仍拒绝 `RESEARCH_LINE_REQUIRED`，含义改为「没有开着的路线」。

### 检查放进写事务

「路线开着」和第 3 节的唯一性，都在 `db.write` 的 `insert` 里检查。今天 `register` 和 `select_line` 是在写事务之外读当前路线的；放进事务后，借助 `ledger_head` 串行化，不会出现先检查后写入的竞态。

### 一份登记属于哪条路线

规则：登记包入账提交之前、最后一条与登记的（`input_identity.market_commit`, `body.window`）相同的路线，就是它所属的路线。

- 依据只有「只追加」的入账顺序，不存新字段。旧账本上，它等于旧规则下的当前路线（只要市场提交和窗口相同）。
- 格式核对：`input_identity.market_commit` 是 `market.resolve_commit` 给出的完整哈希，与路线记录同形。`body.window` 是 ISO 日期字符串，登记时已与路线窗口逐字比对过。
- 市场数据库不在这个键里，`line_trials` 也不比较它；导出走的是命令行的 `--market`。

### 绑定

- `bind` 按上面的规则推出登记所属路线，要求它仍开着；已关闭则拒绝 `LINE_ENDED`。
- 由于推出时已经比较过窗口，`bind` 里的 `WINDOW_MISMATCH` 不再触发，删掉这一处。`registration/validation.py` 中验证窗口的 `WINDOW_MISMATCH` 不变。
- 效果：别的会话选线，不再打断已登记的重放；关掉一条路线，就挡住它剩下的绑定；即使之后新开一条同键路线，旧登记也不会绑到新路线上。
- 与今天相比多了一个条件：市场提交必须相同。

### 其他命令

- `line targets` 只接受开着的路线。`LINE_ENDED` 改为「已有封盘标签」；未知路线仍是 `LINE_UNKNOWN`。
- 读命令：
  - `research state` 不给 `--line`、又开着多条时不抛错，在 `gates` 里报 `LINE_AMBIGUOUS` 并列出 `open_lines`，与今天 `RESEARCH_LINE_REQUIRED` 只报告不抛出的做法一致。
  - `research status` 照常给全账本计数；在开着多条又没给 `--line` 时，`comparison` 为 null。
  - `research graph` 要画某一条具体路线，开着多条又没给 `--line` 时，拒绝 `LINE_AMBIGUOUS`。
- `line select` 遇到与任何一条开着路线完全相同的选择，按那一条的重放处理。
- `judgment add` 本来就要求明确给路线，不改；已关路线补写解释仍然允许。

### 接受的竞态

关线（打标签）与同一路线的写操作可能同时发生：事务里看不到新标签，写操作会落在封盘点之后（见第 5 节探针 2）。

- 如果落下的是登记，之后的 `bind` 会在新事务里拒绝它。
- 如果落下的是绑定（事务在打标签之前就开了），那个试验照常运行并封存，算作这条路线在封盘点之后的记录。

只有两个会话同时推进同一条路线时才会出现，接受，不加锁。

## 3. 试验归属：采用方案 (a)

### 问题

两条开着的路线若市场提交和窗口都相同，`line_trials` 会把双方的试验都算给每一条：

- 一方没写解释，另一方的登记被挡住（`INTERPRETATION_REQUIRED`）；
- `REVIEW_DUE` 把双方的试验数加在一起；
- 研究图混在一起；
- 执行身份也相同时，比较表的 `candidates` 会混进对方的版本，推荐被迫去评价它们（`RECOMMENDATION_INCOMPLETE`）。

### 两个方案

| | (a) 拒绝第二条同键的开着路线 | (b) 在登记里记录路线 |
|---|---|---|
| 做法 | `line select` 在写事务内检查：已有开着的路线用了同一市场提交和窗口，就拒绝 `LINE_DATA_TAKEN` | `research-plan.json` 的 body 增加 `line` 字段 |
| 试验归属 | 试验经 `registration_attempt` 找到它的登记，再按第 2 节的规则推出路线。研究试验在同一次写里必定绑定登记（`trials.open_trial` 要求 binder） | 直接读登记里的 `line` |
| 存储 | 无新字段 | 新增存储字段，需要按 AGENTS.md 做独立子代理评审、由用户决定，并记录在 `docs/plans/` |
| 旧记录 | 同一条规则 | 旧登记没有这个字段，要靠 (a) 的规则推出，读路径变成两套 |
| 能做到的事 | 同时开着的路线必须换窗口或换市场提交。这次两条路线两样都不同，可以直接开 | 同一份数据、同一窗口上也能并行 |

### 推荐 (a)

- 不新增存储字段，只有一条推导规则，`bind` 和 `line_trials` 共用。
- 顺带修好了今天「已关路线的试验被同键新路线继承」的问题。
- 只有当用户真的要在同一市场提交和窗口上同时开两条路线时，(b) 才有用。到那时再按 AGENTS.md 做字段评审，由用户决定。

### 随之改变的门槛

- `line_trials` 改为按登记所属路线认定试验。`INTERPRETATION_REQUIRED`、`REVIEW_DUE`、研究图和 `research state` 的计数，都不再包含同键前任路线的试验。
- `require_line_records` 里「已被 `retry_of` 接手的无效运行可以免写解释」，只认同一路线的登记。今天这一条看的是全账本的 `retry_of`，另一条路线的重试登记也能替本路线免掉解释。

### 不变的部分，以及 skill 要提醒的

- `SOURCE_ALREADY_EXPOSED` 按源码在全账本范围判断，这样做是对的：暴露针对的是数据。代价是两条并行路线若用了同一个起点源码或子源码，会互相挡住，谁先运行谁占用。skill 写明：并行的路线要从不同源码起步。
- 比较表的 `runs` 会列出同窗口、同范围规则的其他路线的运行，这是现有设计，供参照；`candidates` 仍按本路线的执行身份筛选。
- skill 写明：不得仅仅为了绕开 `LINE_DATA_TAKEN` 而另钉一个市场提交或挪动窗口。这和「不改无关字节去绕过 `SOURCE_EXISTS`」是同一个道理。

## 4. 多条路线对同一份数据的多重检验

- `REVIEW_DUE` 是路线内部的流程检查点（每 5 个研究试验复核一次推荐），不是多重检验校正，不需要跨路线计数。
- 多重检验用的计数本来就跨路线：
  - `research status` 的 `trials` 和 `distinct_sources` 统计全账本，不分路线、不分用途；
  - `by_development_window` 按试验自己的交易窗口分组，不分路线，也不分市场提交。
- 因此在 (a) 下，同窗口、不同市场提交的两条路线会落在同一组。`nautilus-report-analysis` 计算 deflated Sharpe 用的就是这一组，产品不用改。
- 窗口只是重叠、并不相等时（这次 15m 的窗口落在 EMA 多年窗口之内），`by_development_window` 不会把两边合起来。这个缺口今天在先后两条路线之间就已存在。
- 处理方式只改措辞：推荐和报告遇到窗口与本路线重叠的其他路线（开着或已关）时，点名这些路线，并同时给出全账本的 `trials` 和 `distinct_sources` 作为保守上界。不新增产品计算。

## 5. 并发写与 DoltHub 发布（实测）

### 怎么测的

- 都在隔离的 Dolt 2.4.2 一次性服务上做（`tests/ledger/dolt.py` 的 `Service`），或在会话临时目录里的 file:// 仓库上做，没碰活动账本。
- 活动账本只用 reader 账户做了只读查询。

### 现有测试

全部通过：

- `test_publish`（含：对同一个头提交并发发布，全部成功）、`test_lines`、`test_targets`，共 16 项；
- `test_db` 的并发写测试；
- `test_register` 中「同一格点两次并发绑定，只提交一次」。

### 补充探针

脚本放在会话临时目录，不进仓库。

1. **两个会话同时写**：一方 `written`，另一方 `CONCURRENT_WRITE`，不会合并。每次写都更新唯一的 `ledger_head` 行，所以任意两次写都被串行化。
2. **写事务开着时，管理员给头提交打标签**（模拟另一个会话执行 `line close`）：事务里看不到这个新标签，写操作照常提交，而且提交落在打标签的提交之后。第 2 节接受这个竞态。
3. **在 file:// 远端上执行 `CALL DOLT_PULL('origin','main','--ff-only')`**：标签也被拉下来。所以 IDE 的只读副本能看到哪些路线已关闭（IDE 用的正是这个调用，见 `services/ide/docker/pull.sh`）。

### 发布

- 每次写入后，`_publish_after` 都会发布一次，用命名锁 `<database>/publish` 串行。后到的一方发现头提交已经推送过，就只核对。
- `line close` 不产生提交，它的标签随下一次写入的发布一起推送，这是现有行为。
- 两个会话并行，这里不用改。

### 发现：封存写入遇到并发冲突会丢掉结果

以下由读代码得出，没有专门做探针。

- 一次长时间重放结束后，封存写入（`execution.seal_capture`、`trials.ingest_run`、`ingest_capture_refusal`）若遇到 `CONCURRENT_WRITE`，不会重试。`replay/entry.py` 的 `execute` 在没有其他失败时直接把这个拒绝抛出。
- 于是这次试验既没有封存的捕获，也没有运行记录：
  - `retryable` 要求捕获状态为 `captured`，结果才算可重试，所以 `retry_of` 会被拒绝（`RETRY_NOT_ALLOWED`）；
  - 用同一份源码重新登记，又会被拒绝 `SOURCE_ALREADY_EXPOSED`。
- 结论：这个格点就此作废，不只是「再跑一遍」那么简单。
- 今天的纸面交易守护进程（`paper_seal`）已经是另一个并发写入方；并行路线会让碰撞更频繁。
- 修法：给封存写入加有界重试。这些写入都以 `op_id` 保证幂等，重试时事务内会重新检查，所以是安全的。这属于 Agent 做不到的并发处理，作为产品修复单独开 PR。它会改变 `CONCURRENT_WRITE` 在这几个命令上何时出现，所以列入待批准项。

## 6. Skill、IDE 与评测

### research-start

- 读 `research state` 的 `open_lines`。
- 新会话：把每条开着的路线（当前状态和下一步）和新路线选项并列给用户，等用户选。
- 中断后：继续本会话 Goal 里写明的那条路线。
- 去掉「`unclosed_lines` 交给后台子代理封盘」。改为在用户结束路线、或路线无法继续时，读 `research state --line L` 写摘要，再执行 `line close`。
- 门槛那一段，「用户选了别的路线，这条就关闭」改为显式关闭。
- `references/recommendation.md` 改为从本路线（`--line`）最新的推荐读起。
- `references/readiness.md` 中「旧记录保留」改为说明旧路线仍开着，除非关闭。

### research-round

- 选定路线后，每条登记、状态、研究图和目标命令都明确带 `--line`。即使眼下只开着一条也要带，因为别的会话可能中途再开一条。
- `references/changes.md` 中「`line select` 结束旧路线」改为「先 `line close` 旧路线，再 `line select` 新路线」。
- 加入三条：第 3 节的「不为绕开拒绝而改市场提交或窗口」，「并行路线从不同源码起步」，以及第 4 节的重叠窗口措辞规则。

### 其他 skill

- `research-graph`：命令带 `--line`。
- `product-doctor/references/fidelity.md`：`research graph --at` 加上 `--line`。

### 不做跨会话的调度、锁或占用标记

AGENTS.md 不允许另造一套并行调度器。两个会话推进同一条路线时，产品仍然安全：写入串行，门槛按路线。要不要这样做由用户决定；skill 不去探测其他会话。

### IDE 服务

- `services/ide/research_graph/serve.py` 在页面没有选定路线时不传 `--line`，遇到多条开着的路线会收到 `LINE_AMBIGUOUS`。改为列出 `open_lines` 让用户选一条。
- `services/ide/agent/src/tools.ts` 和 `chat.ts` 里写的「默认当前路线」要改。

### 评测用例

随 skill 的 PR 一起更新。

- `research-start` 中 prompt 带 `unclosed_lines` 的 5 个：
  - missing-market-commit-offers-runnable-lines
  - new-session-asks-continue-or-switch
  - old-contract-line-closes-not-continued
  - old-contract-restart-option-says-new-rule
  - readiness-checks-checkout-on-main
- `research-start` 中 criteria 写「current line」的 5 个：
  - contract-restart-registers-root
  - entry-reads-large-outputs-to-files
  - line-change-designs-new-starts
  - line-options-registrable-and-covered
  - resume-keeps-route
- `research-round` 中的 2 个：contract-change-new-line、root-scope-bounded-choice。

## 设计站、拒绝文案与测试

### 设计站

文档先于代码。要改的是以下页面里涉及当前路线、`unclosed_lines`、`LINE_OPEN`／`LINE_ENDED`、`line_trials` 的段落，中英两种语言都改：

- `entry` 的 `E.4`；
- `design-code-ledger`、`design-code-cli`、`design-code-registration`、`design-code-report`；
- `design-skill-research-start`；
- `ledger-runtime`。

### 拒绝与帮助文案

- `ledger/refusals.py` 里的 `LINE_OPEN`、`LINE_ENDED`、`LINE_UNKNOWN`（「省略 --line 读当前路线」）、`RESEARCH_LINE_REQUIRED`、`WINDOW_MISMATCH`。
- `cli/main.py` 中以下命令的帮助：`line select`、`line close`、`line targets`、`registration add`、`research status`、`research state`、`research graph`。

### 测试

- `tests/ledger/test_lines.py`、`tests/ledger/test_targets.py`
- `tests/registration/test_register.py`
- `tests/registration/test_precheck.py`：第二条路线与 World 路线同键，在 (a) 下会被拒，要改用不同的窗口。
- `tests/report/test_status.py`、`tests/report/test_reports.py`、`tests/report/test_integrity.py`、`tests/report/test_graph.py`
- `tests/cli/test_commands.py`

### 旧计划

`single-current-research-line.zh.md` 和 `line-close-tags.zh.md` 开头各加一行，注明已被本计划取代（后者只取代封盘点和「当前线不封」两条）。

## 待用户批准

依据是 AGENTS.md：改变拒绝或审计检查需要用户明确授权。

1. **封盘点**：从「下一条路线诞生提交的父提交」改为「关线时的头提交」。这推翻 10-21 定稿里的那一条。
2. **删除 `LINE_OPEN`**：开着的路线随时可以关。
3. **`LINE_CLOSED` 的重放判断**：只比较已有标签的消息。
4. **`LINE_ENDED` 改义并扩大范围**：从「之后选过别的路线」（只用于 `line targets`）改为「已有封盘标签」，并增加用于 `registration add --line` 和 `bind`。
5. **`RESEARCH_LINE_REQUIRED` 改义**：从「没有路线记录」改为「没有开着的路线」。
6. **新增 `LINE_AMBIGUOUS`**：写命令和 `research graph` 拒绝，`research state` 在 `gates` 里报告。
7. **新增 `LINE_DATA_TAKEN`**（方案 (a)）。如果用户选 (b)，这一项换成新增存储字段，先做评审。
8. **`bind` 改按登记所属路线检查**：加上市场提交这个条件，`bind` 里不再出现 `WINDOW_MISMATCH`，路线已关时返回 `LINE_ENDED`。
9. **试验归属与门槛范围**：`line_trials` 按登记所属路线认定试验；`INTERPRETATION_REQUIRED` 和 `REVIEW_DUE` 不再包含同键前任路线的试验；`retry_of` 免解释只认同一路线的登记。
10. **封存写入遇到 `CONCURRENT_WRITE` 时有界重试**：适用于 `seal_capture`、`ingest_run`、`ingest_capture_refusal`。这一项可以单独批准。
11. **输出约定**：`unclosed_lines` 改为 `open_lines`；`line close` 去掉 `ended_by`；`line select` 的重放扩大到任何一条开着的路线；有歧义时 `research status` 的 `comparison` 为 null。
12. **skill 规则**：按第 6 节修改 `research-start`、`research-round`、`research-graph`、`product-doctor`，包括第 3、4 节新增的三条。

## 预计拆成的 PR

都以 `main` 为基，不叠加。

1. `docs(plans): ...`：本计划，以及两份旧计划的「已取代」标注（本 PR）。
2. `fix(ledger): retry sealing writes on a concurrent write`：第 10 项，与其他项无关，可以先合。
3. `docs(rd): ...`：设计站 `E.4` 和各页的中英双语，改成开着的路线可以有多条的模型。文档先行。
4. `feat(ledger)!: keep several research lines open`：第 1–9、11 项。涉及 `ledger/lines.py`、`ledger/targets.py`、`registration/register.py`、`report/status.py`、`report/graph.py`、`cli/main.py`、`ledger/refusals.py`，以及上面列出的测试。
5. `fix(ide): pick an open line for the research graph`：IDE 服务，在 4 合并之后。
6. `fix(skills): ...`：第 12 项和受影响的评测用例，在 4 合并之后，因为 skill 要读 `open_lines`。
