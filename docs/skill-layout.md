# Skill Layout

整个 trade 系统按两层 skill 切分：

- **套件 skill**（agent 编排层）：`trade-flow`，内部按主线阶段（stages）组织
- **功能 skill**（原子动作层）：`binance-*` / `ohlcv-fetch` / `tech-indicators` 等，平铺单一职责

两层不替代——套件管"怎么思考"，功能管"怎么动手"。套件内 stages 调用功能 skill。

当前整理基线见 [architecture-inventory.md](architecture-inventory.md)；深层整理施工图见 [architecture-cleanup-plan.md](architecture-cleanup-plan.md)。

---

## 动作权限分级

每个 skill / command 必须归入一个或多个权限 class：

| Class | 名称 | 允许 | 禁止 |
| --- | --- | --- | --- |
| `R` | read facts | 读本地或外部事实 | 写 `trade.db` / Binance 写接口 |
| `A` | analyze | 计算指标、replay、calibration、候选筛选；可写 artifact | 写交易事实、触发 Binance |
| `E` | evidence write | 写 strategy evidence / R&D ledger | 写 `plan_event` 或 Binance |
| `V` | event write | 写本地事件、shadow、reconcile draft apply | 触发 Binance |
| `T` | trade write | Binance 下单、撤单、保护、减仓 | 绕过 preflight / execution contract |
| `C` | credentials/config | 读写敏感配置 | 进入普通 artifact / notes / cron 输出 |

硬规则：

- `T` 类动作只能由 executor 路径触发：`action_intent -> preflight -> execution_contract_snapshot -> execute skill -> order_fill`。
- `R/A/E/V` 失败不得自动升级为 `T` 补救。
- market scan / replay / R&D candidate 不能直接生成 live action，只能进入候选或 evidence。
- `C` 类内容不得进入 `plan_event.body_json`、artifact、LLM notes 或通知正文。

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

- skill / command 的权限 class
- Router 规则（用户消息 / cron 触发 → 哪个 stage；触发源含 `track=slow|fast` 标识）
- 各 stage 一句话简介
- 数据库位置 + 关键表名
- 共享约定（如 client_order_prefix 命名规则、双轨写权限边界一句话）

详细流程藏在 `stages/X/STAGE.md`，agent 路由后再 Read。这样单次对话只加载用得到的部分，避免套件膨胀负担。

### 双轨调度入口

`trade-flow` 接受两种触发模式（由调度方传 `--track slow|fast`）：

| Track | 走的 stage 链 | LLM prompt 范围 |
|---|---|---|
| `slow` | observe（全量对账 + 拉市场数据）→ plan（完整 LLM 分析）→ execute → review？ | 完整：plan + market + strategy.policy + flow semantics |
| `fast` | observe-light（per-flow 轻量对账）→ executor-only（trigger 检查 → 确定性 gate → 快轨 preflight 子集 → 下单） | orchestrator only：按 prompt 模板顺序调 tool，不做质性判断 |

快轨不走 plan stage——它不重写 thesis、不发起加仓方向的新意图（除非是慢轨预设 trigger_condition 的执行）。详细职责矩阵见 [design-architecture.md §双轨](design-architecture.md)。

### 阶段衔接：通过事件流解耦

阶段之间不直接互调，全部通过 append `plan_event` + 读投影视图触发。

**慢轨周期**：

```
observe 拉账户快照 + 全量对账补 event + 拉市场数据
   ↓
对每条 active flow：
  agent LLM 读 current_plan + latest_observe + strategy.policy + flow semantics 判动作 + 写 trigger_condition
   ↓
preflight（hard guard 全集 + card validation）
   ↓ (verdict=armable)
executor: trigger_condition 检查 → 落在 range 内则 execute，append order_fill
   ↓
本轮收尾 append observe(source=slow_track, 含意图段 + 证据段 + preflight_result + decision_summary)
   ↓ (某次阶段性闭合时)
review  append review event（记录闭合样本并封口当前 flow）
   ↓
cron.log 追加本轮元数据
```

**快轨周期**：

```
对每条有效 action_intent 的 active flow：
  per-flow 轻量对账（fresh account + symbol-scoped open orders）
   ↓ (一致)
  trigger_condition 检查（mark 在 range 内 + 未过期）
   ↓ (命中)
  G-SPREAD-CAP / G-MARKETABLE-DEPTH-CAP / G-FUNDING-RATE-SPIKE（仅加暴露立即执行）
   ↓ (通过)
  快轨 preflight 子集（G-RISK-OPEN-CAP / G-RISK-DAY-FLOOR / G-BTC-BETA-DIRECTION-CAP / G-SINGLE-POSITION-LEVERAGE-CAP / G-GROSS-EXPOSURE-CAP / G-OBS-FRESH / G-FUNDING-EROSION）
   ↓ (verdict=armable)
  executor: append order_fill + light observe(source=fast_track)
```

防御触发（invalidation 价位被穿）走快轨自主分支：组装 `cancel_order` / `sync_protection` 直接执行。

