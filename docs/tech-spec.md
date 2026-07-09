# Tech Spec

## 1. 范围

- 本文件只讨论 `Binance USDM` 执行层 + `trade.db` 持久化。
- 项目层固定：只做 USDM 永续 4H+ swing；外部 cron（Claude routines / Codex schedule）双轨触发：**慢轨** 1H / 4H 整点跑战略层全流程；**快轨** 5m / 15m 偏移点（如 :05/:20/:35/:50）守护执行层。设计细节见 [design-architecture.md §双轨](design-architecture.md)。
- 当前重点是 `合约开仓`，但为避免后续接口命名漂移，仍把相关 skill 一并列清。
- 慢轨链路：`OBSERVE → 按启用 lane 决策 → 写 action_intent（含 trigger_condition）→ 当 mark 在 range 内时 EXECUTE → 某条 flow 闭合时即时 REVIEW`
- 快轨链路：`reduce flow → 轻量对账 → 检查 trigger_condition → 确定性 gate（G-SPREAD-CAP / G-MARKETABLE-DEPTH-CAP / G-FUNDING-RATE-SPIKE，仅加暴露立即执行）→ 快轨 preflight 子集 → EXECUTE`。快轨 LLM 仅作为 orchestrator 按 prompt 模板顺序调 tool，不做质性判断（不评估"诱多诱空"、不重读 thesis、不重设 invalidation）
- 即使用户已经明确给出 `标的 / 方向 / 笔数 / 杠杆 / 保证金额`，也仍先 append `observe`（含意图段），再执行。

## 2. 共享口径

- `主单`
  定义：建立或增加仓位的 entry 单。
- `保护单`
  定义：止损 / 止盈 / trailing 这类保护腿。
- `普通单路径`
  当前指向：`futuresOrder`
- `algo 单路径`
  当前指向：`futuresCreateAlgoOrder`
- `order type`
  只表示订单形状，不单独决定它属于主单还是保护单。
- `开仓函数`
  当前只指 `USDM 主单落地`，不包含保护、减仓、撤单。
- `live equity`
  定义：最近一条 `observe` 事件里 `account.equity_usdt` 的值；风险护栏（`G-RISK-OPEN-CAP` / `G-RISK-DAY-FLOOR` / `G-BTC-BETA-DIRECTION-CAP` / `G-SINGLE-POSITION-LEVERAGE-CAP` / `G-GROSS-EXPOSURE-CAP`）的实时计算基准，不落 `account_config`
- `current_plan`
  定义：当前 flow 最近一条 `observe.body` 的"意图段"
  - 必填：source / symbol / side / stop_price / risk_budget_usdt / strategy_ref / thesis / entry_intent / exit_intent / invalidation / expected_rr_net / expected_holding_hours
  - 可选：setup_valid_until_at / stop_ladder / takeprofit_ladder / risk_budget_change / aging_decision（仅 aging_state==overdue 时必填）
  - `setup_valid_until_at`：当前 setup 的新鲜度窗口；只约束这段 setup 是否还值得继续沿用，不直接驱动持仓退出
  - `stop_price`：先由 `invalidation` / 结构失效位决定；数量编译器与 leverage guard 只能消费它，不能反向生成或重写它
  - `stop_ladder`：止损推进梯度数组，`[{trigger_price, new_stop, reason}]`；agent 每轮读 ladder + 当前 mark + order_fill 历史自行决定是否发 `sync_protection`（软触发，preflight 不做机械 reduce）
  - `takeprofit_ladder`：分档止盈数组，`[{price, qty_ratio, reason}]`，`sum(qty_ratio) ≤ 1.0`；同样软触发
  - `risk_budget_change`：本轮 `risk_budget_usdt` 相对上一条 observe 的变化，`{delta_usdt, reason}`
- `source`
  定义：observe 由哪条轨道写入。值域 `slow_track | fast_track`。慢轨写完整 observe；快轨写 light observe（thesis / entry_intent / exit_intent / invalidation / setup_valid_until_at / risk_budget_usdt / stop_price / ladder / strategy_ref / symbol / side 段从 `latest_slow_observe` 原样继承，account / microstructure / preflight_result / decision_summary 自采）
- `action_intent`
  定义：本轮收敛的可执行动作。`target_action != no_action` 时必须同时给出 `trigger_condition` 和 `request`
  - `trigger_condition`：硬字段，含 `price_in_range: [low, high]`（当前 mark 必须落在此区间，executor 才会执行）+ `valid_until_at`（action_intent 自身的过期时间，与 observe 顶层的 `setup_valid_until_at` 不同）
  - `request`：结构化执行参数，shape 由 `target_action` 决定，preview 解析后路由到执行 skill
- `execution_contract`
  定义：提交前由 `current_plan + execute 前刚刷新的账户 / 挂单 / 当前 mark + 交易所规格` 编译出的执行快照；是交易所 payload 的唯一真相
- `order_lifecycle`
  定义：执行事件的标准状态词表。值域：
  `intent_created / contract_compiled / submitted / accepted / partially_filled / filled / amended / cancel_requested / cancelled / rejected / expired / unknown / needs_review / reconciled`
  - `submitted / accepted` 不改变仓位
  - `filled / partially_filled / reconciled` 才改变 `current_position`
  - `unknown / needs_review` 阻断新增风险，只允许恢复或防御动作
- `observe snapshot`
  定义：可被 `EXECUTE / preflight` 直接消费的最小完整快照，不是 patch；同条 observe 同时承载意图段 + 证据段

## 3. `binance-account-snapshot`

### 3.1 定位

- 只读账户快照。
- 负责给 `PLAN` 与 `EXECUTE` 提供账户事实源。
- 也负责给 cron 对账阶段提供“补 event”所需的事实输入。
- 不负责执行动作。

