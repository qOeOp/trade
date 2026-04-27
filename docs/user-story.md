# 用户故事

## 1. 使用方式

- 本工程是一台 **4H+ swing cron 自动化执行器**：用户的主要交互不是逐笔下单，而是把它挂在 Claude routines / Codex schedule 上每 1H 或 4H 自动跑。
- 用户的角色：上线前配置（`account_config.json` / watchlist / strategy 池 / `notify_config.json`）→ 上线后只在异常通知或复盘窗口介入 → 累积一段周期后回看是否要改 constitution / strategy。
- 故事只覆盖真实会发生的高频与高风险路径，不追求列尽。
- 文中的 cron 周期阶段：`OBSERVE → 对每条 open chain 决策 → preflight → EXECUTE → REVIEW（chain 关闭时）`。`open / closed` 是 plan 唯一两态；"挂单中 / 持仓中" 由 `current_orders + current_position` 视图自然体现。

## 2. cron 周期里的正常路径

### 固定要求

- 每次 cron 跑都先 `OBSERVE`：拉账户快照 → reduce 当前 open chains → 对账 → 拉市场数据 → 写一条完整 observe（含意图段 + 证据段 + preflight_result + decision_summary）。
- `decision_summary` 必须明确写出本轮做了什么（`placed_order_X` / `cancelled_Y` / `moved_stop_Z` / `no_action`）。
- `EXECUTE` 之前必须先过 `plan-preflight`：硬 invariant + constitution + DECISION_CARD 渲染同时通过才放行。
- 任何执行动作的 `clientOrderId` 用 `<chain_id>-<seq>-<action>` 前缀，cron 重跑幂等。
- 偏保守原则：任何阶段失败就 abort 当前周期，下次 cron 重跑读最新事件流决定动作；不确定就 `no_action`。

### US-01 cron 触发，对当前所有 open chain 推进一轮

- 触发：外部 cron（Claude routines / Codex schedule）按 1H / 4H 频率触发 `trade-flow`。
- 系统行为：
  - 拉账户快照（持仓 / 挂单 / 成交 / 余额）作为事实源
  - 对每条 `state='open'` 的 chain reduce 事件流，对账差异写进 `observe.body.reconcile_diffs`
  - 拉 4H / 1H / 日 K + funding / OI / 关键墙位 / 最近爆仓
  - 每条 chain：LLM 读 `current_plan + observe + constitution + strategy.policy_md` 决定本轮动作
  - 跑 preflight，verdict=blocked 跳过 EXECUTE，仅 append observe；verdict=armable 提交动作后 append `order_fill` + observe
  - 周期收尾写 `run_log`，输出 DECISION_CARD
- 不宜跳过的步骤：
  - 跳过对账直接执行（事件流可能和交易所失同步）
  - 跳过 preflight 直接下单（会绕过两条硬 invariant）
  - 不写 `run_log`（cron 运维丢可观测性）
- 正式输出：
  - 每条 chain 一段 observe + 可选 order_fill
  - 一条 `run_log` 记录本轮元数据
  - DECISION_CARD（每条 open chain 一份，给人扫读）

### US-02 cron 触发后发现可以新开 chain

- 触发：本轮 OBSERVE 阶段 LLM 读市场数据 + 现有 open chains，识别到值得新开 chain 的 setup。
- 系统行为：
  - 起一条新 `plan_chain`（`state='open'`），写第一条 observe（意图段 + 证据段）
  - 意图段必须完整：`thesis / entry_intent / exit_intent / invalidation / stop_price / risk_budget_usdt / strategy_ref / expected_rr_net`
  - 跑 preflight；硬 invariant 失败（成交后 open risk 超 cap / 单日亏损穿底）→ 拒新开
  - preflight 通过即按 `entry_intent` 决定本轮是直接挂单还是仅声明意图等下一轮触发
- 正式输出：
  - 新建 chain + 第一条 observe；可选 `order_fill`（若本轮就挂单）
  - 若 preflight blocked：仅 observe，标 `decision_summary='blocked: <reason>'`，推送通知

### US-03 已挂单的 chain 等成交

- 触发：本轮 OBSERVE 发现某 chain 仍有活跃挂单未成交。
- 系统行为：
  - 对账 + reduce `order_fill` 得到 `current_orders / current_position`
  - LLM 读 `entry_intent + invalidation + valid_until_at` 判：继续等 / 撤单重挂 / 撤单放弃
  - `valid_until_at < now` → `C-PLAN-VALID-WINDOW-NOT-EXPIRED` 触发，强制 `close` 或 `cancel`
  - `invalidation` 条件已触发 → `C-PLAN-INVALIDATION-TRIGGERED` 触发，强制 `close`
- 正式输出：
  - 继续等：仅 append observe，`decision_summary='no_action: waiting for fill'`
  - 撤单：append `order_fill (kind=cancel)` + observe
  - 撤单 + 重挂：两条 `order_fill` + observe
  - 放弃：撤单 + 关 chain（`state='closed'`） + append review

### US-04 持仓中的 chain 推进管理

