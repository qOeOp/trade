# Constitution

> plan-preflight 的规则总集。自然语言承载，LLM 读 + 当前 plan + 最新 observe 判 `must_fail / should_warn / context_notes`。**新增规则 = 往这份文档加一句话**，不改 schema、不改 preflight 代码。
>
> 真正防爆仓的"硬 invariant"在代码里（见 [SKILL.md](SKILL.md) 的 "Hard Invariant" 段），不在本文件。本文件承载"会亏钱但不会爆仓"的判断。
>
> **ack 纪律**：SHOULD 可由 plan `acknowledgements[]` 条目带具体 reason 放行。同 clause-id 在同一 chain 内以不同 reason 累计超 3 次 → 本 clause 升级为 MUST（自动）。同 reason 不重复计数。

---

## 术语

- `plan`：当前 chain 最近一条 `observe.body` 的"意图段"（thesis / entry_intent / exit_intent / invalidation / stop_price / risk_budget_usdt / strategy_ref / expected_rr_net / valid_until_at / acknowledgements）；详见 [design-architecture.md](../../../docs/design-architecture.md) 的 Plan 设计
- `observe`：最近一条 `observe` 事件的 body（含意图段 + 证据段）
- `equity_live`：`observe.account.equity_usdt`
- `strategy`：plan.strategy_ref 指向的 strategy_pool 条目
- `target_action`：preflight 调用方声明本轮即将执行的动作（`open_chain` / `place_order` / `move_stop` / `cancel` / `close` / `no_action`）
- `account`：`./data/account_config.json`（只含阈值 / 比例，不含 live equity）

> **平台范围**：本工程只做 Binance USDM 永续 4H+ swing。所有 plan 默认 USDM；不做 probe / 日内。

---

## MUST（违反直接拒写，无法 ack 放行）

### C-PLAN-INTENT-COMPLETE（plan 意图段必须完整）

**scope**：任何 `target_action != 'no_action'`
**check**（机械执行）：以下字段全部非空：`symbol / side / stop_price / risk_budget_usdt / strategy_ref / thesis / entry_intent / exit_intent / invalidation`；`expected_rr_net` 在 4H+ swing 项目层默认必填
**why**：plan 是 agent 执行依据；任一段缺失等于让 agent 自由发挥

### C-EXEC-STOP-MARK（合约止损必须按标记价触发）

**scope**：plan 含 stop（恒成立）
**check**：stop 触发价语义必须是 mark price。执行层默认 mark；若 thesis / exit_intent 显式声明 last price，拒
**why**：last price 触发在插针行情会误杀

### C-EXEC-ARMED-PRECHECK（合约新挂单必须过预检）

**scope**：`target_action='place_order'`（含开仓 / 加仓）
**check**：上一条 `order_fill` 事件的 body 里 `precheck.passed = true` 且覆盖 `positionSide / stepSize / minQty / minNotional / openOrders / availableBalance`。或 preflight 调用方必须显式声明本轮将在 EXECUTE 内即时预检
**why**：不过预检的合约单会被交易所拒或成交错量

### C-EXEC-LIQ-BUFFER（合约方向仓必须留爆仓缓冲）

**scope**：`target_action='place_order'` 且 plan.side ∈ ('long', 'short')
**check**：最近 observe 的 liquidation 估算里距爆仓价的 buffer_pct > 0 且 ≥ risk_budget_usdt 对应 stop 距离 × 2
**why**：止损到爆仓之间没空间 = 一次滑点归零

### C-EXEC-MARGIN-POSITION-MODE（合约新挂单必须显式声明仓位模式）

**scope**：`target_action='place_order'`
**check**：上一条 `order_fill` 事件的 body 或 plan 关联 strategy.policy 必须明确声明 `margin_mode (isolated|crossed)` 和 `position_mode (one-way|hedge / BOTH|LONG|SHORT)`，不能让脚本走默认值
**why**：默认 margin_mode 与账户实际不一致时杠杆计算出错；hedge 账户走 one-way 会把多空腿冲掉

### C-EXEC-OTOCO-VISIBILITY（OTOCO 必须标母单可见性）

**scope**：执行层声明本动作走 OTOCO
**check**：`order_fill` 事件 body 声明 `visibility=mother-only`
**why**：API 读不到附带 TP/SL 细节，不标记会让对账把"未知"误当"缺失"

### C-EXEC-OBSERVE-FRESH（任何执行动作前 observe 不许过期）

**scope**：`target_action != 'no_action'`
**check**（机械执行）：最近 observe 的 `microstructure.snapshot_at` 距 now ≤ 30 秒；20-30 秒之间 DECISION_CARD 标黄但允许；> 30 秒拒
**why**：funding / OI / orderbook 过期会让 context 判断失真，严重时止损点不对

### C-PLAN-VALID-WINDOW-NOT-EXPIRED（plan 若声明有效期则不得过期）

**scope**：`target_action='place_order'` 且 `plan.valid_until_at != null`
**check**（机械执行）：`now <= plan.valid_until_at`
**why**：过期 setup 继续沿旧观察执行，最容易把"当时能做"错当成"现在还能做"

