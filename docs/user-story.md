# 用户故事

## 1. 使用方式

- 本工程是一台 **4H+ swing cron 自动化执行器**：用户的主要交互不是逐笔下单，而是把它挂在 Claude routines / Codex schedule 上每 1H 或 4H 自动跑。
- 用户的角色：上线前配置（`account_config.json` / watchlist / strategy 文件 / `notify_config.json`）→ 上线后只在异常通知或复盘窗口介入 → 累积一段周期后回看是否要改 rules / strategy。
- 故事只覆盖真实会发生的高频与高风险路径，不追求列尽。
- 文中的 cron 周期阶段：`OBSERVE → 对每条启用策略流决策 → preflight → EXECUTE → REVIEW（某次仓位或 plan 阶段性闭合时）`。数据库里同时维护多条策略流，不是假设系统只围绕一条最新机会流转；"挂单中 / 持仓中" 由 `current_orders + current_position` 视图自然体现。

## 2. cron 周期里的正常路径

### 固定要求

- 每次 cron 跑都先 `OBSERVE`：拉账户快照 → reduce 当前启用策略流 → 对账 → 拉市场数据 → 写一条完整 observe（含意图段 + 证据段 + preflight_result + decision_summary）。
- `decision_summary` 必须明确写出本轮做了什么（`placed_order_X` / `cancelled_Y` / `moved_stop_Z` / `no_action`）。
- `EXECUTE` 之前必须先过 `plan-preflight`：三段（代码爆仓护栏 + 代码数据卫生 + LLM 读 rules.md）+ DECISION_CARD 渲染同时通过才放行。
- 任何执行动作的 `clientOrderId` 用 `<chain_id>-<seq>-<action>` 前缀，cron 重跑幂等。
- 偏保守原则：任何阶段失败就 abort 当前周期，下次 cron 重跑读最新事件流决定动作；不确定就 `no_action`。

### US-01 cron 触发，对当前所有启用策略流推进一轮

- 触发：外部 cron（Claude routines / Codex schedule）按 1H / 4H 频率触发 `trade-flow`。
- 系统行为：
  - 拉账户快照（持仓 / 挂单 / 成交 / 余额）作为事实源
  - 对每条启用策略流 reduce 事件流，对账差异写进 `observe.body.reconcile_diffs`
  - 拉 4H / 1H / 日 K + funding / OI / 关键墙位 / 最近爆仓
  - 每条策略流：LLM 读 `current_plan + observe + rules.md + strategy.policy` 决定本轮动作
  - 跑 preflight，verdict=blocked 跳过 EXECUTE，仅 append observe；verdict=armable 提交动作后 append `order_fill` + observe
  - 周期收尾追加 `cron.log`，输出 DECISION_CARD
- 不宜跳过的步骤：
  - 跳过对账直接执行（事件流可能和交易所失同步）
  - 跳过 preflight 直接下单（会绕过爆仓护栏）
  - 不写 `cron.log`（cron 运维丢可观测性）
- 正式输出：
  - 每条策略流一段 observe + 可选 order_fill
  - 一行 `cron.log` 记录本轮元数据
  - DECISION_CARD（每条启用策略流一份，给人扫读）

### US-02 cron 触发后，某策略在原有流里识别到新的 setup

- 触发：本轮 OBSERVE 阶段 LLM 读市场数据 + 该策略既有事件流，识别到值得更新当前 plan 的 setup；若该策略首次上线且尚无 flow，则先 bootstrap。
- 系统行为：
  - 若该策略尚无 flow，先生成 `chain_id`（UUID）并 append first observe；后续 cron 都沿用同一 `chain_id`
  - 若该策略已有 flow，不新开 chain，而是在原 flow 上 append 新 observe 更新意图段 + 证据段
  - 意图段必须完整：`thesis / entry_intent / exit_intent / invalidation / stop_price / risk_budget_usdt / strategy_ref / expected_rr_net`
  - 跑 preflight；爆仓护栏失败（成交后 open risk 超 cap / 单日亏损穿底）→ 拒本轮新动作
  - preflight 通过即按 `entry_intent` 决定本轮是直接挂单还是仅声明意图等下一轮触发
