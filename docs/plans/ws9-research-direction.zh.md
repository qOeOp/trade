# WS9 研发方向性：skill 部分的实施记录（2026-10-11）

范围见[重构计划](rd-round-audit-refactor-plan.zh.md) WS9 共识第 2–7 项和验收第 2 项。普查（共识第 1 项、验收第 4 项）等 WS8b 完成后另开会话；纸面重放（验收第 1 项）另成一份记录 `ws9-paper-replay.zh.md`。本次只改 skill 和文档，不改产品代码、市场数据和运行器。

## 1. 删掉了什么、加了什么

- **删除。**
  - research-round 里"每个 goal 开始先读来源"的说法（`source-evidence.md`），改为假设卡或规则需要时才读；
  - 失败后只写一个部件名、不规定下一步的旧第 3 条；
  - WS2 停止规则里"检查看什么"的部分（哪个部件失败、排除了哪些解释、佐证了哪些预测），由共识第 6 项的最小差距取代。
- **新增。**
  - `research-start` skill：研究入口，先收集上下文，只问 goal，普查放在 loop 之前（共识第 7 项）；
  - `research-round/references/hypotheses.md`：假设卡的四个状态、四项内容、开题前的独立审阅、粗糙回放和三条门槛、排除范围与重开（共识第 2、3 项）；
  - `research-round/references/knowledge.md`：知识清单的三节、固定 JSON 格式、存成 evidence bundle 并按版本追加、跨轮次找最新版本（共识第 4 项）；
  - `SKILL.md`：假设一节、"失败先拆部件"表（共识第 5 项）、进度检查（共识第 6 项）；
  - 评测用例 6 条（验收第 2 项）。
- **措辞调整。** `runs.md` 原来规定探索读数"不能用于任何决定"。开题门槛和排除按共识第 3 项正是用探索回放的读数来定，所以改为：可以用来判断粗糙回放（引用 trial ID），但不能用于冻结和确认。

## 2. goal 表核对与字段评审

任务要求：goal 只写三项目标、市场和初始资金；核对 WS2 的 goal 表，删掉用户不该定的字段，改 schema 前按 AGENTS.md 做字段评审。

核对结果：WS2 的 goal 表（`research/records/schema.sql`）和 goal 文件（`GOAL_FIELDS`）里本来就没有 `source_selection`、`first_stage`、`budget_initial_batch`，也没有仓位或风险方案；共识第 2 项第 1 条在 schema 层面已经满足，只需要改 skill 的文字。表里也没有"市场"和"初始资金"两列。

独立子代理评审（只读计划、AGENTS.md、schema、records.py、运行器和 feasibility.md）的意见和决定：

| 候选改动 | 评审意见 | 决定 |
|---|---|---|
| goal 加 `market` | 代码里没有读者；现在只有一个市场，币池由数据层的固定规则决定，不按 goal 选择；市场身份将来由 WS8b 的市场数据 commit 和每月币池表达；当前能跑的只有 37 币一年 Catalog，现在写"USDT 永续前 50"会和所有能跑的运行矛盾 | 不加。等第二个市场真能运行时再加，读者是"运行的数据 commit 和币池属于 goal 的市场"这一检查 |
| goal 加 `initial_capital_usdt`，冻结时核对运行的初始资金 | 初始资金是独立事实（最小名义、步长、成交量占比、单笔手续费都与它有关）；但运行器把 100,000 USDT 写死、不接受参数，每个运行的资金已经存在 `effective_config.native_account` 和 summary 里；现在加这个检查，等于"goal 资金必须是 100,000"，用户给别的数额时会在一轮结束冻结时才被拒，而不是在开始时 | 不存。research-start 照常问初始资金，并告诉用户当前版本固定按 100,000 USDT 运行；用户给了别的数额，开轮前说明，由用户决定。运行器接受资金参数时，再加这一列和核对 |
| 删 `window_start/end` | 用户在入口确认窗口；冻结的窗口核对、提交测试、试验计数都读它 | 保留 |
| 删 `drawdown_measure` | WS1 第 7 条要求的回撤口径；没有代码读它，只有一个取值 | 保留。WS8b 改观测时钟（1m 数据）时，再决定加 `run.drawdown_measure` 和核对，或者删掉 |
| 删 `known_exposure` | 不是用户定的，也没有代码读它；暴露是市场和窗口的事实，更适合放在知识清单；但它来自 WS2 第 11 条，删它要改计划并放宽一个必填键 | 本次不删。在 WS8b 的 schema 第 2 代里一并处理 |

两条共同约束：schema 是第 1 代，已经在活动账本 `research` 的 main 上应用，没有迁移机制。任何改列都要么重建 main（AGENTS.md 规定的"重置账本"，需要用户授权），要么写一个 root `ALTER` 加 `ledger_schema` 升代的路径。另外，把一个 goal 键改为必填或加一个冻结拒绝，属于收紧拒绝检查，同样需要用户授权。WS8b 把 `run.input_identity` 改为市场数据 commit 时本来就要升代，所以上面这些推迟项都并到那一次。

结论：本次**不改 schema**。

## 3. 留给普查会话的问题

写 research-start 时发现两处 WS2 落地后的结构与共识第 1、4、7 项还没有对上，本次不改产品，只记录下来：