### C-PLAN-INVALIDATION-TRIGGERED（setup 失效后不得继续执行）

**scope**：`target_action='place_order'`，且 plan.invalidation 描述了价格条件
**check**（LLM 判定）：LLM 读 plan.invalidation 自然语言 + `latest_observe.microstructure` 当前价格 / 多周期收盘，判断 invalidation 条件是否已触发；触发即拒，并要求 agent 改走 `close` 或 `no_action`
**why**：invalidation 是 thesis 废位（不同于 stop 止血价），已穿过的 plan 继续执行等于在已失效的 setup 上扣扳机

### C-RISK-OPEN-RISK-CAP（成交后账户累计风险不超上限）

**scope**：任何 `target_action='place_order'`
**check**：由硬 invariant 代码强制；本 clause 在 constitution 里只做展示，供 DECISION_CARD Checks 行读取
**why**：唯一真会爆仓的底线，所以写成代码 invariant 不走 LLM

### C-RISK-DAILY-LOSS-FLOOR（单日累计亏损不穿底）

**scope**：任何 `target_action='place_order'`
**check**：由硬 invariant 代码强制；本 clause 在 constitution 里只做展示
**why**：今日已亏到该收手了还在加单是手贱，写成代码不走 LLM

### C-RISK-BUDGET-SELF-CONSISTENT（风险预算字段自洽）

**scope**：`target_action='place_order'`
**check**：plan 若同时写了 stop 距离和预期 quantity，`(entry-stop).abs × quantity ≈ risk_budget_usdt`（±10% 容差）
**why**：字段之间数字对不上，后续所有聚合都错

### C-DECISION-CARD-COMPLETE（DECISION_CARD 必须能完整渲染）

**scope**：`target_action != 'no_action'`
**check**：preflight 自身渲染 DECISION_CARD 6 行，任何关键字段缺失导致卡渲染失败 → 拒。Checks 行自身的 ✗ 不允许非空
**why**：卡渲染成功即字段齐全，替代多条"必填字段"规则

---

## SHOULD（默认拒写，带 `acknowledgements[]` 具体 reason 可放行）

### C-EXEC-STOP-HAS-STRUCTURE（止损必须有结构化依据）

**scope**：plan 含 stop（恒成立）
**check**：`plan.thesis` 或 `plan.exit_intent` 中包含止损依据描述（结构位 / 关键高低点 / 成交密集区 / 心理位 / ATR 距离）；不能只写"stop=X"无锚点
**典型 ack reason**："纯 ATR 1.5x 距离，setup 在无 prior swing 的区域如 BTC 新高位探针"

### C-EXEC-FUNDING-IN-EXPECTED-RR（永续 4H+ 持仓必须把 funding 算进 expected RR）

**scope**：strategy.policy 或 plan.thesis / exit_intent 暗示持仓 ≥ 4h
**check**：thesis / exit_intent / expected_rr_net 字段附近出现 "funding" 相关字符串且量化（百分比或绝对值）
**典型 ack reason**："本 plan funding rate 接近 0；或父仓 hedge 已抵消 funding"

### C-EXEC-FUNDING-IN-BREAKEVEN（4H+ 持仓 break_even 应折入 funding）

**scope**：plan.exit_intent 描述了 break_even 或保本移止损规则，且持仓预期 ≥ 4h
**check**：exit_intent 里明示 "break_even 折入累计 funding"（或 LLM 判断已表达此意）
**典型 ack reason**："本 plan funding rate 接近 0"
**why**：入场前 expected_rr_net 算了 funding，但持仓中段触发 break_even 时若用 entry_avg 不含 funding，等于把"看似保本"的 RR 实际亏掉累积 funding

### C-EXEC-SLIPPAGE-EMPIRICAL（市价类成交滑点必须基于实测）

**scope**：plan.entry_intent / exit_intent 暗示市价或追价类成交
**check**：最近 observe 或 order_fill 事件 body 里 slippage 估算有实测基础（最近 N 笔大单、orderbook 深度）
**典型 ack reason**："高流动性主流币如 BTC/ETH，历史滑点一致低于 0.05%"

### C-RISK-PARTIAL-FILL-ADJUST（撤剩余档后下一条 observe 必须收紧 risk_budget）

**scope**：plan.entry_intent 描述了分批建仓，且 `current_orders` 中本 chain 的剩余档已被撤销，下一条 observe 升级 plan 前
**check**（LLM 判定）：新 observe.body 的 `risk_budget_usdt` 已收紧到 "已成交档累计 size × |entry_avg - stop|"（±5% 容差）
**典型 ack reason**："剩余档刚撤但即将以新价格重挂，本轮 observe 仅过渡用"
**why**：`risk_budget_usdt` 是全档假设；撤档不收紧会让 open risk invariant 用过期数字算敞口

### C-PLAN-VALIDITY-WINDOW-DECLARED（等待型 plan 应声明有效窗口）

**scope**：`target_action='place_order'` 且 plan.entry_intent 暗示等待型条件（非立即成交）
**check**：`plan.valid_until_at != null`
**典型 ack reason**："结构级 swing wait，不设 clock stop；只要关键结构未坏就继续等"

