# Constitution

> plan-preflight 的规则总集。自然语言承载，LLM 读 + 本 plan + 最新 observe 判 `must_fail / should_warn / context_notes`。**新增规则 = 往这份文档加一句话**，不改 schema、不改 preflight 代码。
>
> 真正防爆仓的"硬 invariant"在代码里（见 [SKILL.md](SKILL.md) 的 "Hard Invariant" 段），不在本文件。本文件承载"会亏钱但不会爆仓"的判断。
>
> **ack 纪律**：SHOULD 可由 plan `acknowledgements[]` 条目带具体 reason 放行。同 clause-id 在同一 chain 内以不同 reason 累计超 3 次 → 本 clause 升级为 MUST（自动）。同 reason 不重复计数。

---

## 术语

- `plan`：当前 intent 事件的 body（见 [design-architecture.md](../../../docs/design-architecture.md) 的 DecisionPlan shape）
- `observe`：最近一条 kind='observe' 事件的 body
- `strategy`：plan.strategy_ref 指向的 strategy_pool 条目
- `target_gate`：preflight 调用方声明即将升级到的 gate（drafting / armed / fired）
- `account`：`./data/account_config.json`

> **平台范围**：本工程只做 Binance USDM 永续。所有 plan 默认 USDM；原 scope 谓词里"按品类筛选"的部分已删除。

---

## MUST（违反直接拒写，无法 ack 放行）

### C-EXEC-STOP-MARK（合约止损必须按标记价触发）

**scope**：plan 含 stop
**check**：stop 触发价语义必须是 mark price。plan 文本需明确声明（`thesis` 或 `stop_anchor` 写 mark 字样），否则执行层默认 mark；若 plan 声明 last price，拒
**why**：last price 触发在插针行情会误杀

### C-EXEC-ARMED-PRECHECK（合约升 armed 必须过预检）

**scope**：`target_gate=armed`
**check**：上一条 `order` 事件的 body 里 `precheck.passed = true` 且覆盖 `positionSide / stepSize / minQty / minNotional / openOrders / availableBalance`。或 preflight 调用方必须显式声明本轮将在 EXECUTE 内即时预检
**why**：不过预检的合约单会被交易所拒或成交错量

### C-EXEC-LIQ-BUFFER（合约方向仓必须留爆仓缓冲）

**scope**：`plan.side in ('long','short')` 且 `target_gate=armed`
**check**：最近 observe 的 liquidation 估算里距爆仓价的 buffer_pct > 0 且 ≥ risk_budget_usdt 对应 stop 距离 × 2
**why**：止损到爆仓之间没空间 = 一次滑点归零

### C-EXEC-MARGIN-POSITION-MODE（合约 armed 必须显式声明仓位模式）

**scope**：`target_gate=armed`
**check**：上一条 `order` 事件的 body 或 plan 的关联 strategy.policy 必须明确声明 `margin_mode (isolated|crossed)` 和 `position_mode (one-way|hedge / BOTH|LONG|SHORT)`，不能让脚本走默认值
**why**：用户 / agent 默认 margin_mode 与账户实际不一致时，杠杆计算出错；hedge 账户走 one-way 模式会把多空腿冲掉

### C-EXEC-OTOCO-VISIBILITY（OTOCO 必须标母单可见性）

**scope**：执行层声明本 plan 走 OTOCO
**check**：`order` 事件 body 声明 `visibility=mother-only`
**why**：API 读不到附带 TP/SL 细节，不标记会让对账把"未知"误当"缺失"

### C-EXEC-MICROSTRUCTURE-FRESH（合约升 armed 时微结构不许过期）

**scope**：`target_gate=armed`
**check**：最近 observe 的 `microstructure.snapshot_at` 距 now ≤ 30 秒
**why**：funding / OI / orderbook 过期会让 context 判断失真，严重时止损点不对

### C-PLAN-TRIGGER-STRUCTURED（plan 必须明确 trigger）

**scope**：`target_gate in ('armed','fired')`
**check**：`plan.trigger.type` 非空；若 `type != 'immediate'`，则 `plan.trigger.price` 与 `plan.trigger.timeframe` 必填
**why**：plan 首先服务 agent 执行；没有 trigger 就是在让执行器猜何时送单

### C-PLAN-VALID-WINDOW-NOT-EXPIRED（plan 若声明有效期则不得过期）