### 3.2 当前读取范围

- `futuresAccountInfo`
- `futuresPositionRisk`
- `futuresOpenOrders`
- `futuresGetOpenAlgoOrders`
- `futuresAllOrders`（需 `--symbol --include-history`）
- `futuresGetAllAlgoOrders`（需 `--symbol --include-history`）

### 3.3 当前输出分层

- `account`
  - `equity_usdt`
  - `available_balance_usdt`
  - `snapshot_at`
- `balances`
- `positions`
- `openOrders.regular`
- `openOrders.protective`
- `orderHistory.regular`
- `orderHistory.protective`

### 3.4 当前边界

- 它能把普通挂单和保护单分开，但分类仍是启发式。
- 当前历史读取仍是 `symbol-scoped`，不能一次直接拉全账户所有 symbol 的完整历史订单。
- 对账阶段若仅靠快照无法解释状态变化，应按 `symbol` 补读历史订单 / 成交；能补 `source=reconcile` 事件就继续，不能可靠归属就直接把本轮当作恢复失败处理。
- 对 `OTO / OTOCO` 母单，公共 API 可能读不到附带 TP/SL 细节，只能标记“需要人工确认”。

### 3.5 对开仓函数的意义

- 开仓前用于确认：
  - 当前 `positionSide`
  - 当前 live position
  - 当前普通挂单
  - 当前 algo 保护单
  - 当前杠杆 / 保证金模式相关事实
- 开仓后用于独立核验：
  - 主单是否真的进入 `openOrders.regular`

## 4. `binance-order-preview`

### 4.1 定位

- 执行前预演器。
- 负责把参数翻成“将要走哪条 Binance 方法”的预览结果。
- 不发真实订单。

### 4.2 当前职责

- 接收 `symbol / side / type / quantity / price / stopPrice / positionSide / reduceOnly / closePosition`
- 产出：
  - `request`
  - `execution.method`
  - `execution.skill`
  - `marketContext`
  - `warnings`

### 4.3 当前路由逻辑

- 若识别到 `USDM 保护语境`：
  - 路由到 `futuresCreateAlgoOrder`
  - skill 指向 `binance-position-protect`
- 否则：
  - 路由到 `futuresOrder`
  - skill 指向 `binance-order-place`

### 4.4 当前边界

- 预演的是“参数到方法”的映射，不是“整版 plan 到订单组”的映射。
- 它知道某张单更像主单还是保护单，但还不知道它在整版交易里的角色，例如：
  - 第一笔试仓
  - 第二笔确认
  - 第三笔更深回踩

### 4.5 当前 gaps

- 没有消费正式 plan 结构。重构方向见 [design-architecture.md](design-architecture.md) 的 `Plan 设计`：执行层应消费 `current_plan`（含 `symbol / side / stop_price / risk_budget_usdt / strategy_ref / entry_intent / exit_intent`）+ 同一条 observe 的证据段（含微结构 / 账户事实），产出写成 `order_fill` 事件；不再直接吃零散参数。
- 还没有正式 `execution_contract` 把 `strategy.policy`、`current_plan`、live 账户事实与交易所规格收口成一份提交快照。
- 没有统一输出”这版 plan 需要几张主单、几张保护单”。
- 还没有把 `保证金额 / 杠杆 / 笔数` 编译进来；第一版编译器至少要覆盖 `max_single_position_leverage` 的单持仓约束，不做账户级 gross exposure reservation。

写 skill 成功输出到 `trade-flow` 记账的最低契约见 [execution-skill-contract.md](execution-skill-contract.md)。

## 5. `binance-order-place`

### 5.1 定位

- `USDM 开仓函数` 当前最核心的落地点。
- 负责主单落地，不负责保护、减仓、重建保护。

### 5.2 当前真实能力

- 当前只支持 `USDM` 主单：
  - `LIMIT`
  - `MARKET`
  - `STOP`
  - `STOP_MARKET`
  - `TAKE_PROFIT`
  - `TAKE_PROFIT_MARKET`
- 当前是 `open-only`
  - 拒绝减仓
  - 拒绝平仓
  - 拒绝反手
- 支持显式 `--leverage`
  - 若当前 symbol 杠杆与目标不同，先调用 `futuresLeverage`
  - 然后再提交主单
- 支持 `--test`
  - USDM 走 Binance 官方 `POST /fapi/v1/order/test`
  - 只校验请求，不进入真实撮合

### 5.3 开仓类型矩阵

- 即时开仓
  - `MARKET`
    - 语义：立即成交开仓
    - 当前状态：已支持
  - `LIMIT`
    - 语义：按指定价格挂入场单
    - 当前状态：已支持
- 突破类开仓
  - `BUY STOP / BUY STOP_MARKET`
    - 语义：突破追多
    - 当前状态：已支持
  - `SELL STOP / SELL STOP_MARKET`
    - 语义：跌破追空
    - 当前状态：已支持
- 回撤 / 反弹类开仓
  - `BUY TAKE_PROFIT / BUY TAKE_PROFIT_MARKET`
    - 语义：回撤开多
    - 当前状态：已支持
  - `SELL TAKE_PROFIT / SELL TAKE_PROFIT_MARKET`
    - 语义：反弹开空
    - 当前状态：已支持

### 5.4 为什么 `TAKE_PROFIT*` 也属于主单能力

- `STOP*` 和 `TAKE_PROFIT*` 都只是条件单形状，不天然等于保护单。
- 是否属于保护单，关键看：
  - `reduceOnly`
  - `closePosition`
  - 当前持仓语境