- 触发：本轮 OBSERVE 发现某 chain 已有 `current_position != 0`。
- 系统行为：
  - 重算未实现盈亏 + 累计 funding cost + RR
  - LLM 读 `exit_intent + invalidation + thesis` 判：继续持有 / 减仓 / 平仓 / 移止损 / 加仓
  - 加仓时新一轮 observe 必须重写 `risk_budget_usdt`，preflight 重跑硬 invariant
  - 移止损：append `order_fill` 取消旧 stop 并下新 stop；preflight 不跑硬 invariant（不增加 open risk）但仍跑 constitution
  - `exit_intent` 里"持仓 ≥ 4H 把累计 funding 折进 break_even" 由 `C-EXEC-FUNDING-IN-BREAKEVEN` 检查
- 正式输出：
  - 继续持有：仅 observe
  - 减仓 / 平仓 / 移止损 / 加仓：对应 `order_fill` + observe
  - 平仓后关 chain → append review

### US-05 chain 关闭后即时 REVIEW

- 触发：本轮某 chain 平仓 / 止损 / 过期 / 主动放弃 → `state` 翻 `closed`。
- 系统行为：
  - 写一条 `review` 事件，必填：`outcome / pnl_pct / thesis_held / key_lesson / promote_to_strategy`
  - `notes` 自由 markdown：cost vs expected / signal accuracy / 其他
  - REVIEW 输入是这条 chain 的完整 `plan_event` 序列，由 LLM 一次性生成
  - 推送 chain 关闭通知（不论 outcome）
- 正式输出：
  - 一条 `review` 事件 + chain `state='closed'`
  - 通知推送，含 outcome + pnl_pct + key_lesson

## 3. cron 周期跑不通：异常通知与人工介入

### 固定要求

- 异常通知通道由 `./data/notify_config.json` 配置；缺文件只写本地日志。
- 通知触发时人工介入也走 cron 重跑路径——人工不直接改数据库；先在交易所端处理或修改配置/strategy/constitution，下次 cron 重跑读最新状态自然衔接。
- 通知内容必须够用户在不打开数据库的情况下决定下一步：包含 chain_id / symbol / 触发条款 / 当前 plan 关键字段 / DECISION_CARD 摘要。

### US-06 硬 invariant 拒绝任何新动作

- 触发：preflight 跑硬 invariant 时 `open_risk_after_fill` 或 `daily_loss_floor` 失败。
- 系统行为：
  - verdict=blocked，跳过 EXECUTE，仅 append observe（含 `preflight_result.must_fail`）
  - 推送通知，含 `equity_live / candidate.risk_budget / active_plans_risk_sum / cap` 数字让用户判断
- 用户介入路径：
  - 接受现状：什么都不做，下次 cron 仍 blocked，循环 abort
  - 缩 candidate `risk_budget_usdt`：下次 cron 跑前手动修改 chain 最近一条 observe.body 意图段（或写新 observe append）后重跑
  - 平掉某条活跃 chain 释放 open risk → 下次 cron 自动识别
  - 改 `account_config.json` 的 `max_open_risk_pct` / `max_day_loss_pct`（最不推荐，等于改风险底线）

### US-07 对账连续 3 轮 stuck

- 触发：同一 chain 的 `observe.body.reconcile_diffs` 连续 ≥ 3 轮非空。
- 系统行为：
  - `C-RECON-CHAIN-NOT-STUCK` 触发，preflight 拒该 chain 任何新动作
  - 推送通知，列出差异明细（事件流 vs 交易所）
- 用户介入路径：
  - 在 Binance UI 手工对齐（撤孤儿单 / 平孤儿仓 / 补缺失保护单）
  - 下一轮 cron 跑会发现差异消除，自动放行
  - 若用户判断事件流错了，可手工往 chain append 一条 observe，body 写明"reconcile manually accepted: <reason>"，下次 cron 视为已确认

### US-08 单日亏损接近底线

- 触发：当日已实现亏损 ≥ 80% × `max_day_loss_pct × equity_live`。
- 系统行为：
  - 推送预警通知（不拦动作，只警告）
  - 若再亏一笔会越底线，下一轮 preflight 的 `daily_loss_floor` 自动 fail
- 用户介入路径：
  - 主动平掉浮亏最深的活跃 chain
  - 等次日重置自动恢复
  - 改 `max_day_loss_pct`（不推荐）

### US-09 cron / Binance API 连续失败

- 触发：cron 运行失败或 Binance API 错误连续 3 次。
- 系统行为：
  - `run_log.errors` 累计；连续 3 次推送通知
  - 偏保守 abort：写不下去就只写已成功的 observe，下次 cron 重跑
- 用户介入路径：
  - 检查 cron 调度本身是否被外部托管（Claude routines / Codex schedule）暂停
  - 检查 API key 权限 / IP 限制 / 网络
  - 暂停 cron 直到环境恢复

### US-10 连续亏损达到上限

- 触发：连续 N 笔 closed chain `outcome='loss'`，N ≥ `max_consecutive_losses`。
- 系统行为：
  - 推送通知，含最近 N 笔 chain 摘要（symbol / strategy_ref / pnl_pct / key_lesson）
  - 不自动暂停 cron（避免反弹时错过）
