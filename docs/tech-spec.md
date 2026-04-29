# Tech Spec

## 1. 范围

- 本文件只讨论 `Binance USDM` 执行层 + `trade.db` 持久化。
- 项目层固定：只做 USDM 永续 4H+ swing；外部 cron（Claude routines / Codex schedule）按 1H / 4H 触发。
- 当前重点是 `合约开仓`，但为避免后续接口命名漂移，仍把相关 skill 一并列清。
- 每次 cron 触发的链路：`OBSERVE → 对每条启用策略流决策 → EXECUTE → 某次阶段性闭合时即时 REVIEW`
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
  定义：最近一条 `observe` 事件里 `account.equity_usdt` 的值；爆仓护栏（`G-RISK-OPEN-CAP` / `G-RISK-DAY-FLOOR`）的实时计算基准，不落 `account_config`
- `current_plan`
  定义：当前策略流最近一条 `observe.body` 的"意图段"
  - 必填：symbol / side / stop_price / risk_budget_usdt / strategy_ref / thesis / entry_intent / exit_intent / invalidation / expected_rr_net
  - 可选：valid_until_at / stop_ladder / takeprofit_ladder / risk_budget_change
  - `stop_ladder`：止损推进梯度数组，`[{trigger_price, new_stop, reason}]`；agent 每轮读 ladder + 当前 mark + order_fill 历史自行决定是否发 `sync_protection`（软触发，preflight 不做机械 reduce）
  - `takeprofit_ladder`：分档止盈数组，`[{price, qty_ratio, reason}]`，`sum(qty_ratio) ≤ 1.0`；同样软触发
  - `risk_budget_change`：本轮 `risk_budget_usdt` 相对上一条 observe 的变化，`{delta_usdt, reason}`
- `execution_contract`
  定义：提交前由 `current_plan + latest_observe.account + 交易所规格` 编译出的执行快照；是交易所 payload 的唯一真相
- `observe snapshot`
  定义：可被 `EXECUTE / preflight` 直接消费的最小完整快照，不是 patch；同条 observe 同时承载意图段 + 证据段

## 3. `binance-account-snapshot`

### 3.1 定位

- 只读账户快照。
- 负责给 `PLAN` 与 `EXECUTE` 提供账户事实源。
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
- 还没有把 `保证金额 / 杠杆 / 笔数` 编译进来。

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
2. 从 `latest_observe.account` 取 live 账户事实：
   - equity
   - available balance
   - position
   - open regular orders
   - open algo orders
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

1. **幂等**：每次 EXECUTE 动作前先 reduce `order_fill` + 拉 Binance 实时挂单核对，重复请求不下重单。`clientOrderId` 用 `<chain_id>-<seq>-<action>` 前缀，Binance 侧自动去重，cron 重跑安全。
2. **abort 偏保守**：cron agent 任意阶段失败 → 只 append 已写入的 observe，不补做后续。下次 cron 重跑读最新事件流决定动作；不确定就 `no_action`。
3. **本地运维日志**：每次 cron 跑追加一行到 `./data/cron.log`，承载 `run_id / triggered_at / duration_ms / chains_processed / actions_taken / errors / next_cron_at`。文本日志，不入 DB；分析需求出现时再升 SQLite。
4. **异常通知**（通道由 `./data/notify_config.json` 配置；缺则只写本地日志）：
   - 爆仓护栏（`G-RISK-*`）拒新动作
   - cron / preflight / Binance API 持续失败（含 `G-RECON-NOT-STUCK` 触发的对账 stuck escalation）
   - 重大 PnL 事件（接近 `max_day_loss_pct` / 连续亏损达 `max_consecutive_losses`）

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
- 在线主线只写一个文件 `./data/trade.db`，里面只有一张事件表
- OHLCV / replay / backtest 的行情库后续单独走 `./data/ohlcv.db`

### 12.2 `trade.db` 表结构

只有一张事件表：

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

### 12.3 文件型存储

不进 DB 的：

| 内容 | 介质 | 位置 |
| --- | --- | --- |
| Strategy policy | Markdown 文件（一文件一 strategy，含 frontmatter） | `.agents/skills/trade-flow/strategies/*.md` |
| Account config | JSON | `./data/account_config.json` |
| Notify config | JSON | `./data/notify_config.json` |
| Cron 运维日志 | 文本日志 | `./data/cron.log` |
| OHLCV / 市场数据 | CSV + manifest（后期切 SQLite） | `./data/ohlcv/` |

Strategy 文件 frontmatter shape：

```yaml
---
strategy_id: S-GENERIC-TREND
name: 通用趋势跟随
status: active | draft | retired
tags: [directional, technical]
---

# S-GENERIC-TREND

policy markdown（setup / 失效 / EV / regime / catalyst / 持仓 / size policy）...
```

trade-flow 启动时遍历 `strategies/*.md`，按 frontmatter 索引到内存 map；不入 DB。

### 12.4 存储约束

- `plan_event` 是 append-only；不维护 current 表 / history 表双写
- `kind` 仅三种：`observe / order_fill / review`，trade-flow 写入时遇到未知 kind 立刻 warn（防 typo 静默落库）
- `body_json` 不做数据库层 schema 强约束（除 `json_valid`）；shape 由 `kind` 决定，应用层校验
- `observe.body_json` 必须是"最小完整快照"（含意图段 + `action_intent` + 证据段 + `preflight_result` + `decision_summary`），不是 patch
- `observe.body_json` 意图段的 `stop_ladder` / `takeprofit_ladder` / `risk_budget_change` 字段可选；写入时遵循：
  - `stop_ladder` 单调（long: trigger_price 与 new_stop 同向递增；short 反向）—— `G-STOP-LADDER-MONOTONIC`
  - `takeprofit_ladder.qty_ratio` 之和 ≤ 1.0 —— `G-TP-LADDER-RATIO-CAP`
  - ladder 是软触发：agent 每轮读 ladder + 当前 mark + order_fill 历史自行决定是否发 `sync_protection`；preflight 不做"已触发档位"的机械 reduce
  - `risk_budget_change` 在 `risk_budget_usdt` 与上一条 observe 不同时建议填，由 LLM 在自然语言层面判完整性