- 因此：
  - `BUY STOP_MARKET + reduceOnly=false`
    - 可以是突破追多主单
  - `SELL STOP_MARKET + reduceOnly=false`
    - 可以是跌破追空主单
  - `BUY TAKE_PROFIT_MARKET + reduceOnly=false`
    - 可以是回撤开多主单
  - `SELL TAKE_PROFIT_MARKET + reduceOnly=false`
    - 可以是反弹开空主单
- `binance-position-protect` 只负责保护腿，不应吸走所有 `STOP* / TAKE_PROFIT*` 类型。

### 5.5 当前输入形状

- `symbol`
- `side`
- `type`
- `quantity`
- `price?`
- `stopPrice?`
- `positionSide`
- `leverage?`
- `workingType?`
- `priceProtect?`

### 5.6 当前输出

- `request`
- `result`
- `leverageAdjustment?`
- `method`
- `mode`

### 5.7 当前边界

- 它吃的是 `quantity`，不吃：
  - `保证金额`
  - `风险预算`
  - `分几笔`
- 它一次只落一张主单。
- 它不负责编译整版 plan。
- 它不负责下单后独立核验。

### 5.8 当前 gaps

- 缺 `保证金额 / 杠杆 / 笔数 -> quantity[]` 编译器。
- 缺多张 entry 的统一提交器。
- 缺提交后回读核验协议。
- 缺与后续保护单的标准衔接点。

### 5.9 脚本里应该补齐什么

- 要补的是 `执行口径`，不是把整份 PRD 搬进脚本。
- `binance-order-place` 脚本里至少应显式拥有三层设计：
  - `输入 shape`
    - 用户或上游 plan 给进来的 entry leg 长什么样
  - `方法路由`
    - 这张单最后走 `futuresOrder`、`/fapi/v1/order/test`，还是未来扩展到别的入口
  - `结果 shape`
    - 返回 `method / mode / request / result / leverageAdjustment`
- 不应该把关键行为继续藏在 SDK 的隐式分流里，否则我们很难稳定回答：
  - 这张单到底算主单还是保护单
  - 这次测试到底测到了哪一层
  - 失败点是在参数、交易所规则，还是脚本编排
- 第一批应先把主单能力补齐到：
  - `LIMIT`
  - `MARKET`
  - `STOP`
  - `STOP_MARKET`
  - `TAKE_PROFIT`
  - `TAKE_PROFIT_MARKET`
- `TRAILING_STOP_MARKET` 暂不放进第一批主单范围：
  - 它更像动态跟随触发
  - 业务上优先级低于前面 6 种标准 entry type

### 5.10 测试分层

- `unit test`
  - 只测参数解析、request builder、路由和签名逻辑
  - 不依赖外网
- `Binance test order`
  - 只测“这个 request 能不能被 Binance 接受”
  - 推荐作为可选集成测试，不默认塞进普通单元测试
- `live order`
  - 只在显式 `--yes` 时触发
  - 才会真的改账户状态

## 6. `binance-order-cancel`

### 6.1 定位

- 撤单器。
- 不属于开仓函数本体，但属于开仓链路的相邻组件。

### 6.2 当前职责

- 撤普通单
- 撤 algo 单
- 支持单笔或整组取消

### 6.3 对开仓函数的意义

- 当 plan 需要“撤旧单再重挂”时，它是前置动作。
- 当前开仓函数还没有把它纳入统一编排。

### 6.4 当前 gaps

- 还没有统一规则决定：
  - 哪些旧单应自动撤
  - 哪些旧单应保留
  - 撤单失败后整版执行如何回滚

## 7. `binance-position-protect`

### 7.1 定位

- 保护单落地器。
- 当前走 `futuresCreateAlgoOrder`。

### 7.2 当前真实能力

- 支持：
  - `STOP`
  - `STOP_MARKET`
  - `TAKE_PROFIT`
  - `TAKE_PROFIT_MARKET`
  - `TRAILING_STOP_MARKET`
- 支持两种语义：
  - 保护当前已有仓位
  - 保护未来计划仓位

### 7.3 当前边界

- 不负责主单开仓。
- 不负责编译“主单成交后什么时候补保护”。
- 不负责整版 bracket 编排。

### 7.4 对开仓函数的意义

- 这就是开仓函数的下游衔接点。
- 开仓函数本身可以先不做保护，但接口命名必须为后续衔接留口。

### 7.5 当前 gaps

- 缺“主单成交后自动接保护”的统一协议。
- 缺 plan 级别的 protection shape。
- 缺对 `planned-position` 与 `live-position` 的统一编译层。

## 8. `binance-position-adjust`

### 8.1 定位

- 已有仓位调整器。
- 只负责已有仓位的数量变化。

### 8.2 当前职责

- `MARKET` 部分减仓
- `MARKET` 全平
- 不取消旧保护
- 不重建新保护

### 8.3 与开仓函数的关系

- 它不是开仓函数的一部分。
- 但如果我们后续把 `entry -> protect -> adjust` 串成统一执行层，它会是持仓阶段的对应组件。

### 8.4 当前 gaps

- 还没有和开仓 plan 共用同一套 plan shape。
- 还没有统一的“从 entry plan 演化成 adjust plan”的桥。
- 还没有和编排执行阶段约定统一的“动作后保护检查”协议。

### 8.5 与保护 skill 的边界

- `binance-position-adjust`
  - 只改仓位数量
- `binance-position-protect`
  - 只设置或重设保护腿
- 保护是否缺失、错位、超量、残留：
  - 不在 `binance-position-adjust` 内部处理
  - 由后续编排执行阶段在所有动作完成后统一检查

## 9. `USDM 开仓函数` 本身

### 9.1 最小目标

