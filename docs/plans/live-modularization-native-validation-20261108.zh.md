# U1：rc7 混合原生保护的首批离线实证

2026-11-08。按已评审设计验证原生能力；不修改产品策略、准入、GTD 标准或框架版本，不连接交易所。合成输入与探针原件仅在 `/tmp/trade-live-modularization-r1-evidence-20261108/`；本报告不构成实盘保护验收。

## 方法与原生复用

使用已安装 `nautilus_trader==2.0.0rc7`，复用 `tests.engine.test_partial_entry_protection` 的原生 instrument、volume-limited bars 和 fees；native BacktestEngine 的 venue 配置 `support_contingent_orders=False`。source 使用原生 `StrategyConfig(manage_contingent_orders=True, manage_gtd_expiry=True)`、OrderFactory.bracket、公共 order.to_dict/from_dict 和 submit_order_list；仅给 TP child 设置 LAST_PRICE emulation，parent LIMIT/GTD 与 STOP_MARKET child 不 emulated。没有自写 OTO/OUO manager、订单 cache、撮合或 fill event。

三次入场各成交0.250；额外目标 tick 是明示合成的 native TradeTick，只用于机制实验，不是把 OHLC 转换成真实历史 ticks，也不主张该数据能用于正式研究。native simulated venue 可修改 STOP_MARKET，与 Binance adapter 的无 price 修改边界不同。

原生依据：rc7 `order_manager/manager.rs::test_handle_oto_partial_fill_resizes_once_and_submits_only_for_active_local`、`test_handle_ouo_partial_fill_resizes_open_sibling`；`order_emulator/emulator.rs::test_release_order_sends_transformed_command`。这些上游 Rust tests 本轮只读，实际执行的是 Python 调用发布版原生核心的六组实验。

## 六组实际观察

| 原件 | 观察 | 能证明 / 不能证明 |
| --- | --- | --- |
| `plain-v2` | 无 emulation 的 list 在不支持 contingencies 的模拟 venue 中，children 被拒绝，留下0.750仓位 | manager 开关不能自行让任意 venue 支持 list；不是 Binance 协议复现 |
| `mixed-v1` | parent LIMIT/GTD 保持，三次累计0.750；native manager 发出0.500、0.750两次 stop modify；entry 到期后 stop 保留并最终成交，flat | 本地持有、逐单分发与部分成交 sizing 已有原生机制；不能证明 Binance 接受这两个 modify |
| `mixed-target-v3` | native LAST_PRICE触发 TP，原生 LIMIT child 释放为 MARKET；0.750退出、stop取消、flat | 本地 TP 确实改变订单类型/成交模型，不是 venue LIMIT 的等价开关 |
| `mixed-target-partial-v3` | TP market 在同时间戳分0.250与0.500退出；stop曾缩至0.500，最终取消，flat | 证明原生部分退出会产生 stop 数量变更；没有人为延迟两个 fill，不证明跨网络间隔保护 |
| `mixed-late-fill-v3` | TP先平掉0.750，parent余单仍在；后续又成交0.250，stop已取消，留下无新stop的仓位 | 裸 mixed 配置不能替代 source 对剩余 entry 的生命周期选择；保留失败反例，不判通过 |
| `mixed-late-fill-v4` | 只增加原生测试已有的 `on_position_closed → cancel_all_orders`，parent在晚行情前取消，最终flat | 原生撤单 API 可执行这项 source 业务清理；模拟撤单先确认，不证明 fill-before-cancel 或迟到网络回报 |

每组 JSON 保留原生 orders、完整事件与逐 bar cache 快照；日志保留原生 Submit/Modify。`native-observations.json` 汇总事实，断言只核对记录的观察，没有修改任何历史验收工具。`native-mixed-probe-v2.py` 三个带 tick 用例最初用了不存在的 AggressorSide.BUYER，启动实验前报错；原件保留，v3按该版本真实 AggressorSide.BUY 修正。该 API 拼写错误不计为交易场景失败或通过。

## 后续明确边界

- 本轮没有连接 Binance adapter 的 loopback 协议 fixture。源码已指出无 price 的 STOP_MARKET modify 会被原生拒绝，仍需在 adapter 中实际复现和核对覆盖，不能把模拟 venue 成功转成实盘能力。
- 保留原生 partial manager，不复制 sizing 状态机；原生撤单确认之前的迟到 fill、两个保护同时触发、断线后的 native 内部动作与产品命令检查位置，仍在 U1。
- mixed需要 ticks，现三模式正式输入能否提供及如何保持源语义尚未验收。修改正式策略或放开当前 list/emulation/modify 边界仍不能开始。
- 没有以本轮原生成功替换 GTD 来源证据，没有升级、改变终态/时间标准或宣布 U2 已获准。