**scope**：`target_gate in ('armed','fired')` 且 `plan.valid_until_at != null`
**check**：`now <= plan.valid_until_at`
**why**：过期 setup 继续沿旧观察执行，最容易把"当时能做"错当成"现在还能做"

### C-RISK-OPEN-RISK-CAP（成交后账户累计风险不超上限）

**scope**：任何 `target_gate=armed` 的 plan
**check**：由硬 invariant 代码强制；本 clause 在 constitution 里只做展示，供 DECISION_CARD Checks 行读取
**why**：这是唯一真会爆仓的底线，所以写成代码 invariant 不走 LLM

### C-RISK-PROBE-CAP（probe 硬上限）

**scope**：`plan.strategy_ref = 'S-PROBE-GENERIC'` 或 policy 含 probe 语义
**check**：`plan.risk_budget_usdt ≤ account.equity × account.probe_budget_ratio`
**why**：probe 存在的前提就是严格 size cap 换反应速度，超了就不叫 probe 了

### C-RISK-BUDGET-SELF-CONSISTENT（风险预算字段自洽）

**scope**：任何 `target_gate in ('armed','fired')`
**check**：plan 若同时写了 stop 距离和预期 quantity，`(entry-stop).abs × quantity ≈ risk_budget_usdt`（±10% 容差）。账户层累计上限由硬 invariant 兜底，不在本条
**why**：字段之间数字对不上，后续所有聚合都错

### C-MARKET-HEDGE-NET-EXPOSURE（多腿必须算 net_after_fill）

**scope**：本 chain 或 parent chain 存在 `plan_relation` 且 `target_gate=armed`
**check**：最近 observe body 里 `exposure.net_after_fill != null`，且数值合理（符号、量级）
**why**：对冲 / 多腿场景看净敞口才是真相，不算 = 两边都以为没风险实际 double-expose

### C-DECISION-CARD-COMPLETE（DECISION_CARD 必须能完整渲染）

**scope**：`target_gate=armed` 或 `armed → fired`
**check**：preflight 自身渲染 DECISION_CARD 8 行，任何关键字段缺失导致卡渲染失败 → 拒。Checks 行自身的 ✗ 不允许非空
**why**：卡渲染成功即字段齐全，替代 10 条"必填字段"规则

---

## SHOULD（默认拒写，带 `acknowledgements[]` 具体 reason 可放行）

### C-EXEC-STOP-ANCHOR（止损必须有结构化依据）

**scope**：plan 含 stop
**check**：`plan.stop_anchor` 非空且非敷衍（不是 "ATR" 两字符）；理想含结构位 / 关键高低点 / 成交密集区 / 心理位
**典型 ack reason**："纯 ATR 1.5x 距离，setup 在无 prior swing 的区域如 BTC 新高位探针"

### C-EXEC-FUNDING-IN-EXPECTED-RR（永续持仓 ≥ 4h 必须把 funding 算进 expected RR）

**scope**：strategy.policy 或 thesis 暗示持仓 ≥ 4h
**check**：thesis / exit_note / risk 相关字段里出现 "funding" 相关字符串且量化（百分比或绝对值）
**典型 ack reason**："scalp 持仓 < 1h，funding 影响可忽略"

### C-EXEC-SLIPPAGE-EMPIRICAL（市价类订单 slippage 必须基于实测）

**scope**：`plan.entry.order_type in ('market','stop-market','take-profit-market')`
**check**：最近 observe 或 order 事件 body 里 slippage 估算有实测基础（最近 N 笔大单、orderbook 深度）
**典型 ack reason**："高流动性主流币如 BTC/ETH，历史滑点一致低于 0.05%"

### C-EXEC-TRAIL-STRUCTURED（trail-activate 应结构化）

**scope**：`plan.management.trail != null` 或 `plan.management.break_even_after_rr != null`
**check**：`plan.management.break_even_after_rr` 或 `plan.management.trail.activate_after_rr` 至少有一项；若有 trail，则 `plan.management.trail.mode` 非空
**典型 ack reason**："本 setup 由 operator 临盘接管 trail，agent 只守硬 stop"

### C-EXEC-ADD-POSITION-PRESET（加仓档必须事前定义）

**scope**：`plan.phase=live` 且 `plan.gate=filled` 且已有至少 1 fill，新 intent 事件含第二档 entry
**check**：新 intent 的 `tranches[]` 里匹配该档的条目存在且来自上一版 intent 就已规划
**典型 ack reason**："原 plan 做单入场，盘中突破大阳线加仓属于 setup 升级；注明原因"