- 只解决 `PLAN -> 主单 request[] -> 提交 -> 核验`
- 当前不展开：
  - 保护单编排
  - 减仓编排
  - 撤单编排

### 9.2 最小输入

```md
EntryPlan（编译后的 `execution_contract`）
- source
  - observe_event_key   # 当前 plan 意图段所在 observe 事件
- market: `usdm`
- symbol
- side: `long | short`
- position_side: `BOTH | LONG | SHORT`
- target_leverage?: number
- margin_mode?: `isolated | crossed`
- account_snapshot
  - equity_usdt
  - available_balance_usdt
  - snapshot_at
- entries[]
  - role: `entry | add`
  - type: `LIMIT | MARKET | STOP | STOP_MARKET | TAKE_PROFIT | TAKE_PROFIT_MARKET`
  - price?
  - stop_price?
  - quantity
- verify_policy
```

### 9.3 最小执行步骤

1. 读取 `current_plan`（最近 observe.body 的意图段）+ 同条 observe 的证据段
2. 提交前刚刷新关键执行事实：
   - equity
   - available balance
   - position
   - open regular orders
   - open algo orders
   - current mark
   - best bid / best ask（快轨立即执行场景）
3. 编译 `execution_contract`
   - 把 `position_side / margin_mode / target_leverage / entries[] / account_snapshot` 收口到同一份对象
4. 校验：
   - `symbol`
   - `positionSide`
   - 当前仓位不会被误减
5. 若指定 `target_leverage`
   - 读取当前杠杆
   - 不一致则先调杠杆
6. 将 `entries[]` 逐张编译为主单 request
7. 调用 `binance-order-place`
8. 回读 `openOrders.regular`
9. 输出：
   - 想提交什么
   - 实际提交了什么
   - 哪些已进入交易所
   - 哪些仍未对齐

### 9.4 当前最关键缺口

- 没有正式 `EntryPlan / execution_contract`
- 没有 `保证金额 / 杠杆 / 笔数 -> quantity[]` 编译器
- 没有多张主单统一 orchestration
- 没有标准化核验返回

## 10. 当前开发顺序

### 10.1 第一批

1. 固定 `EntryPlan`
2. 实现 `保证金额 / 杠杆 / 笔数 -> quantity[]`
3. 实现多张 entry 编译器
4. 实现主单后的独立核验协议
5. 把 `source_observe_event_key + execution_contract_snapshot` 一起写进 `order_fill` 事件

### 10.2 第二批

1. 引入 `binance-order-cancel` 到统一编排
2. 给开仓函数补 `marginMode`
3. 固定 `clientOrderId` 命名约定

### 10.3 第三批

1. 接入 `binance-position-protect`
2. 接入 `binance-position-adjust`
3. 收敛为统一执行层协议

### 10.4 cron 运维（与 §10 三批并行推进）

cron 自动化模式必须保证：

1. **双轨调度**：慢轨在整点跑（`0 */1 * * *` / `0 */4 * * *`）；快轨在偏移点跑（如 `5,20,35,50 * * * *`），避开慢轨 LLM 推理窗口。两轨独立 routine / scheduled-task，共用 `./data/trade.db`。
2. **幂等**：每次 EXECUTE 动作前先 reduce `order_fill` + 拉 Binance 实时挂单核对，重复请求不下重单。`clientOrderId` 用 `<chain_id>-<seq>-<action>` 前缀，Binance 侧自动去重，cron 重跑安全。慢轨/快轨用同一套 clientOrderId 规则；快轨 `seq` 自增基于本 flow 已有 order_fill 计数。
3. **abort 偏保守**：cron agent 任意阶段失败 → 只 append 已写入的 observe，不补做后续。下次 cron 重跑读最新事件流决定动作；不确定就 `no_action`。快轨遇到 `reconcile mismatch` 时不补账；若只是保护腿漂移，或 live position 能明确归属且需要先补保护，可先 `sync_protection`，其余缺失事件等下次慢轨入口的全量对账。
4. **本地运维日志**：每次 cron 跑追加一行到 `./data/cron.log`，承载 `run_id / track (slow|fast) / triggered_at / duration_ms / chains_processed / actions_taken / errors / next_cron_at`。文本日志，不入 DB；分析需求出现时再升 SQLite。
5. **异常通知**（通道由 `./profile/notify_config.json` 配置；缺则只写本地日志）：
   - 爆仓护栏（`G-RISK-*`）拒新动作
   - cron / preflight / Binance API 持续失败（含慢轨对账恢复失败、快轨连续 N 轮 reconcile mismatch）
   - 重大 PnL 事件（接近 `max_day_loss_pct`）

## 11. 当前结论

- 当前仓库不是“不能做 USDM 开仓”，而是“主单落地拼图已有，但 plan compiler 还缺”
- 现在最该稳定下来的不是更多零散接口，而是：
  - `EntryPlan / execution_contract`
  - `quantity[]` 编译
  - 多张主单 orchestration
  - 提交后核验协议

## 12. 持久化与数据模型

### 12.1 边界

- [design-architecture.md](design-architecture.md) 回答"为什么是 event-sourcing、Plan 怎么设计、cron 周期怎么走"
- 本节回答 `trade.db` 里到底落什么、怎么读、哪些东西不落库
- 在线主线只写 `./data/trade.db`，当前实现只有一张事件表
- 研究 / calibration / feature / artifact 资产不进 `trade.db`；需要结构化读取时走独立 catalog DB
- OHLCV / replay / backtest 的行情库后续单独走 `./data/ohlcv.db`

### 12.2 `trade.db` 表结构

当前已实现事件表：