- 正式输出：
  - 原 flow 上新增 observe；可选 `order_fill`（若本轮就挂单）
  - 若 preflight blocked：仅 observe，标 `decision_summary='blocked: <reason>'`，推送通知

### US-03 已挂单的策略流等成交

- 触发：本轮 OBSERVE 发现某策略流仍有活跃挂单未成交。
- 系统行为：
  - 对账 + reduce `order_fill` 得到 `current_orders / current_position`
  - LLM 读 `entry_intent + invalidation + valid_until_at` 判：继续等 / 撤单重挂 / 撤单放弃
  - `valid_until_at < now` → `R-PLAN-VALID-WINDOW` 触发，强制 `cancel_order` 或 `sync_protection`（平仓）
  - `invalidation` 条件已触发 → `R-PLAN-INVALIDATION-TRIGGERED` 触发，强制 `sync_protection`（平仓）/ `cancel_order`
- 正式输出：
  - 继续等：仅 append observe，`decision_summary='no_action: waiting for fill'`
  - 撤单：append `order_fill (kind=cancel)` + observe
  - 撤单 + 重挂：两条 `order_fill` + observe
  - 放弃：撤单 + append review event（记录本次阶段性闭合；flow 保持可继续）

### US-04 持仓中的策略流推进管理

- 触发：本轮 OBSERVE 发现某策略流已有 `current_position != 0`。
- 系统行为：
  - 重算未实现盈亏 + 累计 funding cost + RR
  - LLM 读 `exit_intent + invalidation + thesis` 判：继续持有 / 减仓 / 平仓 / 移止损 / 加仓
  - 加仓时新一轮 observe 必须重写 `risk_budget_usdt`，preflight 重跑爆仓护栏
  - 移止损：append `order_fill` 取消旧 stop 并下新 stop；preflight 跳过爆仓护栏（不增加 open risk）但仍跑数据卫生 + LLM 判
  - `exit_intent` 里"持仓 ≥ 24H 把累计 funding 折进 break_even" 由 `R-FUNDING-BREAKEVEN` 检查
- 正式输出：
  - 继续持有：仅 observe
  - 减仓 / 平仓 / 移止损 / 加仓：对应 `order_fill` + observe
  - 平仓后 append review；flow 不关闭，后续继续观察下一轮 setup

### US-05 某次阶段性闭合后即时 REVIEW

- 触发：本轮某策略流内某次平仓 / 止损 / 过期 / 主动放弃。
- 系统行为：
  - append 一条 `review` 事件，必填：`outcome / pnl_pct / thesis_held / key_lesson / promote_to_strategy`
  - `notes` 自由 markdown：cost vs expected / signal accuracy / 其他
  - REVIEW 输入是这条策略流中本次阶段性闭合附近的 `plan_event` 序列，由 LLM 一次性生成
- 正式输出：
  - 一条 `review` event 写入；同一条策略流后续 cron 仍可继续 append

## 3. cron 周期跑不通：异常通知与人工介入

### 固定要求

- 异常通知通道由 `./data/notify_config.json` 配置；缺文件只写本地日志。
- 通知触发时人工介入也走 cron 重跑路径——人工不直接改数据库；先在交易所端处理或修改 config / strategy / rules，下次 cron 重跑读最新状态自然衔接。
- 通知内容必须够用户在不打开数据库的情况下决定下一步：包含 `chain_id`（策略流 ID）/ symbol / 触发条款 / 当前 plan 关键字段 / DECISION_CARD 摘要。

### US-06 爆仓护栏拒绝任何新动作

- 触发：preflight 跑爆仓护栏时 `R-RISK-OPEN-CAP` 或 `R-RISK-DAY-FLOOR` 失败。
- 系统行为：
  - verdict=blocked，跳过 EXECUTE，仅 append observe（含 `preflight_result.violations`）
  - 推送通知，含 `equity_live / candidate.risk_budget / active_plans_risk_sum / cap` 数字让用户判断