### C-PLAN-VALIDITY-WINDOW-DECLARED（等待型 plan 应声明有效窗口）

**scope**：`target_gate=armed` 且 `plan.trigger.type != 'immediate'`
**check**：`plan.valid_until_at != null`
**典型 ack reason**："结构级 swing wait，不设 clock stop；只要关键结构未坏就继续等"

### C-EXEC-HOLDING-TIMEBOX-DECLARED（短持仓 plan 应声明 timebox）

**scope**：`strategy.tags` 或 `plan.strategy_ref` 暗示 `probe / scalp / event-driven`
**check**：`plan.max_holding_minutes != null`
**典型 ack reason**："本 plan 虽是快节奏，但退出完全由结构失效驱动，不设时钟止损"

### C-MARKET-MICROSTRUCTURE-SNAPSHOT（合约 plan 应带微结构快照）

**scope**：`target_gate >= armed-prep`（即将进 armed）
**check**：最近 observe body 含 `microstructure.{funding.current_rate, open_interest.oi_usdt, long_short_ratio, taker_buy_sell_ratio}`
**典型 ack reason**："hedge 腿不基于微结构判断，父仓已覆盖"

### C-MARKET-FUNDING-EXTREME（极端 funding 必须 thesis 提及）

**scope**：`target_gate=armed` 且 `observe.microstructure.funding.current_rate` 绝对值 > 0.001 (0.1% per 8h)
**check**：`plan.thesis` 或 exit_note 含 "funding" 字符串
**典型 ack reason**："本 plan 持仓 < 1h，funding 不影响"

### C-MARKET-CLUSTER-GROSS（同簇 gross 超阈值应 ack）

**scope**：`target_gate=armed` 且 `account.max_correlated_gross_exposure_usdt` 已配置
**check**：加上本 plan 后的同簇 gross ≤ 阈值
**典型 ack reason**："hedge 腿设计意图即提升 gross，由本腿 ack"（`S-HEDGE-GENERIC` 自动附此 ack）

### C-MARKET-CLUSTER-NET（同簇 net 超阈值应 ack）

**scope**：`target_gate=armed` 且 `account.max_correlated_exposure_usdt` 已配置
**check**：加上本 plan 后的同簇 net ≤ 阈值
**典型 ack reason**："本 plan 与旧链属反向，实际降低净敞口"

---

## CONTEXT（不拦，渲染到卡片 Checks 行供人读）

### C-CTX-CATALYST-IN-WINDOW（持仓窗口内有 catalyst）

**显示条件**：最近 observe 的 `catalyst.items` 在预期持仓窗口内有 impact=high/med 的事件
**展示文本**：`"FOMC in 3h (high)"` 或类似
**说明**：不是拒绝条件，提醒人读。strategy.policy 若写了"catalyst 处置 = carry-through"则不再二次提醒

### C-CTX-REGIME-DRIFT（regime 漂移与 plan 方向矛盾）

**显示条件**：最近 observe 的 regime 与 plan.side 暗示方向矛盾（如 plan 做多但主周期 regime=trending-down）
**展示文本**：`"regime drift: plan is long, 4H=trending-down"`
**说明**：不拦——可能是反手信号或均值回归 setup；提醒人确认

### C-CTX-HOLDING-OVER-POLICY（实际持仓已超 policy 建议）

**显示条件**：`plan.phase=live, gate=filled`，reduce `intent + fill` 事件得到的实际持仓时长超过 `plan.max_holding_minutes` 或 strategy.policy 建议节奏
**展示文本**：`"held 6h, plan cap < 240m"` 或 `"held 6h, S-GENERIC-MEANREVERT 建议 < 4h"`
**说明**：提醒复看，不拦

---

## 附录：如何增加一条新规则

1. 决定档位：MUST / SHOULD / CONTEXT
2. 起一个 clause-id：`C-<domain>-<keyword>`；domain 建议 `EXEC / RISK / MARKET / CTX`
3. 写 scope（什么条件下触发） + check（检查什么） + why 或典型 ack reason
4. 一句话说明 rationale
5. **完**。不需要改 plan-preflight 代码、不需要改 schema、不需要 migration

git history 即版本记录；若规则被废止，在本文档用 `~~删除线~~` 保留一段时间方便审计，再彻底删。
