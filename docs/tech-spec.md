# Tech Spec

## 1. 范围

- 本文件只固定 `Binance USDM` 执行层和 `trade.db` 持久化。
- 不再充当 skill 手册；各 skill 的参数、脚本细节、输出样例回收到 `.agents/skills/*/SKILL.md`。
- 当前产品只做 4H+ swing，不做高频、不做多交易所、不做组合研究平台。
- live 动作唯一入口：`OBSERVE -> PLAN/preflight -> EXECUTE/preview -> order_fill -> REVIEW`。
- 未通过 setup 资格证的策略只能 `dry-run / shadow`，不能发真钱新增风险动作。

## 2. 不可破坏的实盘约束

1. 任何执行前必须先写一条完整 `observe`。
2. EXECUTE 只消费 `latest_observe.action_intent.request`，不能吃聊天里的零散参数。
3. `target_action != no_action` 且新增风险时，必须有 `setup_id`、stop、invalidation、risk_budget。
4. `strategy.status` 必须允许 live，且 setup 的 `live_permission` 必须允许 live-small。
5. 提交前必须生成 `execution_contract`；交易所 payload 只能从它编译。
6. 主动执行写 `order_fill(source=trade_flow)` 时，必须保存 `source_observe_event_key + execution_contract_snapshot`。
7. cron 重跑必须幂等；`clientOrderId` 使用 `<chain_id>-<seq>-<action>` 前缀。
8. 任一关键事实不确定，默认 `no_action`；只允许降低风险的动作绕过新增风险闸。

## 3. 共享术语

- `主单`：建立或增加仓位的 entry / add 单。
- `保护单`：止损、止盈、trailing 等减少风险的保护腿。
- `order type`：订单形状，不单独决定主单或保护单。
- `setup`：strategy 内可验证的一类机会，必须有 hypothesis / regime / entry_rule / stop_rule / no_trade_conditions / size_policy / evidence_ref / live_permission。
- `current_plan`：当前 flow 最近一条 `observe.body` 的意图段。
- `latest_observe`：当前 flow 最新完整快照，含账户投影、市场证据、preflight、action_intent。
- `execution_contract`：提交前从 `latest_observe + setup + 账户事实 + 交易所规格` 编译出的唯一执行快照。

## 4. 最小执行契约

```yaml
execution_contract:
  source_observe_event_key: uuid
  chain_id: uuid
  setup_id: string
  market: usdm
  symbol: string
  side: long | short
  position_side: BOTH | LONG | SHORT
  margin_mode: isolated | crossed
  target_leverage: number
  account_snapshot:
    equity_usdt: number
    available_balance_usdt: number
    snapshot_at: iso8601
  risk:
    risk_budget_usdt: number
    stop_price: number
    invalidation: string
    expected_rr_net: number
  entries:
    - role: entry | add
      type: MARKET | LIMIT | STOP | STOP_MARKET | TAKE_PROFIT | TAKE_PROFIT_MARKET
      price: number?
      stop_price: number?
      quantity: number
      client_order_id: string
  protection_plan:
    stop:
      type: STOP_MARKET | STOP
      stop_price: number
      quantity: number | close_position
    take_profit:
      - type: TAKE_PROFIT_MARKET | TAKE_PROFIT
        trigger_price: number
        quantity: number
  verify_policy:
    read_after_submit: true
    abort_on_mismatch: true
```

编译器必须显式处理：

- `保证金额 / 杠杆 / 笔数 -> quantity[]`
- symbol precision / min notional / step size
- fee + slippage 后的净 R:R
- hedge mode 与 one-way mode 的 `positionSide`
- 已有仓位、已有挂单、已有保护腿

## 5. Binance 路由事实

实现前必须重新核对 Binance 当前 USDM 文档；交易所接口不是长期静态事实。

截至 2026-06：

- 普通主单：`MARKET / LIMIT` 走 `/fapi/v1/order`。
- 条件单：`STOP / STOP_MARKET / TAKE_PROFIT / TAKE_PROFIT_MARKET / TRAILING_STOP_MARKET` 已迁移到 Algo Service，走 `/fapi/v1/algoOrder`。
- 因此“主单 vs 保护单”不能靠 endpoint 判断；必须靠 `execution_contract.entries[] / protection_plan` 的角色判断。
- `binance-order-preview` 的第一职责是暴露方法路由和风险警告，不是替代 preflight。

## 6. 最小执行步骤