```sql
CREATE TABLE plan_event (
    event_key   TEXT PRIMARY KEY,                              -- UUID
    chain_id    TEXT NOT NULL,                                 -- 事件归属（无单独 chain 表）
    kind        TEXT NOT NULL,                                 -- 'observe' | 'order_fill' | 'review'
    body_json   TEXT NOT NULL CHECK(json_valid(body_json)),    -- 各 kind 自带 shape
    created_at  TEXT NOT NULL                                  -- ISO 8601
);

CREATE INDEX idx_chain_time ON plan_event(chain_id, created_at);
CREATE INDEX idx_kind_chain ON plan_event(kind, chain_id);

-- 投影路径加速（按需）：
CREATE INDEX idx_obs_symbol ON plan_event(
    json_extract(body_json, '$.symbol')
) WHERE kind = 'observe';
```

`body_json` 用 SQLite TEXT + `json_valid` CHECK 约束。SQLite JSON1 扩展默认开启，支持 `json_extract` / expression index，可以为投影路径加索引。

具体 body shape 三种，定义见 [design-architecture.md](design-architecture.md)：

| kind | body shape 定义位置 |
| --- | --- |
| `observe` | §observe.body shape |
| `order_fill` | §order_fill.body shape |
| `review` | §REVIEW → review.body shape |

按需补充表：

```sql

CREATE TABLE beta_cache (
    symbol           TEXT NOT NULL,
    computed_date    TEXT NOT NULL,                            -- YYYY-MM-DD (UTC)
    lookback_days    INTEGER NOT NULL,                         -- MVP 固定 30
    beta_full        REAL,                                     -- 全样本 OLS 斜率（vs BTCUSDT）
    beta_downside    REAL,                                     -- BTC return < 0 子集 OLS 斜率
    sample_count     INTEGER NOT NULL,
    downside_count   INTEGER NOT NULL,
    fallback_reason  TEXT,                                     -- null=正常；否则记 fallback 类型
    computed_at      TEXT NOT NULL,                            -- ISO 8601
    PRIMARY KEY (symbol, computed_date)
);

CREATE INDEX idx_beta_symbol_date ON beta_cache(symbol, computed_date DESC);
```

`beta_cache` 只有在 `G-BTC-BETA-DIRECTION-CAP` 进入真实读路径时才落地；当前代码尚未创建该表。落地前不得把它当已存在的数据源。

### 12.3 `data_catalog.db`

`data_catalog.db` 是文件型研究资产的索引层，不保存大 payload。

目标：

- run 可查：一次 slow / fast / R&D / calibration / GC 是谁触发、输入 hash、输出哪些 artifact。
- dataset 可查：一个 manifest 覆盖哪些 symbol / timeframe / 时间范围 / hash。
- artifact 可查：一个 JSON/CSV/report 多大、schema 是什么、谁引用、能否清理。
- evidence 可查：策略升格依赖哪些数据、artifact、review 和 R&D run。

最小 schema：

```sql
CREATE TABLE schema_migration (
    component  TEXT PRIMARY KEY,
    version    INTEGER NOT NULL,
    applied_at TEXT NOT NULL
);

CREATE TABLE run (
    run_id       TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,      -- slow_track | fast_track | rnd | calibration | gc | manual
    status       TEXT NOT NULL,      -- running | completed | failed | skipped
    started_at   TEXT NOT NULL,
    ended_at     TEXT,
    input_hash   TEXT,
    summary_json TEXT CHECK(summary_json IS NULL OR json_valid(summary_json))
);

CREATE TABLE dataset (
    dataset_id    TEXT PRIMARY KEY,
    kind          TEXT NOT NULL,      -- ohlcv | panel | feature_source
    symbol        TEXT,
    timeframe     TEXT,
    source        TEXT,
    first_ts      INTEGER,
    last_ts       INTEGER,
    rows          INTEGER,
    content_hash  TEXT,
    manifest_path TEXT NOT NULL,
    created_at    TEXT NOT NULL
);

CREATE TABLE artifact (
    artifact_id     TEXT PRIMARY KEY,
    path            TEXT NOT NULL UNIQUE,
    type            TEXT NOT NULL,    -- json | jsonl | csv | db | log | report
    bytes           INTEGER NOT NULL,
    content_hash    TEXT,
    schema_id       TEXT,
    retention_class TEXT NOT NULL,    -- durable | evidence | reproducible | ephemeral
    created_at      TEXT NOT NULL,
    summary_json    TEXT CHECK(summary_json IS NULL OR json_valid(summary_json))
);

CREATE TABLE artifact_ref (
    referrer_type TEXT NOT NULL,      -- run | dataset | strategy | evidence | ledger
    referrer_id   TEXT NOT NULL,
    artifact_id   TEXT NOT NULL,
    role          TEXT NOT NULL,      -- input | output | proof | cache | derived_from
    created_at    TEXT NOT NULL,
    PRIMARY KEY (referrer_type, referrer_id, artifact_id, role),
    FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
);

CREATE TABLE strategy_rnd_run (
    run_id       TEXT PRIMARY KEY,
    strategy_id  TEXT,
    candidate_id TEXT,
    family       TEXT,
    stage        TEXT,
    accepted     INTEGER NOT NULL CHECK(accepted IN (0, 1)),
    holdout_key  TEXT,
    artifact_id  TEXT,
    FOREIGN KEY (run_id) REFERENCES run(run_id),
    FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
);

CREATE TABLE strategy_evidence (
    evidence_id  TEXT PRIMARY KEY,
    strategy_id  TEXT NOT NULL,
    kind         TEXT NOT NULL,
    source_ref   TEXT NOT NULL,
    artifact_id  TEXT,
    created_at   TEXT NOT NULL,
    summary_json TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
    FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
);

CREATE TABLE panel (
    panel_id      TEXT PRIMARY KEY,
    purpose       TEXT,
    timeframe     TEXT,
    dataset_count INTEGER,
    symbol_count  INTEGER,
    manifest_path TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    summary_json  TEXT CHECK(summary_json IS NULL OR json_valid(summary_json))
);

CREATE TABLE panel_member (
    panel_id            TEXT NOT NULL,
    dataset_id          TEXT NOT NULL,
    symbol              TEXT,
    manifest_path       TEXT,
    funding_report_path TEXT,
    rows                INTEGER,
    first_ts            INTEGER,
    last_ts             INTEGER,
    artifact_id         TEXT,
    PRIMARY KEY (panel_id, dataset_id),
    FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
);

CREATE TABLE feature_report (
    artifact_id       TEXT PRIMARY KEY,
    symbol            TEXT,
    exchange          TEXT,
    source_manifest   TEXT,
    generated_at      TEXT,
    indicator_count   INTEGER,
    timeframe_count   INTEGER,
    has_market_events INTEGER NOT NULL CHECK(has_market_events IN (0, 1)),
    summary_json      TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
    FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
);

CREATE TABLE research_report (
    artifact_id  TEXT PRIMARY KEY,
    report_kind  TEXT NOT NULL,      -- strategy_rnd_loop | strategy_rnd_campaign | strategy_benchmark | strategy_calibration_suite | strategy_panel_rnd | rd_shadow_tracker
    report_id    TEXT NOT NULL,
    status       TEXT,
    generated_at TEXT,
    summary_json TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
    FOREIGN KEY (artifact_id) REFERENCES artifact(artifact_id)
);

CREATE INDEX idx_artifact_retention ON artifact(retention_class, created_at);
CREATE INDEX idx_dataset_symbol_timeframe ON dataset(symbol, timeframe, last_ts DESC);
CREATE INDEX idx_strategy_evidence_strategy ON strategy_evidence(strategy_id, created_at DESC);
CREATE INDEX idx_panel_member_symbol ON panel_member(symbol);
CREATE INDEX idx_feature_report_symbol ON feature_report(symbol, generated_at DESC);
CREATE INDEX idx_research_report_kind ON research_report(report_kind, generated_at DESC);
```

