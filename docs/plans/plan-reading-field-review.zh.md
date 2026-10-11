# 计划级胜率读数：字段评审与决定（WS1）

状态：已实施（WS1 PR2）。来源：[rd-round-audit-refactor-plan.zh.md](rd-round-audit-refactor-plan.zh.md) WS1 共识第 3、4、10 条。

## 要加什么

`artifacts report` 增加 `plans`：`{closed, wins, win_rate, open}`。`compare --analysis` 增加 `plans.closed`、`plans.win_rate` 两项配对读数；`compare` 的基础指标去掉 `closed_trade_win_rate`；记录简报的指标白名单去掉它。不新增任何 Dolt 存储字段或 schema。

## 独立评审（2026-10-11，独立子代理，只读）

按 AGENTS.md 的四问：

- **消费者**：research-round 的胜率门槛（`feasibility.md` 第 2 道）和用户的胜率验收；`compare --analysis` 的候选对对照。
- **独立事实**：每张单恰好属于一个计划、每个持仓周期恰好属于一个计划，且同一币种的计划不重叠。只有这三点被代码验过，计数才可信；Agent 自己写脚本算就是自己给自己打分。
- **为什么现有字段不行**：`closed_trade_win_rate` 按 NETTING 持仓周期计，不检查计划身份；`closing_order_tags` 只有平仓单的标签；`tables()` 加 Agent 脚本能算，但属自评。
- **是否属于信任边界**：契约检查和计数属于产品；未成交计划数、计划净额、口径说明属于描述统计或可推导，删去。

评审结论：A（`plans` 读数）、B（compare）接受但要修改；C（从运行器 summary 删字段）按原样否决；D（不加存储字段）接受。

## 采纳的修改

- 只输出 `closed`、`wins`、`win_rate`、`open`。去掉 `net_usdt`（一计划一周期时等于已平仓周期的 `reported_realized_pnl_usdt`）、`unfilled`（订单漏斗，描述统计）和 `definition`（方法由 `analysis` 源码哈希固定）。
- **一个计划最多一个持仓周期。** 计划的成交跨两个周期就拒绝：否则策略可以用一个长期计划 ID 挂着剩余挡位，把亏损周期并进盈利计划。计划持平时策略须撤掉它剩下的单。
- **已平仓 = 有成交且期末持平**，不看是否还有挂单；否则一张悬挂的单就能把亏损计划挡在分母外。
- **期末未平的计划算非赢**：`win_rate = wins / (closed + open)`，`open` 单列。两位评审意见不一（一位要求算非赢，一位认为这属于改目标口径、应交用户）；采用保守口径，因为排除它们会奖励把亏损单拖到期末。若用户另有决定，只改这一处。
- **区间半开**：同一币种上，后一计划的开始早于前一计划的结束才算重叠；首尾同一纳秒不算。OUO 兄弟单与平仓成交同纳秒撤销，真实封存里也有同一时刻平掉的两个周期。纳秒并列无法从 `orders.csv` 排序，真正的防线是"一个周期只属于一个计划"。
- 计划起点 = 其订单最早的 `ts_init`；终点 = 其订单最晚的 `ts_last` 与其周期平仓 `ts_last` 中的较晚者；期末仍未终结的单或未平的周期使计划延续到期末。不用原生 `ts_closed` 文本。同一币种按起点排序，后一计划的起点早于此前所有计划中最晚的终点即重叠；起点等于终点的计划（所有单一提交就终结，例如被拒）什么也没持有，不参与重叠判断，否则同一时刻的判定会取决于计划名的排序。
- 报告缺少计划读数所需的值（列缺失、时间戳为空、标签不可读）或封存没有 `orders.csv` 时，同样给 null 和原因，不抛出未处理的异常。（实现后的独立代码审查补出的四处。）
- 计划标签规则是"恰好一个以 `plan:` 开头的标签，其他标签照留"：审计的保护检查和退出原因读数依赖 `STOP_LOSS` / `TAKE_PROFIT` 标签。
- `report()` 原本不读 `orders.csv`，现在读。
- 拒绝时 `plans` 为 null，原因写进 `limitations`（模块既有约定），以 `plans is null:` 开头。

## 对运行器 summary 的处理（C 的修正版）

- **保留** `winning_trades`、`closed_trade_win_rate`、`win_rate_definition`：封存审计 `audit_tiered_native.py` 和配对工具 `compare_node.py` 要求 `winning_trades`，删掉它就是改审计检查。它们留作描述统计，不再是验收读数。
- `sizing` 改为常量 `{"mode": "strategy_source"}`：`run.schema.json` 要求存储 `account.sizing`，compare 也比对它；保留键名即不改 schema。
- 删掉 `--risk-budget-bps`、`--coin-notional-cap-pct` 后，策略构造参数变了，运行时契约升为 `r1-native-v3`；只接受 v2 构造参数的已发表策略不能在新镜像上运行。已有封存的 `r1-native-v1/v2` 名称不变，仍可 verify/report。
- `projections.METRIC_FIELDS`：评审建议保留以免隐藏历史值；按用户要求（不再作为验收读数）去掉 `closed_trade_win_rate`，`winning_trades` 保留。完整读取仍能看到原值。