- 用户介入路径：
  - 暂停 cron 一段时间冷却
  - 看 review notes 找共性 → 改 strategy.policy 或往 constitution 加 SHOULD 条款
  - 缩 `max_open_risk_pct` 降单笔风险

## 4. 上线前配置

### 固定要求

- 配置面只读硬文件 + 数据库表，不在 cron 周期里改配置。
- 改完配置后下一轮 cron 自动生效，不需要重启。

### US-11 首次上线配置

- 用户行为：
  - 创建 `./data/account_config.json`：必填 `max_open_risk_pct / max_day_loss_pct`；可选 `max_correlated_exposure_usdt / max_correlated_gross_exposure_usdt / max_consecutive_losses`
  - 创建 `./data/notify_config.json`：通知通道（Telegram / 邮件 / Push 任选）
  - 在 `strategy_pool` 表预置 MVP 种子（`S-GENERIC-TREND` / `S-GENERIC-MEANREVERT`）；可加自有策略
  - 配置外部 cron 调度（Claude routines / Codex schedule）按 1H 或 4H 频率调起 `trade-flow`
- 验证：手动跑一次 `trade-flow` `--dry-run`：读账户快照 → 写 observe → preflight → 不真发单。检查 DECISION_CARD 渲染是否完整。

### US-12 调整风险底线

- 触发：用户 review 一段时间后觉得 `max_open_risk_pct` 偏紧 / 偏松。
- 用户行为：直接编辑 `account_config.json`。下一轮 cron 自动用新值。
- 不该做：
  - 在亏损通知触发时立刻放宽 `max_day_loss_pct` 续命（违反风险底线初衷）
  - 频繁调（每周改 ≥ 2 次说明阈值定得不对，应回头看是不是 strategy 本身问题）

### US-13 增加新 strategy 或新 constitution 条款

- 触发：累积一批 review 后发现共性，或外部信源提示新模式。
- 用户行为：
  - 新 strategy：往 `strategy_pool` 表 insert 一条（`status='active'` 或 `'draft'`）；`policy_md` 写 setup / 失效 / EV / regime / catalyst / 持仓 / size 段
  - 新 constitution 条款：直接编辑 `.agents/skills/plan-preflight/constitution.md`，按附录格式加一段
- 验证：下一轮 cron 跑会自动加载，无需 schema 迁移、无需改代码。

## 5. 偶尔回看：多 chain 阶段总结

### 固定要求

- 跨 chain 总结不在 cron 周期里跑——cron 只管单 chain 即时 review。
- 用户每周或每月主动跑一次回看脚本（待建）：聚合最近 N 条 closed chain 的 review，看共性。
- MVP 阶段累积 30+ closed chain 前不建 backtest / iterate 自动链路。

### US-14 一段时间后回看哪些 strategy / 条款值得改

- 触发：用户主动决定回看（每周 / 每月一次）。
- 用户行为：
  - 读 `review` 表最近 N 条记录
  - 按 `strategy_ref` 聚合：胜率 / 平均 pnl_pct / thesis_held 比例 / `promote_to_strategy=true` 比例
  - 按 constitution clause_id 聚合 ack 频率：某条款被 ack 样本胜率长期低于整体 → 该升 MUST
  - `notes` 字段累积 20+ 样本后看是否需要拆出新结构化字段
- 正式输出：
  - 候选改动：retire 某 strategy / 升级某 SHOULD 为 MUST / 抽 review.notes 新字段
  - 候选规则进 constitution.md（先 SHOULD 跑一段，再决定升 MUST）

### US-15 自动化误判事后回看

- 触发：某 closed chain 结果不理想，用户怀疑是 cron 当时漏判 / strategy 不适配 / constitution 缺条款。
- 用户行为：
  - 读这条 chain 的完整 `plan_event` 序列（observe + order_fill + review）
  - 沿 observe 时间轴看：每轮 LLM 看到了什么、判了什么、preflight 拒了什么
  - 区分四类原因：strategy.policy 没覆盖这种场景 / constitution 缺关键条款 / observe 证据段不够（如缺微结构字段）/ LLM 判错（同样输入下一轮跑也错）
- 正式输出：
  - 改 strategy.policy 加场景说明
  - 加一条 constitution 条款（先 SHOULD）
  - 补 observe 证据段字段（如新 microstructure 维度，需改 trade-flow 代码）
  - LLM 判错：暂时只在 review.notes 里记录，累积 5+ 同类样本再考虑改 constitution

## 6. 不在本文件覆盖的场景

以下场景在 MVP 不展开，等真实需求出现再加：

- **probe / 日内策略**：项目层固定不做
- **hedge 多腿净敞口管理**：`plan_relation` 与 `S-HEDGE-GENERIC` 推迟，等真有对冲需求再启用
- **离线 backtest / iterate / strategy-pool 升级链路**：累积 30+ closed chain 后再展开
- **跨账户 / 跨平台**：项目层固定 Binance USDM 永续单账户
- **手工逐笔下单的交互式协作**：本系统不为此设计——用户偶尔想手工干预 → 直接在 Binance UI 做，下次 cron 跑会通过对账自动衔接
