# Skill Layout

整个 trade 系统按两层 skill 切分：

- **套件 skill**（agent 编排层）：`trade-flow`，内部按主线阶段（stages）组织
- **功能 skill**（原子动作层）：`binance-*` / `ohlcv-fetch` / `tech-indicators` 等，平铺单一职责

两层不替代——套件管"怎么思考"，功能管"怎么动手"。套件内 stages 调用功能 skill。

---

## 套件 skill：`trade-flow`

### 目录结构

```
.agents/skills/trade-flow/
├─ SKILL.md                        ← 套件入口：router 逻辑 + 各 stage 简介 + 数据库位置
├─ stages/                         ← 主线阶段
│  ├─ observe/
│  │  ├─ STAGE.md                  ← 流程定义（按需 Read）
│  │  └─ scripts/                  ← 阶段独有脚本
│  ├─ plan/
│  │  ├─ STAGE.md
│  │  └─ scripts/
│  │     ├─ plan-write.ts          ← 写 observe（含意图段）+ 调 plan-preflight
│  │     └─ plan-read.ts
│  ├─ execute/
│  │  └─ STAGE.md                  ← MVP 仅文档，调用现有 binance-* 功能 skill
│  ├─ review/
│  │  └─ STAGE.md                  ← MVP 占位
├─ scripts/
│  └─ db/                          ← 套件共享：数据库操作
│     ├─ schema.sql                ← 见 tech-spec.md §12（plan_event 单表 + JSON body）
│     ├─ migrate.ts
│     ├─ event-repo.ts             ← plan_event append + 投影 reducer
│     └─ projection.ts             ← flows / lane_index / active_flows / flow_meta / current_plan / latest_observe / current_orders / current_position / ...
└─ references/
   └─ plan-schema.md               ← 软链或引用 design-architecture.md Plan 章节
```

### SKILL.md 必须保持轻量

`< 300 行`。只放：

- Router 规则（详见 [design-architecture.md](design-architecture.md) §ROUTER）：仅 user-message 入口走 ROUTER；cron 主轨默认进 observe
- 各 stage 一句话简介
- 数据库位置 + 关键表名
- 共享约定（如 client_order_prefix 命名规则）

详细流程藏在 `stages/X/STAGE.md`，agent 路由后再 Read。这样单次对话只加载用得到的部分，避免套件膨胀负担。

### 阶段衔接：通过事件流解耦

阶段之间不直接互调，全部通过 append `plan_event` + 读投影视图触发。每次 cron 周期一次性跑通：

```
observe 拉账户快照 + 对账补 event + 拉市场数据
   ↓
对每条 active flow：
  agent LLM 读 current_plan + latest_observe + strategy.policy + flow semantics 判动作
   ↓
preflight（hard guards + card validation）
   ↓
append observe（含意图段 + action_intent + 证据段 + preflight_result + decision_summary）
   ↓ (verdict=armable && target_action != no_action)
execute 读取 latest_observe.action_intent.request → append order_fill
   ↓ (某次阶段性闭合时)
review  append review event（记录闭合样本并封口当前 flow）
   ↓
cron.log 追加本轮元数据
```

好处：cron 任意阶段失败就 abort，下次 cron 重跑读最新事件流接续。投影视图即时计算，不维护 stale 标记。

### Stage 简介

| Stage | 干什么 | 调用的功能 skill |
| --- | --- | --- |
| **observe** | 按运行形态（`single-symbol` / `monitor-existing-chain`）整理 checklist：cron 主轨必跑对账（先补 `source=reconcile`；不能可靠归属则 abort 当前周期）+ 拉市场数据 + 补 setup 证据。PLAN/preflight 后 append 完整 observe（含意图段 + action_intent + 证据段 + preflight_result + decision_summary） | `binance-account-snapshot`, `binance-symbol-snapshot`, `ohlcv-fetch`, `tech-indicators`, `binance-market-scan` |
| **plan** | 对每条 active flow：LLM 读 current_plan + latest_observe + strategy.policy + flow semantics 决定本轮 `direction_state` / `execution_verdict` + `action_intent`；调 `plan-preflight` 跑 hard guards 与卡片校验（含 `G-PLAN-VERDICT-COMPLETE`） | `plan-preflight`, `binance-account-snapshot`（兜底）+ 读 `strategies/*.md` |
| **execute** | 读取 latest observe 的 `action_intent.request` → preview → 下单 / 撤单 / 调仓 → append order_fill 事件 | `binance-order-preview`, `binance-order-place`, `binance-position-protect`, `binance-position-adjust` |
| **review** | 某次仓位 / plan 阶段性闭合后写 review 事件（5 个必填字段 + notes 自由 markdown） | — |

注：cron 模式下"分阶段"是逻辑划分，每次 cron 周期一次性跑完 observe → plan → execute → (review)。不是用户主动一次次切阶段。

---

## 功能 skill：保持平铺

交易动作 skill 保持平铺，不迁入套件，不提前做 tools 层：

- `binance-account-snapshot`
- `binance-order-place`
- `binance-order-preview`
- `binance-position-protect`
- `binance-position-adjust`

市场数据 / 分析 skill 也保持平铺：

- `ohlcv-fetch`：纯数据获取
- `tech-indicators`：纯计算
- `binance-symbol-snapshot`：标的快照查询
- `binance-market-scan`：扫描器，独立有价值

所有 skill 的实盘动作仍必须经 `trade-flow → preflight → preview / execute`，不能裸下单。

---

## 文件数据库

**位置**：`./data/trade.db`（项目根目录，gitignore）

**类型**：SQLite

**schema 来源**：[tech-spec.md](tech-spec.md) §12（1 张事件表 `plan_event`，含 JSON body；strategies / configs / OHLCV 走文件）

**操作入口**：`trade-flow/scripts/db/` 下的 repo 模块

当前不设计数据库迁移；SQLite 单库自用。

---

## MVP 边界

第一阶段只做：

- ✅ trade-flow 套件骨架（`SKILL.md` + `stages/observe/STAGE.md` + `stages/plan/STAGE.md` + `stages/execute/STAGE.md`）
- ✅ `scripts/db/` 下 plan_event 单表 schema + event-repo + projection
- ✅ `plan-preflight` skill：flow semantics + hard guard 脚本 + 6 行 DECISION_CARD 渲染
- ✅ 现有功能 skill 全部保持现状，**不动不迁**
- ✅ cron 运维必备：clientOrderId 前缀幂等 + abort 偏保守 + cron.log + 异常通知
- ✅ replay / shadow gate：未通过 setup 资格证的 strategy 只能观察或 shadow，不得 live execute
- ✅ execution contract：真钱动作必须经 preview 生成 `execution_contract_snapshot`，再 append `order_fill`

先不做：

- ❌ stages/review/STAGE.md 详细流程（MVP 阶段某次阶段性闭合即写 review，shape 见 design-architecture）
- ❌ 策略演化自动链路（MVP 只保留 setup 级 replay / shadow gate）
- ❌ 功能 skill 迁入套件 tools/
- ❌ `strategies/` 目录二层结构（namespace + 微策略）
- ❌ hard guard registry 单独抽象（guard 数明显增多后再考虑）
- ❌ hedge 多腿

---