- 用户介入路径：
  - 接受现状：什么都不做，下次 cron 仍 blocked，循环 abort
  - 缩 candidate `risk_budget_usdt`：下次 cron 跑前手动修改该策略流最近一条 observe.body 意图段（或写新 observe append）后重跑
  - 平掉某条活跃策略流中的持仓释放 open risk → 下次 cron 自动识别
  - 改 `account_config.json` 的 `max_open_risk_pct` / `max_day_loss_pct`（最不推荐，等于改风险底线）

### US-07 对账连续 3 轮 stuck

- 触发：同一策略流的 `observe.body.reconcile_diffs` 连续 ≥ 3 轮非空。
- 系统行为：
  - `R-RECON-CHAIN-NOT-STUCK` 触发，preflight 拒该策略流任何新动作
  - 推送通知，列出差异明细（事件流 vs 交易所）
- 用户介入路径：
  - 在 Binance UI 手工对齐（撤孤儿单 / 平孤儿仓 / 补缺失保护单）
  - 下一轮 cron 跑会发现差异消除，自动放行
  - 若用户判断事件流错了，可手工往该策略流 append 一条 observe，body 写明"reconcile manually accepted: <reason>"，下次 cron 视为已确认

### US-08 单日亏损接近底线

- 触发：当日已实现亏损 ≥ 80% × `max_day_loss_pct × equity_live`。
- 系统行为：
  - 推送预警通知（不拦动作，只警告）
  - 若再亏一笔会越底线，下一轮 preflight 的 `daily_loss_floor` 自动 fail
- 用户介入路径：
  - 主动平掉浮亏最深的活跃策略流持仓
  - 等次日重置自动恢复
  - 改 `max_day_loss_pct`（不推荐）

### US-09 cron / Binance API 连续失败

- 触发：cron 运行失败或 Binance API 错误连续 3 次。
- 系统行为：
  - `cron.log` 中 `errors` 累计；连续 3 次推送通知
  - 偏保守 abort：写不下去就只写已成功的 observe，下次 cron 重跑
- 用户介入路径：
  - 检查 cron 调度本身是否被外部托管（Claude routines / Codex schedule）暂停
  - 检查 API key 权限 / IP 限制 / 网络
  - 暂停 cron 直到环境恢复

### US-10 连续亏损达到上限

- 触发：连续 N 条 `review` 样本 `outcome='loss'`，N ≥ `max_consecutive_losses`。
- 系统行为：
  - 推送通知，含最近 N 条 review 摘要（symbol / strategy_ref / pnl_pct / key_lesson）
  - 不自动暂停 cron（避免反弹时错过）
- 用户介入路径：
  - 暂停 cron 一段时间冷却
  - 看 review notes 找共性 → 改 strategy.policy 或往 rules.md 加一条新 rule
  - 缩 `max_open_risk_pct` 降单笔风险

## 4. 上线前配置

### 固定要求

- 配置面只读硬文件 + 数据库表，不在 cron 周期里改配置。
- 改完配置后下一轮 cron 自动生效，不需要重启。

### US-11 首次上线配置

- 用户行为：
  - 创建 `./data/account_config.json`：必填 `max_open_risk_pct / max_day_loss_pct`；可选 `max_correlated_exposure_usdt / max_correlated_gross_exposure_usdt / max_consecutive_losses`
  - 创建 `./data/notify_config.json`：通知通道（Telegram / 邮件 / Push 任选）
  - 在 `.agents/skills/trade-flow/strategies/` 放 MVP 种子文件（`S-GENERIC-TREND.md` / `S-GENERIC-MEANREVERT.md`，frontmatter + policy markdown）；可加自有策略
  - 配置外部 cron 调度（Claude routines / Codex schedule）按 1H 或 4H 频率调起 `trade-flow`
- 验证：手动跑一次 `trade-flow` `--dry-run`：读账户快照 → 写 observe → preflight → 不真发单。检查 DECISION_CARD 渲染是否完整。

### US-12 调整风险底线

