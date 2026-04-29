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
│  ├─ backtest/                    ← 离线，MVP 不展开
│  └─ iterate/                     ← 离线，MVP 不展开
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

- Router 规则（用户消息 → 哪个 stage）
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
   ↓ (verdict=armable)
execute 提交动作 → append order_fill
   ↓
本轮收尾 append observe（含意图段 + 证据段 + preflight_result + decision_summary）
   ↓ (某次阶段性闭合时)
review  append review event（记录闭合样本并封口当前 flow）
   ↓
cron.log 追加本轮元数据
```

好处：cron 任意阶段失败就 abort，下次 cron 重跑读最新事件流接续。投影视图即时计算，不维护 stale 标记。

### Stage 简介

| Stage | 干什么 | 调用的功能 skill |
| --- | --- | --- |
| **observe** | 拉账户快照 + 对账（先补 `source=reconcile` 事件，再留下 residual `reconcile_diffs`）+ 拉市场数据 + 识别 regime / 算跨链 exposure。本轮收尾时 append 完整 observe（含意图段 + 证据段 + preflight_result + decision_summary） | `binance-account-snapshot`, `binance-symbol-snapshot`, `ohlcv-fetch`, `tech-indicators`, `binance-market-scan` |
| **plan** | 对每条 active flow：LLM 读 current_plan + latest_observe + strategy.policy + flow semantics 决定本轮动作；调 `plan-preflight` 跑 hard guards 与卡片校验 | `plan-preflight`, `binance-account-snapshot`（兜底）+ 读 `strategies/*.md` |
| **execute** | 预检 → 下单 → 回填，append order_fill 事件 | `binance-order-preview`, `binance-order-place`, `binance-position-protect`, `binance-position-adjust` |
| **review** | 某次仓位 / plan 阶段性闭合后写 review 事件（5 个必填字段 + notes 自由 markdown） | — |
| **backtest** | 跑历史样本验证假设（远期，30+ review 样本后） | `ohlcv-fetch` |
| **iterate** | REVIEW 产出沉淀进 `strategies/`（远期） | — |

注：cron 模式下"分阶段"是逻辑划分，每次 cron 周期一次性跑完 observe → plan → execute → (review)。不是用户主动一次次切阶段。

---

## 功能 skill：保持平铺

按"通用程度"分两类：

### A 类：trade-flow 专属（远期可考虑迁入套件 tools/）

这些只服务交易动作，没有第二个使用场景：

- `binance-account-snapshot`
- `binance-order-place`
- `binance-order-preview`
- `binance-position-protect`
- `binance-position-adjust`

**远期迁移路径**：`trade-flow/tools/binance/{name}/`。MVP 不动，等套件骨架跑通 + 完成 Claude Code skill 嵌套的技术验证后再迁。

### B 类：通用市场数据 / 分析工具（永久平铺）

这些跨场景复用——研究、回测、可视化、监控、独立分析都可能用：

- `ohlcv-fetch`：纯数据获取
- `tech-indicators`：纯计算
- `binance-symbol-snapshot`：标的快照查询
- `binance-market-scan`：扫描器，独立有价值

绑死在套件内会失去复用价值。永久保持平铺。

---

## 文件数据库

**位置**：`./data/trade.db`（项目根目录，gitignore）

**类型**：SQLite

**schema 来源**：[tech-spec.md](tech-spec.md) §12（1 张事件表 `plan_event`，含 JSON body；strategies / configs / OHLCV 走文件）

**操作入口**：`trade-flow/scripts/db/` 下的 repo 模块

**未来演进**：需要并发 / 服务器侧统一存储 / 看板 / 多终端共用 → 迁 PostgreSQL。OHLCV 进入 backtest 阶段切独立 SQLite 文件（`./data/ohlcv.db`），不与 trade.db 混用。

---

## MVP 边界

第一阶段只做：

- ✅ trade-flow 套件骨架（`SKILL.md` + `stages/observe/STAGE.md` + `stages/plan/STAGE.md` + `stages/execute/STAGE.md`）
- ✅ `scripts/db/` 下 plan_event 单表 schema + event-repo + projection
- ✅ `plan-preflight` skill：flow semantics + hard guard 脚本 + 6 行 DECISION_CARD 渲染
- ✅ 现有功能 skill 全部保持现状，**不动不迁**
- ✅ cron 运维必备：clientOrderId 前缀幂等 + abort 偏保守 + cron.log + 异常通知

先不做：

- ❌ stages/review/STAGE.md 详细流程（积累 5-10 个 review 样本后再细化；MVP 阶段某次阶段性闭合即写 review，shape 见 design-architecture）
- ❌ stages/backtest / iterate（30+ review 样本后再展开）
- ❌ A 类功能 skill 迁入套件 tools/（套件骨架稳定后再做）
- ❌ `strategies/` 目录二层结构（namespace + 微策略，30+ review 样本后再展开）
- ❌ hard guard registry 单独抽象（guard 数明显增多后再考虑）
- ❌ hedge 多腿（推迟到真有对冲需求；届时增设 plan_relation 表 + S-HEDGE-GENERIC + 升级 G-RISK-OPEN-CAP 公式）

---

## Claude Code skill 嵌套验证

A 类功能 skill 迁入 `trade-flow/tools/binance/` 之前，需要做一个 5 分钟技术验证：在 trade-flow 套件下放一个测试 SKILL.md，看 Claude Code 是否扫描识别。两种可能：

| 情况 | 后果 |
| --- | --- |
| **递归扫描所有 SKILL.md** | tools/ 下每个仍是 agent-visible 独立 skill，命名空间需谨慎 |
| **只扫描顶层** | tools/ 下就是套件内部代码模块，必须通过套件脚本 import 调用——其实更好（强制走 trade-flow 流程，不能裸下单） |

验证结果决定 A 类的最终归属形式。MVP 阶段不需要这个结论。