好处：cron 任意阶段失败就 abort，下次 cron 重跑读最新事件流接续。投影视图即时计算，不维护 stale 标记。

### Stage 简介

| Stage | 干什么 | 调用的功能 skill |
| --- | --- | --- |
| **observe** | `R/V`。慢轨：拉账户快照 + 全量对账（先补 `source=reconcile` 事件；若仍无法可靠归属则 abort 当前周期）+ 拉市场数据 + 识别 regime / 算跨链 exposure，本轮收尾 append 完整 observe(source=slow_track)。快轨：per-flow 轻量对账（fresh account + symbol-scoped open orders），mismatch 直接写 light observe 跳过 | `binance-account-snapshot`, `binance-symbol-snapshot`, `ohlcv-fetch`, `tech-indicators`, `binance-market-scan` |
| **plan** | `A/V`。**仅慢轨走**。对每条 active flow：LLM 读 current_plan + latest_observe + strategy.policy + flow semantics 决定本轮动作 + 写 `action_intent.trigger_condition`；调 `plan-preflight` 跑 hard guard 全集与卡片校验。快轨不进 plan stage | `plan-preflight`, `binance-account-snapshot`（兜底）+ 读 `strategies/*.md` |
| **execute** | `T/V`。慢轨/快轨共用。读 latest action_intent 的 trigger_condition → mark 在 range 内则刷新执行事实 → 跑当前 track 的 preflight 子集 → preview → 下单 → 回填 order_fill。快轨 LLM 仅 orchestrator，不做质性判断 | `binance-order-preview`, `binance-order-place`, `binance-position-protect`, `binance-position-adjust` |
| **review** | `E/V`。仅慢轨写。某次仓位 / plan 阶段性闭合后写 review 事件（5 个必填字段 + notes 自由 markdown） | — |
| **backtest** | `A/E`。跑历史样本验证假设；只写 artifact / evidence，不写交易事实 | `ohlcv-fetch` |
| **iterate** | `E/V`。REVIEW 产出沉淀进 `strategies/`；不得自动升 live-small | — |

注：cron 模式下"分阶段"是逻辑划分。慢轨周期一次性跑完 observe → plan → execute → (review)；快轨周期跑 observe(轻) → execute（不进 plan / review）。不是用户主动一次次切阶段。

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
- `binance-order-cancel`

**远期迁移路径**：`trade-flow/tools/binance/{name}/`。MVP 不动，等套件骨架跑通 + 完成 Claude Code skill 嵌套的技术验证后再迁。

### B 类：通用市场数据 / 分析工具（永久平铺）

这些跨场景复用——研究、回测、可视化、监控、独立分析都可能用：

- `ohlcv-fetch`：纯数据获取
- `tech-indicators`：纯计算
- `binance-symbol-snapshot`：标的快照查询
- `binance-market-scan`：扫描器，独立有价值

绑死在套件内会失去复用价值。永久保持平铺。

### 当前功能 skill 权限

| Skill | Class | 说明 |
| --- | --- | --- |
| `binance-account-snapshot` | `R` | 只读账户事实 |
| `binance-symbol-snapshot` | `R` | 只读单标的事实 |
| `binance-aggtrades-fetch` | `R/A` | 成交流原材料 |
| `binance-liquidation-zones` | `A` | liquidation-like refs |
| `binance-market-scan` | `A` | 候选粗筛 |
| `ohlcv-fetch` | `R/A` | 数据获取与 manifest |
| `tech-indicators` | `A` | 指标、结构、feature report |
| `plan-preflight` | `A` | hard guard，不写事件 |
| `binance-order-preview` | `A` | 不发单，只预演/编译 |
| `binance-order-place` | `T` | 主单写 Binance |
| `binance-position-protect` | `T` | 保护腿写 Binance |
| `binance-position-adjust` | `T` | 减仓 / 平仓写 Binance |
| `binance-order-cancel` | `T` | 撤单写 Binance |
| `notify-dispatch` | `V` | 通知与 cron.log fallback |

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

- ✅ trade-flow 套件骨架（`SKILL.md` + `stages/observe/STAGE.md` + `stages/plan/STAGE.md` + `stages/execute/STAGE.md`）；SKILL.md 接受 `--track slow|fast` 路由两条链
- ✅ `scripts/db/` 下 plan_event 单表 schema + event-repo + projection（含 `latest_slow_observe` / `current_action_intent`）
- ✅ `plan-preflight` skill：flow semantics + hard guard 脚本（全集 + 快轨子集两个入口）+ 6 行 DECISION_CARD 渲染
- ✅ executor 模块：trigger_condition 检查 + 慢/快轨共用执行路径
- ✅ 现有功能 skill 全部保持现状，**不动不迁**
- ✅ cron 运维必备：双轨独立调度（慢轨整点 / 快轨偏移点）+ clientOrderId 前缀幂等 + abort 偏保守 + cron.log（含 track 字段）+ 异常通知

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
