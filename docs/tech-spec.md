# Tech Spec

## 1. 范围

- 本文件只讨论 `Binance USDM` 执行层。
- 当前重点是 `合约开仓`，但为避免后续接口命名漂移，仍把相关 skill 一并列清。
- 主流程不变：`OBSERVE -> PLAN -> EXECUTE`
- 即使用户已经明确给出 `标的 / 方向 / 笔数 / 杠杆 / 保证金额`，也仍先落 `PLAN`，再执行。

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

- 没有消费正式 plan 结构。重构方向见 [design-architecture.md](design-architecture.md) 的 `Plan 设计`：执行层应消费当前 `intent` 事件（含 market / entry / stop / risk_budget_usdt / tranches）+ 最近 observe 事件（含微结构 / 账户事实），产出写成 `order` 事件；不再直接吃零散参数。
- 没有统一输出“这版 plan 需要几张主单、几张保护单”。
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
  - spot 走 `orderTest`
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
EntryPlan
- market: `usdm`
- symbol
- position_side: `BOTH | LONG | SHORT`
- target_leverage?: number
- margin_mode?: `isolated | crossed`
- entries[]
  - role: `entry | add`
  - type: `LIMIT | MARKET | STOP | STOP_MARKET | TAKE_PROFIT | TAKE_PROFIT_MARKET`
  - price?
  - stop_price?
  - quantity
- verify_policy
```

### 9.3 最小执行步骤

1. 读取当前生效 plan
2. 拉账户事实：
   - position
   - open regular orders
   - open algo orders
3. 校验：
   - `symbol`
   - `positionSide`
   - 当前仓位不会被误减
4. 若指定 `target_leverage`
   - 读取当前杠杆
   - 不一致则先调杠杆
5. 将 `entries[]` 逐张编译为主单 request
6. 调用 `binance-order-place`
7. 回读 `openOrders.regular`
8. 输出：
   - 想提交什么
   - 实际提交了什么
   - 哪些已进入交易所
   - 哪些仍未对齐

### 9.4 当前最关键缺口

- 没有正式 `EntryPlan`
- 没有 `保证金额 / 杠杆 / 笔数 -> quantity[]` 编译器
- 没有多张主单统一 orchestration
- 没有标准化核验返回

## 10. 当前开发顺序

### 10.1 第一批

1. 固定 `EntryPlan`
2. 实现 `保证金额 / 杠杆 / 笔数 -> quantity[]`
3. 实现多张 entry 编译器
4. 实现主单后的独立核验协议

### 10.2 第二批

1. 引入 `binance-order-cancel` 到统一编排
2. 给开仓函数补 `marginMode`
3. 固定 `clientOrderId` 命名约定

### 10.3 第三批

1. 接入 `binance-position-protect`
2. 接入 `binance-position-adjust`
3. 收敛为统一执行层协议

## 11. 当前结论

- 当前仓库不是“不能做 USDM 开仓”，而是“主单落地拼图已有，但 plan compiler 还缺”
- 现在最该稳定下来的不是更多零散接口，而是：
  - `EntryPlan`
  - `quantity[]` 编译
  - 多张主单 orchestration
  - 提交后核验协议