迁移策略：

- 已落地 catalog schema / scanner / query / stale dry-run / catalog-gc / generation-time writer，不改变现有文件 payload。
- legacy JSONL ledger 仅作为导入兼容；catalog 表保存完整 `record_json`，是 strategy evidence / R&D ledger 的当前存储。
- `schema_migration(component='data_catalog')` 记录当前 catalog schema 版本。
- `cron.log` 不单独建表；JSONL 行归一化进 `run`，原文件作为 `artifact_ref(role=log)`。
- `research_report` 只保存报告摘要；完整 replay / campaign / calibration / panel / tracker payload 仍在文件系统。
- `--catalog-query` 按 path / artifact / symbol / strategy 查结构化索引；`--catalog-stale` 只报告候选。
- `--catalog-gc --yes` 只删除 catalog 判定为 stale 的候选；默认仍是 dry-run。

### 12.4 文件型存储

不进 DB 的：

| 内容 | 介质 | 位置 |
| --- | --- | --- |
| Strategy policy | Markdown 文件（一文件一 strategy，含 frontmatter） | `.agents/skills/trade-flow/strategies/*.md` |
| Strategy evidence ledger | SQLite record + catalog 索引 | `./data/data_catalog.db` → `strategy_evidence` |
| Trading config | JSON | `./profile/trading-config.json` |
| Account config | JSON | `./profile/account_config.json`（兼容输入，后续由 trading config 取代） |
| Notify config | JSON | `./profile/notify_config.json`（兼容输入，后续迁入 trading config；凭证仍只走环境变量） |
| Cron 运维日志 | JSONL 原始记录 + catalog 索引 | `./data/cron.log` |
| OHLCV / 市场数据 | CSV + manifest + catalog 索引 | `./data/ohlcv/` |
| 大型 feature / replay / campaign report | 文件 payload + catalog 索引 | 默认 `./tmp/artifacts/`；准入 / 复盘证据才归档 `./data/artifacts/` |

Git 边界与 data 留存规则见 [data-hygiene.md](data-hygiene.md)。

统一交易配置设计见 [trading-config.md](trading-config.md)。执行、preflight、R&D 后续应消费编译后的 `runtime_policy`，不再各自散读 `account_config` 字段。

Strategy 文件 frontmatter shape：

```yaml
---
strategy_id: S-GENERIC-TREND
name: 通用趋势跟随
status: draft | shadow | live-small | paused
tags: [directional, technical]
---

# S-GENERIC-TREND

policy markdown（setup / 失效 / EV / regime / catalyst / 持仓 / size policy）...
```

trade-flow 启动时遍历 `strategies/*.md`，按 frontmatter 索引到内存 map；不入 DB。

Strategy evidence ledger 规则：

- replay evidence 绑定 `policy_hash + harness_hash + data_hash + assumptions_hash`；`data_hash` 覆盖 OHLCV 与实际消费的 factor report，任一变化或 checksum 失配后 stale
- `draft -> shadow` 需要 fingerprint fresh replay 正收益；chronological tail split 只作 selection validation，准入必须是 locked holdout / walk-forward
- `anti_overfit.oos_stats.sample_count >= 10`，OOS 表现必须为正
- `anti_overfit.trial_count > 10` 或 `parameter_count > 8` 直接拒绝升格
- 数据必须来自 schema v2、仅闭合 K 线且 checksum 可核验的 manifest
- robustness 必须覆盖至少两个 regime 分桶、额外单边 5 bps 成本与预声明 ±10% 参数扰动

