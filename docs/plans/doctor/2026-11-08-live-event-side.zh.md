# 2026-11-08 Live 订单事件方向展示

| Item | Value |
|---|---|
| Sessions | Codex 主会话 01a1b0a1-c7f5-7381-b08a-36a7084eaca9；用户先发截图询问 Submitted / Accepted 行的大量 Unknown；精确提交时间未单独计量 |
| Audit session | 同会话 focused diagnosis，非全量审计；独立工作树 `/tmp/trade-live-event-side-display-20261108` |
| Checkout / ledger | fetch 后 origin/main `b0f876aaaa4d682bef1fe6f266823ef481d63ac8`；未读取或写入账本、真实账户或凭据 |
| Coverage | rc7 OrderSubmitted / OrderAccepted / Initialized / Filled 定义，engine.live.native_event → live.views._native_rows → DTO → LiveEvents；未声称已核对截图运行的线上原件或账户状态 |
| Cost | 用户可见歧义已出现；时间、tokens及交易影响未计量 |
| Net change | 建议仅改 UI 对已有字段的呈现；不新增持久字段、后端事件、引擎、检查、拒绝码或技能文字 |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261108-01 | Live 把事件类型本来不携带的方向显示为 Unknown，造成同订单方向似乎丢失的歧义 | 用户截图中 Submitted / Accepted 为 Unknown，Initialized / Filled 为 BUY / SELL。rc7 `crates/model/src/events/order/submitted.rs:144`、`accepted.rs:155` 的 order_side 返回 None；Initialized / Filled 有真实方向。`engine/live.py:652` 保留原生 to_dict，`live/views.py:183` 只投影原件已有字段；`ide/web/src/components/LiveEvents.tsx:9` 把缺省方向统一渲染 Unknown。消费链中的错误解释在 UI，没有证据说明原生订单未知或丢失。原应由 Product contracts and delivery 覆盖。 | fix | wrong output | open |

## Removal list

| Mechanism | Risk it guards | Covered by | Sessions show | Proposal |
|---|---|---|---|---|
| 缺省 Side 一律 Unknown | 不编造缺失交易事实 | 保留原始事件、区分未提供与无效值；仅从同品种、同 client order ID 的一致方向派生展示 | 正常原生事件也被显示成未知 | 去掉误导性的无差别占位；已知方向只在 UI 关联，无法关联显示 —，明确无效值仍保留 Unknown |

保留现状或追加操作说明不能消除每条 Submitted / Accepted 行的歧义。无需增加服务端字段或另建订单状态表：方向是订单不变属性，已保留的初始化/成交事件能提供它；200条窗口缺失相应事件时不猜测。不要把 quantity、last_qty 或价格沿同一规则补齐，它们有不同的事件时点语义。存在同一身份方向冲突时也不为缺字段行挑一个值。

## Decisions

本条是展示缺陷，原始事件、交易检查、验收判据与账户操作不变。沿现 Live 功能完善任务准备独立修复；合并会发布，因此不在本诊断中合并或部署。
