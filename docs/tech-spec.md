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

## 8. 当前实现状态

已补齐：

- `execution_contract` schema / 校验器：`.agents/skills/binance-order-preview/scripts/execution-contract.ts`
- `保证金额 / 杠杆 / 价格 / stepSize -> quantity` 编译器：同上
- `execution_contract` CLI：`.agents/skills/binance-order-preview/scripts/contract.ts`
- 条件 entry 的 Algo endpoint 路由：`binance-order-preview` / `binance-order-place`
- 主单提交后普通单 / algo 单回读核验：`binance-order-place`
- preflight hard guards 与 DECISION_CARD：`.agents/skills/plan-preflight/scripts/main.ts`
- open-only 边界：`binance-order-place` 直接执行入口也拒绝 reduce-only / 减仓 / 翻仓
- `plan_event` schema 初始化、`order_fill` 审计落库、`preflight -> contract -> execution_result -> order_fill` record glue：`.agents/skills/trade-flow/scripts/main.ts`
- `--run --mode dry-run` 端到端链路：`preflight -> contract -> mock execution -> order_fill -> reducer readback`
- `--run --mode shadow` 影子执行链路：同 dry-run，但记录 `execution_result.mode=shadow`
- `--load-runtime`：加载 account config 与 strategy markdown frontmatter
- `--build-observe`：从 account / market skill 输出构建最小完整 observe event
- `runJsonCommand`：统一调用其他 skill CLI，并强制 JSON 输出 / 失败显式化
- `--observe-from-skills`：调用只读 account / symbol snapshot skill 后构建 observe event
- `--run-shadow-from-skills`：真实只读观察 + shadow 执行记录，不触发 Binance 写接口
- `--run-live-small --yes`：真实调用 `binance-order-place` 主单执行，并落 audited `order_fill`
- `--recover-flow --chain-id <id>`：从本地 `plan_event` reduce 出 `latest_observe / latest_order_fill / current_orders / current_position / open_action_gap`
- `--reconcile-flow --chain-id <id>`：用传入账户快照生成 `order_fill(source=reconcile)` 草案；无法可靠归属则进入 `unmatched`
- `--reconcile-from-skills --chain-id <id>`：调用只读 `binance-account-snapshot --include-history` 后生成同样的补录草案
- `--apply-reconcile --yes`：仅当 `can_reconcile=true` 时，把 `order_fill(source=reconcile)` 草案 append 到本地 DB；不调用 Binance
- `--cron-recover-from-skills --chain-id <id>`：cron 入口恢复编排；本地 reduce + 只读对账，有 `unmatched` 则 abort，无缺口则返回草案或显式 apply
- 第一条策略资产：`.agents/skills/trade-flow/strategies/s-btc-4h-trend-pullback.md`，当前 `status=draft`
- replay framework：`.agents/skills/trade-flow/scripts/lib/replay-core.ts` 提供通用 OHLCV manifest loader、indicator cache、单 lane 不重叠撮合、R 统计、fee/slippage、replay gate
- replay registry：`.agents/skills/trade-flow/scripts/lib/replay-strategies.ts` 负责 `strategy_id -> ReplayStrategy` 分发；当前注册 `S-BTC-4H-TREND-PULLBACK`
- `--replay-strategy --manifest <path> --strategy-id <id>`：通过 registry 做机械 OHLCV replay，不写 DB、不触发 Binance
- strategy iteration：`.agents/skills/trade-flow/scripts/lib/strategy-iteration.ts` 提供 evidence ledger、policy hash、review report、promotion gate 与 status 更新
- `--append-strategy-evidence --strategy <path> --ledger <path>`：追加 replay / shadow / live-small / review_batch 证据；每条证据绑定当前 strategy `policy_hash`
- `--strategy-review --strategy <path> --ledger <path> [--db <path>]`：汇总 fresh / stale evidence、DB review stats 和 promotion gate；若 DB 不存在，不会创建 DB
- `--strategy-promote --strategy <path> --ledger <path> --to <status> [--yes]`：默认 dry-run；只有满足 gate 且显式 `--yes` 才更新 strategy frontmatter status
- artifact hygiene：`.agents/skills/trade-flow/scripts/lib/artifact-hygiene.ts` 提供显式目录扫描、pin/ref 保护、过期候选报告和 `--yes` 删除
- `--artifact-gc --artifact-root <path> --retention-hours <n>`：默认 dry-run，不打开 DB，不触发 Binance；只处理显式 artifact root 下的过期未引用文件

仍需接入主流程：

- `S-BTC-4H-TREND-PULLBACK` 的过滤规则改进与 shadow 样本；1000 根 4H replay 在成本与不重叠口径下不达标，不能改为 `live-small`
- Binance 小额 live-small 实测，确认条件单 / 回读 / 保护腿在真实账户模式下表现一致

这意味着系统已具备进入 `shadow` 的技术地基；`live-small with manual confirmation` 还需要策略完成 replay / shadow 资格，并做一次 Binance 小额实测。

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
| Strategy evidence ledger | `./data/strategy-evidence.jsonl` |

文件型 artifact 规则：

- `trade.db` 是唯一长期事实源；artifact 只是证据材料或缓存
- 被 strategy evidence / review / active observe 引用的 artifact 保留
- 需要永久保留的文件加同名 `.pin`
- 未引用、未 pin、超过 retention 的 artifact 由 `--artifact-gc` 清理
- `.db / .sqlite / .sqlite3` 永不由 artifact GC 删除
- 清理默认只报告候选；删除必须显式 `--yes`

Strategy evidence ledger 规则：

- JSONL，一行一条 evidence；不进 `trade.db`
- `kind` 当前允许 `replay / shadow / live_small / review_batch`
- 必填 `strategy_id / setup_id / policy_hash / stats / source_ref`
- `policy_hash` 由 strategy frontmatter 中的 `strategy_id/name/tags` 加正文计算；`status` 改动不影响 hash
- strategy 正文、名称或 tags 改动后，旧 evidence 变 stale，不能用于 promote
- `draft -> shadow`：需要 fresh replay 且 `avg_r > 0 / total_r > 0 / profit_factor >= 1.05 / max_drawdown_r <= 10`
- `shadow -> live-small`：需要 fresh replay + fresh shadow，shadow `sample_count >= 20` 且表现为正
- `paused / draft` 可随时降级；升格必须走 gate

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