1. 读取当前 flow 的 `latest_observe`。
2. 校验 `action_intent.request` 与 `current_plan` 一致。
3. 读取必要账户事实；若 observe 投影不足，临时重拉 `binance-account-snapshot`。
4. 编译 `execution_contract`。
5. 运行 hard guards：setup live permission、risk cap、day floor、stop、RR、kill switch、runtime health。
6. `preview` 输出交易所方法、payload、warnings。
7. 用户或 cron 条件允许后提交。
8. 提交后回读账户、仓位、普通挂单、algo 挂单。
9. 若状态不一致，停止新增风险并写恢复所需事实。
10. 写 `order_fill(source=trade_flow)`。

## 7. skill 边界

| skill | 只负责 | 不负责 |
| --- | --- | --- |
| `binance-account-snapshot` | 账户、仓位、挂单、历史订单事实 | 决策、下单 |
| `binance-order-preview` | 方法路由、payload 预演、warnings | 绕过 preflight、真实下单 |
| `binance-order-place` | 主单提交 | 保护腿、减仓、整版 plan 编译 |
| `binance-position-protect` | 保护腿提交 / 重建 | 开仓、减仓 |
| `binance-position-adjust` | 已有仓位减仓 / 全平 | 开仓、保护重建 |
| `binance-order-cancel` | 撤普通单 / algo 单 | 判断交易观点 |

任何 skill 都不能自行决定“这笔交易值得做”。价值判断只能来自 `observe -> preflight -> execution_contract`。

## 8. 当前必须补齐的实现缺口

1. `execution_contract` 正式 schema 与校验器。
2. `保证金额 / 杠杆 / 笔数 -> quantity[]` 编译器。
3. 条件单的 Algo endpoint 路由更新。
4. 提交后回读核验协议。
5. `order_fill` 写入 `source_observe_event_key + execution_contract_snapshot`。
6. cron 幂等恢复：重复运行不重下单，状态不明只写事实不补风险。

这 6 项没补齐前，产品可以做 shadow / live-small 手工确认，不应自动实盘。

## 9. `trade.db`

在线主线只写 `./data/trade.db`，只保留一张 append-only 事件表。

```sql
CREATE TABLE plan_event (
    event_key   TEXT PRIMARY KEY,
    chain_id    TEXT NOT NULL,
    kind        TEXT NOT NULL,
    body_json   TEXT NOT NULL CHECK(json_valid(body_json)),
    created_at  TEXT NOT NULL
);

CREATE INDEX idx_chain_time ON plan_event(chain_id, created_at);
CREATE INDEX idx_kind_chain ON plan_event(kind, chain_id);
CREATE INDEX idx_obs_symbol ON plan_event(
    json_extract(body_json, '$.symbol')
) WHERE kind = 'observe';
```

允许的 `kind`：

| kind | 语义 |
| --- | --- |
| `observe` | 最小完整快照，含意图、证据、preflight、action_intent |
| `order_fill` | 主动执行或对账补录的订单 / 成交事实 |
| `review` | flow 阶段性或终局复盘 |

约束：

- 不维护 current 表、history 表双写。
- 不建独立 strategy 表；strategy 走 markdown + frontmatter。
- 不把原始 OHLCV / aggTrades 塞进 `trade.db`。
- 投影视图读时计算；并发、多账户、多市场压力真实出现后再扩表。

## 10. 文件型存储

| 内容 | 位置 |
| --- | --- |
| Strategy policy | `.agents/skills/trade-flow/strategies/*.md` |
| Account config | `./data/account_config.json` |
| Notify config | `./data/notify_config.json` |
| Cron log | `./data/cron.log` |
| OHLCV / aggTrades / indicator outputs | `./data/ohlcv/` 或各 skill 输出目录 |

## 11. 常用读取路径

```sql
-- 最新 observe
SELECT body_json FROM plan_event
WHERE chain_id=? AND kind='observe'
ORDER BY created_at DESC LIMIT 1;

-- 当前 action_intent
SELECT json_extract(body_json, '$.action_intent') FROM plan_event
WHERE chain_id=? AND kind='observe'
ORDER BY created_at DESC LIMIT 1;

-- 订单 / 成交历史
SELECT body_json FROM plan_event
WHERE chain_id=? AND kind='order_fill'
ORDER BY created_at ASC;

-- flow lane
SELECT
    chain_id,
    json_extract(body_json, '$.strategy_ref') AS strategy_ref,
    json_extract(body_json, '$.symbol') AS symbol,
    json_extract(body_json, '$.side') AS side
FROM plan_event
WHERE kind='observe' AND chain_id=?
ORDER BY created_at DESC LIMIT 1;
```

## 12. 结论

最瘦完整系统不是更多 skill，而是四个稳定件：

1. `latest_observe`
2. `execution_contract`
3. hard guards
4. post-submit reconciliation

这四个件闭合，系统才有资格从 shadow 进入 live-small。