- `order_fill.body_json` shape 见 [design-architecture.md §order_fill.body shape](design-architecture.md)；`source: trade_flow | reconcile` 标识来源（主动 vs 对账推断）；可选 `source_observe_event_key` 引用本笔 fill 对应的决策 observe
- `review.body_json` 由某次仓位 / plan 阶段性闭合时写入；同一条策略流可累计多条 `review`，不通过 `review` 关闭整条流；shape 见 [design-architecture.md §REVIEW → review.body shape](design-architecture.md)
- `chain_id` 由 trade-flow 在某策略首次上线时生成 UUID，写进 first observe 的 `plan_event.chain_id`；后续该策略流沿用同一 `chain_id`
- 微结构 / 市场数据直接内嵌 `observe.body.microstructure`；不建独立 market_snapshot 表（单 flow 单 symbol 阶段不需去重；多 flow 同 symbol 并行出现时再抽）
- 投影视图不落库；`trade-flow / preflight / reducer` 读时计算
- flow semantics 直接写在主流程文档里，hard guards 直接走代码或脚本
- Strategy 池不作为表存在；strategy 走 markdown 文件，frontmatter 即元数据

### 12.5 投影视图

| 投影 | 语义 | 实现 |
| --- | --- | --- |
| `strategy_flows` | 全部策略流 | `SELECT chain_id, MIN(created_at) AS bootstrapped_at, MAX(created_at) AS last_event_at FROM plan_event GROUP BY chain_id` |
| `active_flows` | 当前启用策略的流 | 由 strategy 配置 / bootstrap 结果决定；不再通过 `review` 反推 closed |
| `flow_meta(flow_id)` | flow 的 symbol / strategy_ref / bootstrapped_at | latest `observe.body` 的 `symbol / strategy_ref`；`bootstrapped_at` 来自 `strategy_flows` |
| `current_plan` | 当前 flow 的意图段 | 取最近一条 `observe.body` 的意图段字段 |
| `current_action_intent` | 当前 flow 本轮动作声明 | 取最近一条 `observe.body.action_intent`（含 `request`） |
| `latest_observe` | 最新完整快照（含证据段） | 取最近一条 observe |
| `current_orders` | 当前活跃挂单 | reduce `order_fill` 事件到 open-orders 集合 |
| `current_position` | 当前净头寸 | reduce `order_fill` 事件到净头寸 |
| `last_preflight` | 最近一次 preflight 输出 | 取最近一条 `observe.body.preflight_result` |
| `intent_history` | 意图演化序列 | 按时间顺序读全部 `observe.body` 的意图段 |

### 12.6 常用读取路径

```sql
-- 读全部已 bootstrap 的 flows（cron 入口上游还需按 strategy status 过滤）
SELECT chain_id FROM plan_event
GROUP BY chain_id;

-- 读当前 plan / 最新证据
SELECT body_json FROM plan_event
WHERE chain_id=? AND kind='observe'
ORDER BY created_at DESC LIMIT 1;

-- 读当前 action_intent（含本轮 request）
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

-- chain_meta 投影 (symbol / strategy_ref)
SELECT
    chain_id,
    json_extract(body_json, '$.symbol')        AS symbol,
    json_extract(body_json, '$.strategy_ref')  AS strategy_ref
FROM plan_event
WHERE kind='observe' AND chain_id=?
ORDER BY created_at DESC LIMIT 1;
```

`latest_observe` 可以安全直接读，前提是每条 `observe` 都是完整快照。

### 12.7 为什么这样落

- **一张表搞定**：`plan_event` 承载所有事件流。chain 是 GROUP BY 的语义概念，没有独立表；state / symbol / strategy_ref 全是从 events 投影
- **关系列 + JSON body 混合**：关系列（`chain_id / kind / created_at`）让 SQL 高效索引和聚合；JSON body 让每种 kind 自带 shape，新增 kind 不需要 schema migration
- **不引入 MongoDB / 文档库**：单进程 cron + MVP 体量（< 10k events/月）下 SQLite JSON1 扩展完全够用，多一套服务的运维成本不值
- **strategy 不入 DB**：strategy 走 markdown 文件最自然（`strategies/*.md`），git history 即版本记录
- **flow semantics / hard guards 不入 DB**：前者直接写在主流程文档里，后者直接走代码或脚本
- **微结构不抽独立表**：单 flow 单 symbol 阶段直接内嵌 `observe.body.microstructure`；同 symbol 多 flow 并行场景出现后再抽 `market_snapshot`
- **无 action_contract 票据**：本轮已收敛的可执行动作直接写在 `observe.body.action_intent.request`，EXECUTE 读 `latest_observe` 消费；同进程顺序调用不需要跨进程票据机制（PLAN/EXECUTE 真的拆跨进程时再加）
- **flow 状态不存表**：是否活跃由 strategy 是否启用、flow 是否已 bootstrap 决定；`review` 只记样本，不作为 closed 标记
- **数据库规格放本文件**，[design-architecture.md](design-architecture.md) 只保留设计图、状态流和模型边界