1. **普查回放写在哪一轮。** `artifacts run` 没有打开的轮次就拒绝运行（每次回放要先写一行 trial），而开轮要先有带三项目标的 goal。共识第 7 项却要求没有普查时先跑普查、再问三项目标。普查会话要定：普查用一个专门的 goal 开轮，还是允许不带目标的轮次。
2. **普查和知识清单跨轮次计数。** 共识第 1 项第 7 条要求普查回放计入以后冻结时的试验数；但冻结只统计本轮分支上的 trial。知识清单存成 evidence bundle 也只在某一轮的分支上，所以 `knowledge.md` 写的是先列标签、再在已关闭的轮次里找最高版本。普查会话要定跨轮次的试验数怎么报。

## 4. 评测

做法沿用 [skill 产品形态审计](skill-product-form-audit.zh.md) 第十二节：`claude plugin eval`，被测模型 Opus 5.5，评委 Sonnet 5.5，每臂 3 次，每个回答三票、两票通过即算通过。结果在 Git 外：`~/.local/share/trade/skill-evals/research-round/20261011-ws9/` 和 `~/.local/share/trade/skill-evals/research-start/20261011-ws9/`。

新增 6 条用例（验收第 2 项），每条都给出具体读数和一个推动违规的同事意见：

| 用例 | 测的规则 |
|---|---|
| `gross-negative-excludes-class` | 扣费前为负时不调止损、出场和挂单方式，按卡上写的大类记入排除；也不能拿某一年赚钱当信号有效的证据 |
| `no-rationale-no-opening` | 理由是"经典形态、很多人用"，推论是"会赚钱"的卡不能开题，也不能跳过审阅先跑 |
| `user-source-is-a-card` | 用户要求"还原某作者的方法、其他方向先放一放"，这只是一张标注用户提出的卡，不先做来源还原，不插队 |
| `progress-check-min-gap` | 用两项目标的最小差距判断外移，单项过线不算；连续两次无进展就交给用户，不自己改目标 |
| `exclusion-not-self` | 排除范围不能是自己的参数组合，要按机制写，并在回放前写定 |
| `entry-asks-goal-census-first`（research-start） | 入口只问 goal，不问研究方向；没有普查时先确认市场、窗口、资金并跑普查，再问三项目标；用户的想法只是选填假设 |

迭代过程：

1. 第 1 轮：9 条加 skill 3/3。另有两条没过：
   - `user-source-is-a-card` 两臂都是 0/3：加 skill 的回答都把用户的卡排到了最前面（"优先级按你说的来"），有一次还先要视频文字稿去整理规则。不插队和开题前不还原来源这两条只写在 `hypotheses.md` 里，`SKILL.md` 正文没有。改法：把这两条写进 `SKILL.md` 的假设一节。
   - 老用例 `l3-touch-not-pnl` 加 skill 2/3。失败的那次没有算任何触及胜率，而是按新的部件表，从已成交计划算出扣费前为负，结论是"换信号，不调执行，也不重跑上移 1 tick"。旧评分标准第 E 问只认"用原生回放回答上移 1 tick 是否有利"，和共识第 5 项"毛边际为负不调执行"冲突。改法：E 同时接受这种回答，前提是它以原生成交已经扣费前为负为理由。A–D 四问（不从未成交计划推出任何胜率、R 或盈亏）没有改动。
2. 最终（research-round `SKILL.md` SHA-256 `71a7865a…`，research-start `SKILL.md` `9aab6d72…`）：

| 用例 | 加 skill | 不加 |
|---|---|---|
| gross-negative-excludes-class（新） | 3/3 | 3/3 |
| no-rationale-no-opening（新） | 3/3 | 0/3 |
| user-source-is-a-card（新） | 3/3 | 0/3 |
| progress-check-min-gap（新） | 3/3 | 0/3 |
| exclusion-not-self（新） | 3/3 | 3/3 |
| entry-asks-goal-census-first（新，research-start） | 3/3 | 0/3 |
| exposed-window-no-generalization | 3/3 | 0/3 |
| gate-fail-not-rescued-by-size | 3/3 | 2/3 |
| l3-touch-not-pnl | 3/3 | 0/3 |
| own-sizing-not-user-constraint | 3/3 | 0/3 |
| stability-before-freeze | 3/3 | 0/3 |
| vague-direction | 3/3 | 0/3 |

触发用例只跑加 skill 的一臂：该触发时 5/5 触发；不该触发时 3/3 没触发，并且答对。research-start 的入口用例在最后一次改 research-round 之前跑，research-start 本身之后没有改动。

- **没有区分度的两条。** `gross-negative-excludes-class` 和 `exclusion-not-self` 不加 skill 也能通过：题目里已经给了卡上的大类和完整读数，模型不靠 skill 也会拒绝调执行和窄范围。按十二节的先例，这两条保留作回归守卫，不作验收。
- **花费。** 约 31 美元，是订阅额度内的估算：方法用例两轮各约 14、research-start 1.1、单条复跑 0.8、触发 0.8，另有一次中途停掉的运行。
- **局限。**
  - 每臂只有 3 次，只评了 Claude。
  - Git 外的留出用例（`heldout/`）在 WS2 时就仍按旧流程出题，这次没有改写，也没有跑。WS9 的规则因此只有回归用例，没有留出验收。