### 12.4 存储约束

- `plan_event` 是 append-only；不维护 current 表 / history 表双写
- `kind` 仅三种：`observe / order_fill / review`，trade-flow 写入时遇到未知 kind 立刻 warn（防 typo 静默落库）
- `body_json` 不做数据库层 schema 强约束（除 `json_valid`）；shape 由 `kind` 决定，应用层校验
- `observe.body_json` 必须是"最小完整快照"（含 `source` + 意图段 + `action_intent` + 证据段 + `preflight_result` + `decision_summary`），不是 patch
- `observe.body_json.source` 必填，值域 `slow_track | fast_track`；快轨 light observe 写入时，战略层字段（thesis / entry_intent / exit_intent / invalidation / setup_valid_until_at / risk_budget_usdt / stop_price / ladder / strategy_ref / symbol / side）从 `latest_slow_observe` 原样继承
- `observe.body_json.action_intent` 在 `target_action != no_action` 时必填 `trigger_condition`（含 `price_in_range: [low, high]` + `valid_until_at`）和 `request`；executor（慢轨/快轨共用）只在 mark 落在 range 内且未过期时执行
- `observe.body_json` 意图段的 `stop_ladder` / `takeprofit_ladder` / `risk_budget_change` 字段可选；写入时遵循：
  - `stop_ladder` 单调（long: trigger_price 与 new_stop 同向递增；short 反向）—— `G-STOP-LADDER-MONOTONIC`
  - `takeprofit_ladder.qty_ratio` 之和 ≤ 1.0 —— `G-TP-LADDER-RATIO-CAP`
  - ladder 是软触发：agent 每轮读 ladder + 当前 mark + order_fill 历史自行决定是否发 `sync_protection`；preflight 不做"已触发档位"的机械 reduce
  - `risk_budget_change` 在 `risk_budget_usdt` 与上一条 observe 不同时建议填，由 LLM 在自然语言层面判完整性
- 快轨写权限边界（应用层校验）：
  - 加暴露方向（`place_entry` / `adjust_position` 加仓段）必须有慢轨预设的 `trigger_condition` 授权；快轨不能主动发起
  - 防御方向（`cancel_order` / `sync_protection` / `adjust_position` 减仓段）快轨可自主发起
  - 战略层字段（thesis 等）必须继承 `latest_slow_observe`，不修改
- `order_fill.body_json` shape 见 [design-architecture.md §order_fill.body shape](design-architecture.md)；`source: trade_flow | reconcile` 标识来源（主动执行 vs 对账补录）；可选 `source_observe_event_key` 引用本笔 fill 对应的决策 observe（慢轨或快轨写的 observe 都可被引用）
- `lifecycle_status` 是推荐状态字段；旧事件可只含 `sub_kind`，reducer 必须向后兼容。
- reducer 只在 `sub_kind in (fill, partial_fill)` 或 `lifecycle_status in (filled, partially_filled, reconciled)` 时改变 `current_position`。
- `lifecycle_status in (unknown, needs_review)` 时，executor 必须拒绝 `place_entry / adjust_position add`；`cancel_order / sync_protection / adjust_position reduce` 可作为防御动作继续。
- `rejected / expired / cancelled` 只关闭对应 `current_orders`，不得修改仓位。
- `review.body_json` 由某次仓位 / plan 阶段性闭合时写入；单条 flow 默认只写 1 条 terminal `review`；同一 lane 会跨多条历史 flow 累积多条 `review`
  - review 是 **flow 级终局复盘**，不是 fill / tranche 级；分批成交、加仓、减仓、部分止盈都归同一条 review
  - 数字字段（`net_pnl_usdt / fee_usdt / funding_usdt / slippage_usdt_total / initial_risk_usdt / max_live_risk_usdt / r_multiple / mfe_r / mae_r / holding_hours`）全部由 reducer / executor 确定性生成；LLM 不改数字
  - `r_multiple` 的 canonical 基数固定为 `max_live_risk_usdt`，不使用 first observe 的 `risk_budget_usdt`
  - 完整 shape 与口径见 [design-architecture.md §REVIEW → review.body shape](design-architecture.md)
- `chain_id` 由**慢轨**在某 lane 当前无 active flow 且本轮识别到新 setup 时生成 UUID，写进 first observe 的 `plan_event.chain_id`；快轨不创建 flow（bootstrap 是战略层判断）。同一笔机会后续慢轨/快轨都沿用该 `chain_id` append 事件；只要同一 lane 仍有 active flow，就不再为同 lane 新理由另开 `chain_id`，而是并回原 flow 管理；同一 lane 只有在当前 flow 闭合后，后续新机会才由慢轨再开新 `chain_id`
- 微结构 / 市场数据直接内嵌 `observe.body.microstructure`；不建独立 market_snapshot 表（单 flow 单 symbol 阶段不需去重；多 flow 同 symbol 并行出现时再抽）
- 投影视图不落库；`trade-flow / preflight / reducer` 读时计算
- flow semantics 直接写在主流程文档里，hard guards 直接走代码或脚本
- Strategy 池不作为表存在；strategy 走 markdown 文件，frontmatter 即元数据

### 12.5 投影视图