### C-MARKET-MICROSTRUCTURE-SNAPSHOT（合约 plan 应带微结构快照）

**scope**：`target_action='place_order'`
**check**：最近 observe body 含 `microstructure.{funding.current_rate, open_interest.oi_usdt, long_short_ratio, taker_buy_sell_ratio}`
**典型 ack reason**："hedge 腿不基于微结构判断，父仓已覆盖"

### C-MARKET-FUNDING-EXTREME（极端 funding 必须 thesis 提及）

**scope**：`target_action='place_order'` 且 `observe.microstructure.funding.current_rate` 绝对值 > 0.001 (0.1% per 8h)
**check**：`plan.thesis` 或 `plan.exit_intent` 含 "funding" 字符串
**典型 ack reason**："本 plan 持仓 < 8h，funding 不影响"（4H+ 项目层下罕见）

### C-MARKET-CLUSTER-GROSS（同簇 gross 超阈值应 ack）

**scope**：`target_action='place_order'` 且 `account.max_correlated_gross_exposure_usdt` 已配置
**check**：加上本 plan 后的同簇 gross ≤ 阈值
**典型 ack reason**："本腿与已存在反向仓属对冲设计意图，gross 上升不代表风险上升"

### C-MARKET-CLUSTER-NET（同簇 net 超阈值应 ack）

**scope**：`target_action='place_order'` 且 `account.max_correlated_exposure_usdt` 已配置
**check**：加上本 plan 后的同簇 net ≤ 阈值
**典型 ack reason**："本 plan 与旧链属反向，实际降低净敞口"

### C-RECON-CHAIN-NOT-STUCK（对账 stuck 的 chain 不得继续动作）

**scope**：`target_action != 'no_action'` 且本 chain 最近 observe.body.reconcile_diffs 连续 ≥ 3 轮非空
**check**：连续 3 轮对账差异未消除 → 拒所有新动作直至人工介入
**典型 ack reason**：通常不允许 ack；除非本轮 observe 已显式记录人工核对结论
**why**：事件流与交易所失同步时再下单等于盲打

---

## CONTEXT（不拦，渲染到卡片 Checks 行供人读）

### C-CTX-CATALYST-IN-WINDOW（持仓窗口内有 catalyst）

**显示条件**：最近 observe 的 catalyst 描述在预期持仓窗口内含 high/med impact 事件
**展示文本**：`"FOMC in 3h (high)"` 或类似
**说明**：不是拒绝条件，提醒人读。strategy.policy 若写了"catalyst 处置 = carry-through"则不再二次提醒

### C-CTX-REGIME-DRIFT（regime 漂移与 plan 方向矛盾）

**显示条件**：最近 observe 的 regime 与 plan.side 暗示方向矛盾（如 plan 做多但主周期 regime=trending-down）
**展示文本**：`"regime drift: plan is long, 4H=trending-down"`
**说明**：不拦——可能是反手信号或均值回归 setup；提醒人确认

### C-CTX-HOLDING-OVER-POLICY（实际持仓已超 policy 建议节奏）

**显示条件**：本 chain 已 filled 状态下，reduce `order_fill` 得到的实际持仓时长超过 strategy.policy 建议节奏（如 S-GENERIC-MEANREVERT 建议 4-24h）
**展示文本**：`"held 6h, S-GENERIC-MEANREVERT 建议 < 24h"`
**说明**：提醒复看，不拦

---

## 附录：如何增加一条新规则

1. 决定档位：MUST / SHOULD / CONTEXT
2. 起一个 clause-id：`C-<domain>-<keyword>`；domain 建议 `EXEC / RISK / MARKET / PLAN / RECON / CTX`
3. 写 scope（什么条件下触发） + check（检查什么） + why 或典型 ack reason
4. 一句话说明 rationale
5. **完**。不需要改 plan-preflight 代码、不需要改 schema、不需要 migration

git history 即版本记录；若规则被废止，在本文档用 `~~删除线~~` 保留一段时间方便审计，再彻底删。

---

## 已删除条款（迁移说明）

| 旧 clause | 删除原因 |
| --- | --- |
| C-PLAN-TRIGGER-STRUCTURED | trigger 不再是结构化字段，收进 entry_intent 自然语言 |
| C-RISK-PROBE-CAP | MVP 不做 probe |
| C-PLAN-INVALIDATION-PLACEMENT | invalidation 不再是 price 字段，是自然语言；位置约束由 LLM 读判断 |
| C-EXEC-TRAIL-STRUCTURED | management 结构化已删，trail 收进 exit_intent 自然语言 |
| C-EXEC-ADD-POSITION-PRESET | tranches 结构化已删，加仓档收进 entry_intent |
| C-EXEC-HOLDING-TIMEBOX-DECLARED | max_holding_minutes 字段已删，时间约束收进 exit_intent |
| C-MARKET-HEDGE-NET-EXPOSURE | hedge 启用推迟；待 plan_relation 实际启用时再加回 |
