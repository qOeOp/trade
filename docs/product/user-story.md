---
title: User Story
role: product-contract
status: active
owner: product
last_verified: 2026-07-23 CST
---

# 用户故事

## 1. 使用边界

用户配置策略、权限、风险底线与可选 Agent Host，program runtime 按 cadence 推进工作；用户主要在阻断、异常和复盘时介入。在线动作始终复用同一套 event、preflight、execution 和 reconcile 合同，不因 scheduler、Codex、OpenClaw、LangGraph 或人工触发而改变权限。

本文只描述产品可观察行为。具体命令、字段和 Guard ID 分别以 `toolset.json`、owner module `CONTRACT.md`、[Event and Flow Contract](../runtime/event-flow-contract.md) 和 [Risk Control Contract](../runtime/risk-control-contract.md) 为准。

## 2. 核心故事

### US-01 周期开始但没有可执行机会

- 系统读取 runtime health、账户、订单、持仓和必要市场事实。
- 没有合格 setup、事实不新鲜、cadence 未到或 guard blocked 时，结果必须是可解释的 `no_action / skipped / blocked`。
- 不得为了让周期“有产出”创建订单、研究任务或新 flow。

验收：用户能从 summary / refs 看出谁跳过、为何跳过、是否需要介入。

### US-02 慢轨识别新 setup

- 慢轨可以形成 thesis、entry、stop、invalidation、risk budget 和 action intent。
- 同一 `strategy_ref + symbol + side` 同时最多一个 active flow；旧 flow 未闭合时，新理由必须并回旧 flow 或等待闭合。
- action intent 只是待裁决意图，不是 exchange write 授权。

验收：新 flow 有稳定身份、输入 refs、完整 plan；缺一项即不得新增风险。

### US-03 快轨守护已有意图

- 快轨只消费 active flow 已冻结的意图、最新事实和 policy snapshot。
- 它可以触发已授权动作或做 reduce / cancel / protection 等防御动作；不得新建 thesis、扩大授权范围或改写 risk budget。
- spread、depth、funding 等尚未统一进入 preflight 的能力只能作为事实、warning 或策略约束，不得伪装为已执行的硬门。

验收：每次执行能回指慢轨意图；没有授权时只能阻断或减风险。

### US-04 执行新增风险

- strategy / setup 具备 `live-small` 权限，runtime 未被 kill switch / risk lock 阻断。
- facts、plan、policy、preflight verdict 和 execution contract 均完整且 fresh。
- exchange write 必须显式授权、幂等，并在提交后确认或进入 reconcile。
- submit 不等于成交；只有 fill / reconciled fill 改变 position。

验收：任何真钱动作都能回答“基于哪次 observe、哪项 policy、哪次 verdict、哪份 execution contract”。

### US-05 管理挂单和持仓

- 周期先以交易所事实校对本地 projection。
- 继续等待、撤单、保护修复、减仓、平仓或加仓都形成新的事件事实；不得覆盖旧计划或旧结果。
- 加仓属于新增风险，必须重新完整 preflight；明确的减风险动作在 safe mode 下仍可进行，但必须审计。

验收：重跑不会重复下单，未知订单或无法归属持仓会触发 risk lock。

### US-06 对账失败

- owner recovery 尝试用账户、订单和成交事实恢复缺失事件。
- 无法可靠归属时进入 `unknown / needs_review`，停止新增风险，不猜测填充历史。
- 用户可以在交易所确认事实或修复配置；恢复仍通过正式 owner 入口写入。

验收：风险锁解除前只有 observe、review 和明确减风险动作可继续。

### US-07 flow 闭合并复盘

- flow 闭合后生成量化结果、成本、执行归因和最小定性结论。
- review 区分 thesis、data、execution、guard、cost 和 process 问题。
- review 可以提出 hypothesis 或 policy feedback，但不能直接改策略、改历史 verdict 或自动 promotion。

验收：同一 lane 的下一次独立机会使用新 flow，旧 flow 保持可复读。

### US-08 研发候选策略

- R&D 在冻结的 hypothesis、dataset split、trial budget 和 execution assumptions 下运行。
- discovery、validation、locked holdout、negative control 与失败结果都留下权威记录。
- Replay / Forward 产生 evidence；governance 决定是否物化 draft、进入 shadow 或允许 live-small。

验收：研究任务不能写在线交易事件，不能调用 Binance write，不能自动升格。

### US-09 用户调整配置或策略

- 配置只控制权限、上限、成本假设和启用范围；不能重写策略 entry / stop / thesis。
- 策略变更使依赖旧版本的证据 stale，需要重新验证。
- 放宽风险底线必须是显式配置 / governance 变更，不得在一次 blocked verdict 上临时覆盖。

验收：新配置从下一次编译 policy snapshot 起生效，历史 snapshot 与 verdict 不变。

### US-10 切换 Agent Host

- 用户可以按任务或部署 profile 选择受支持的 Agent Host，而不迁移 strategy、trade、research 或 governance 状态。
- 每个 Host 看到同一组 allowlisted owner capabilities；Host 私有 session、checkpoint 和 memory 不得补写领域事实。
- 切换前后使用稳定 request identity、prompt/toolset version 和 result validation；未完成任务不能被当成成功接管。

验收：相同只读或 proposal-only 任务可在候选 Host 上回放比较；关闭旧 Host 不影响确定性 program job。

### US-11 常驻程序请求语义任务

- job 只有在确定性代码无法完成、且 task type 已登记时，才提交有 deadline、token/tool budget、输入 refs、输出 schema 和 approval policy 的 Agent run。
- Agent 只能返回 validated proposal、artifact/ref 或明确的 `blocked / retryable / no_action`；不得直接改变 owner state。
- code execution 若启用，必须在无凭证、默认无网络、有资源上限的 sandbox 中运行，并通过 host broker 调用受控能力。

验收：每次语义任务都能追到模型、Host、版本、预算、tool calls、审批和最终验证；超时或非法调用 fail closed。

### US-12 Agent 或 provider 故障

- Host/provider 退出、限流、超时或重启时，依赖语义能力的 job 进入可恢复状态，不伪造结果、不重复副作用。
- L2、账户对账、risk lock、保护与其他确定性 job 继续运行；只有其自身 owner health 可以阻断它们。
- 恢复后按稳定 identity 继续、重试或人工取消，不能依赖聊天记忆猜测先前进度。

验收：kill/restart 与重复投递测试中最多形成一个 owner effect；无法确认时保持 blocked 并要求审阅。

## 3. 人工介入优先级

出现异常时，用户依次判断：

1. 是否需要先在交易所减风险或确认事实。
2. 是否是 transient API / scheduler 故障，可安全重跑。
3. 是否需要修复 config、strategy 或 owner 数据。
4. 是否形成 control review / R&D lesson。

禁止直接编辑 durable DB 制造“已恢复”状态。

## 4. 非目标

- probe / 日内高频、做市、hedge 多腿组合。
- 多账户、多交易所、自建通用聊天 UI / SaaS。
- 人工逐笔聊天式下单作为主路径。
- 依靠固定唤醒分钟、某个 prompt 或未实现 Guard ID 定义长期产品合同。
- 把 Codex、OpenClaw、LangGraph 或任何模型 provider 固定成不可替换的业务 authority。