| 投影 | 语义 | 实现 |
| --- | --- | --- |
| `flows` | 全部历史 / 活跃 flow | `SELECT chain_id, MIN(created_at) AS bootstrapped_at, MAX(created_at) AS last_event_at FROM plan_event GROUP BY chain_id` |
| `lane_index` | `strategy_ref + symbol + side` 的运行槽位索引 | latest `observe.body` 投影；MVP 每 lane 同时最多 1 条 active flow |
| `active_flows` | 当前启用 lane 上未闭合的 flow | 由 strategy 配置 + lane 扫描结果决定；terminal `review` 写入后退出 active 集合 |
| `flow_meta(flow_id)` | flow 的 lane 定位 / bootstrapped_at | latest `observe.body` 的 `strategy_ref / symbol / side`；`bootstrapped_at` 来自 `flows` |
| `current_plan` | 当前 flow 的意图段 | 取最近一条 `observe.body` 的意图段字段（继承规则保证 fast_track observe 也能直接读） |
| `current_action_intent` | 当前 flow 本轮动作声明 | 取最近一条 `observe.body.action_intent`（含 `trigger_condition` + `request`） |
| `latest_observe` | 最新完整快照（含证据段） | 取最近一条 observe（`source` 可能为 fast_track） |
| `latest_slow_observe` | 最近一条战略层 observe | 取最近一条 `source = slow_track` 的 observe；快轨写 light observe 时从这里继承战略层字段 |
| `current_orders` | 当前活跃挂单 | reduce `order_fill` 事件到 open-orders 集合 |
| `current_position` | 当前净头寸 | reduce `order_fill` 事件到净头寸 |
| `last_preflight` | 最近一次 preflight 输出 | 取最近一条 `observe.body.preflight_result` |
| `intent_history` | 意图演化序列 | 按时间顺序读全部 `observe.body` 的意图段 |

### 12.6 常用读取路径

```sql
-- 读全部历史 flows（cron 入口上游还需按 strategy status / lane 状态过滤）
SELECT chain_id FROM plan_event
GROUP BY chain_id;

-- 读当前 plan / 最新证据（latest_observe，可能是 fast_track）
SELECT body_json FROM plan_event
WHERE chain_id=? AND kind='observe'
ORDER BY created_at DESC LIMIT 1;

-- 读 latest_slow_observe（快轨写 light observe 时从这里继承战略层字段）
SELECT body_json FROM plan_event
WHERE chain_id=? AND kind='observe'
  AND json_extract(body_json, '$.source') = 'slow_track'
ORDER BY created_at DESC LIMIT 1;

-- 读当前 action_intent（含 trigger_condition + request）
SELECT json_extract(body_json, '$.action_intent') FROM plan_event
WHERE chain_id=? AND kind='observe'
ORDER BY created_at DESC LIMIT 1;

-- 读最近 preflight
SELECT json_extract(body_json, '$.preflight_result') FROM plan_event
WHERE chain_id=? AND kind='observe'
ORDER BY created_at DESC LIMIT 1;

-- 读意图演化
SELECT body_json FROM plan_event
WHERE chain_id=? AND kind='observe'
ORDER BY created_at ASC;

-- 读订单 / 成交历史
SELECT body_json FROM plan_event
WHERE chain_id=? AND kind='order_fill'
ORDER BY created_at ASC;

-- flow_meta 投影 (strategy_ref / symbol / side)
SELECT
    chain_id,
    json_extract(body_json, '$.strategy_ref')  AS strategy_ref,
    json_extract(body_json, '$.symbol')        AS symbol,
    json_extract(body_json, '$.side')          AS side
FROM plan_event
WHERE kind='observe' AND chain_id=?
ORDER BY created_at DESC LIMIT 1;
```

`latest_observe` 可以安全直接读，前提是每条 `observe` 都是完整快照。

### 12.7 为什么这样落

- **一张表搞定**：`plan_event` 承载所有事件流。chain 是具体 flow 的语义概念，没有独立表；lane / state / symbol / strategy_ref 全是从 events 投影
- **关系列 + JSON body 混合**：关系列（`chain_id / kind / created_at`）让 SQL 高效索引和聚合；JSON body 让每种 kind 自带 shape，新增 kind 不需要 schema migration
- **不引入 MongoDB / 文档库**：单进程 cron + MVP 体量（< 10k events/月）下 SQLite JSON1 扩展完全够用，多一套服务的运维成本不值
- **strategy 不入 DB**：strategy 走 markdown 文件最自然（`strategies/*.md`），git history 即版本记录
- **flow semantics / hard guards 不入 DB**：前者直接写在主流程文档里，后者直接走代码或脚本
- **微结构不抽独立表**：单 flow 单 symbol 阶段直接内嵌 `observe.body.microstructure`；同 symbol 多 lane / flow 并行场景出现后再抽 `market_snapshot`
- **无 action_contract 票据**：本轮已收敛的可执行动作直接写在 `observe.body.action_intent`（含 `trigger_condition + request`），慢轨/快轨共用同一个 executor 读 `latest action_intent` 消费；单轮异常结束后的恢复优先走 Binance 事实补 `source=reconcile` 事件，不再额外设计独立执行票据
- **trigger_condition 统一两种意图语义**：`price_in_range` 窄区间 + 短窗口 = "立刻执行"（慢轨写完顺手按一下 executor）；`price_in_range` 目标区间 + 长窗口 = "等条件入场"（快轨在每次偏移点检查并执行）。慢轨/快轨没有专属的执行路径分支
- **快轨不写 reconcile 事件**：`source=reconcile` 只在慢轨入口的全量对账中产生；快轨发现本地与 Binance 不一致时一律 skip 该 flow（写 light observe 记录原因），等慢轨兜底，避免快轨频率下重复补 reconcile 造成事件流污染
- **flow 状态不存表**：是否活跃由 strategy 是否启用、lane 是否命中，以及该 flow 是否已写 terminal `review` 共同决定
- **数据库规格放本文件**，[design-architecture.md](design-architecture.md) 只保留设计图、状态流和模型边界