- 触发：用户 review 一段时间后觉得 `max_open_risk_pct` 偏紧 / 偏松。
- 用户行为：直接编辑 `account_config.json`。下一轮 cron 自动用新值。
- 不该做：
  - 在亏损通知触发时立刻放宽 `max_day_loss_pct` 续命（违反风险底线初衷）
  - 频繁调（每周改 ≥ 2 次说明阈值定得不对，应回头看是不是 strategy 本身问题）

### US-13 增加新 strategy 或新 rule

- 触发：累积一批 review 后发现共性，或外部信源提示新模式。
- 用户行为：
  - 新 strategy：在 `.agents/skills/trade-flow/strategies/` 加一个 markdown 文件（frontmatter `strategy_id / name / status / tags` + policy 正文）
  - 新 rule：直接编辑 `.agents/skills/plan-preflight/rules.md`，按附录格式加一个 H2 段落（命名 `R-<DOMAIN>-<POINT>`）
- 验证：下一轮 cron 跑会自动加载，无需 schema 迁移、无需改代码。

## 5. 偶尔回看：多策略阶段总结

### 固定要求

- 跨策略 / 跨阶段性样本总结不在 cron 周期里跑——cron 只管单策略流内的即时 review。
- 用户每周或每月主动跑一次回看脚本（待建）：聚合最近 N 条 `review` 事件，看共性。
- MVP 阶段累积 30+ review 样本前不建 backtest / iterate 自动链路。

### US-14 一段时间后回看哪些 strategy / 条款值得改

- 触发：用户主动决定回看（每周 / 每月一次）。
- 用户行为：
  - 读最近 N 条 `review` event（`SELECT body_json FROM plan_event WHERE kind='review' ORDER BY created_at DESC LIMIT N`）
  - 按 `strategy_ref` 聚合：胜率 / 平均 pnl_pct / thesis_held 比例 / `promote_to_strategy=true` 比例
  - 按 `violations[].rule_id` 聚合：某条 rule 拦的胜率最高 / 哪条是 false positive（拦了但其实该过）/ 哪条该把语言写得更强
  - `notes` 字段累积 20+ 样本后看是否需要拆出新结构化字段
- 正式输出：
  - 候选改动：retire 某 strategy / 调强某 rule 的措辞 / 抽 review.notes 新字段
  - 候选规则进 rules.md（先写温和措辞跑一段，再根据数据决定要不要写"违反直接拒"）

### US-15 自动化误判事后回看

- 触发：某条 review 样本结果不理想，用户怀疑是 cron 当时漏判 / strategy 不适配 / rules 缺条款。
- 用户行为：
  - 读对应策略流中该次阶段性闭合附近的 `plan_event` 序列（observe + order_fill + review）
  - 沿 observe 时间轴看：每轮 LLM 看到了什么、判了什么、preflight 拒了什么
  - 区分四类原因：strategy.policy 没覆盖这种场景 / rules 缺关键条款 / observe 证据段不够（如缺微结构字段）/ LLM 判错（同样输入下一轮跑也错）
- 正式输出：
  - 改 strategy.policy 加场景说明
  - 加一条 rule 进 rules.md
  - 补 observe 证据段字段（如新 microstructure 维度，需改 trade-flow 代码）
  - LLM 判错：暂时只在 review.notes 里记录，累积 5+ 同类样本再考虑改 rules.md

## 6. 不在本文件覆盖的场景

以下场景在 MVP 不展开，等真实需求出现再加：

- **probe / 日内策略**：项目层固定不做
- **hedge 多腿净敞口管理**：推迟，等真有对冲需求再启用（届时增设 `plan_relation` 表 + `S-HEDGE-GENERIC` strategy + 升级 `R-RISK-OPEN-CAP` 公式为 hedge-aware 版本）
- **离线 backtest / iterate / strategy-pool 升级链路**：累积 30+ review 样本后再展开
- **跨账户 / 跨平台**：项目层固定 Binance USDM 永续单账户
- **手工逐笔下单的交互式协作**：本系统不为此设计——用户偶尔想手工干预 → 直接在 Binance UI 做，下次 cron 跑会通过对账自动衔接
