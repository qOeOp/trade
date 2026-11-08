# Native 保护单能力补充审查（rc7）

本补充只读核对官方 `v2.0.0rc7` 源码、该版本文档与原生测试，不修改产品或框架，不运行真实连接，不执行 Docker。源码根仍为 `/tmp/trade-gtd-offline-origin-20261108/upstream-rc7`。这些机制测试本次只阅读，不能计为已执行的 Binance 联合验收。

## 决策结论

**框架有本地 OTO/OCO/OUO、partial-fill 缩量和逐单释放机制。不能因为 Binance Futures 拒绝 linked batch list，就默认需要在策略或 runner 重写这些机制。**

1. `manage_contingent_orders=True` 单独不会拆解初始 order list，也不会把仍未提交的 OTO 子单释放到 venue。它管理已经进入非 active-local 状态的单。
2. `OrderEmulator` 的 active-local `OrderManager` 能持有 OTO 子单、在 parent fill 后按原生持仓与累计成交缩量、逐张释放订单。含 emulation 的 list 会先到 Emulator，而不会作为 linked batch 交给 Binance。
3. 原生逐单路径不要求清除 linked 元数据。Emulator 转换订单会保留 contingency/list/linked/parent；Binance Futures 的 grouped 检查只发生于 batch list builder，single-order validator 不检查这些字段。
4. **当前产品拒绝 list、emulation、linked/parent 和修改订单，无法直接启用这条路径。这个障碍主要是产品已批准范围，不是 Nautilus 缺少机制。**
5. 本地 emulated stop 与目前要求的交易所保护单不是同一服务：需要实时 quotes/trades，进程/行情断开后不会在 venue 自行触发；释放又有原生 RiskEngine 路由差异。不能为了复用而悄悄改变这些行为。

因此 U 的正式设计应先比较“原生 Emulator + 原生 manager”和“venue 保护单 + 原生已开放关联管理”与现要求的具体不兼容点。现阶段不能断言 independent 手写保护是唯一解，也不能直接把 emulation 开关打开。只有原生候选经明确需求和测试被排除，才能批准最小自有编排；要记录排除的是机制能力、venue 限制还是当前产品准入。

## 精确调用链

### A. 仅打开 StrategyConfig.manage_contingent_orders

- `crates/trading/src/strategy/core.rs:315` 注册 `OrderManager(..., active_local=false)`。
- `crates/trading/src/strategy/mod.rs:1417` 在 native order event 处理中调用 manager，`:1425` 在用户具体和聚合回调之前分发 actions。
- `crates/execution/src/order_manager/manager.rs:194` 的 `should_manage_order` 比较 `active_local == order.is_active_local()`。
- OTO fill 路径 `manager.rs:320–423` 会按 parent 累计 fills、真实 position 和 instrument increment 计算 child 数量。但 `create_new_submit_order` 的条件包含 **`self.active_local`**（约 404 行）；因此 strategy manager 不释放尚未提交的 child。
- `strategy/mod.rs:1453–1488` 执行原生 cancel/modify/risk/emulator actions。该调用位于 Rust Strategy/manager 内，不能假定重新经过 Python `_LiveConfigured.modify_order` 等覆盖方法；开放该机制时要验证完整 native 命令流的检查所有者。
- 初始 `submit_order_list` 的 routing（`strategy/mod.rs:313–325`）只根据 emulation/algo 决定去 Emulator、algo 或 Risk；没有因 `manage_contingent_orders` 自动拆 list。

官方文档 `docs/concepts/orders/advanced.md:52–63` 明确写出：只管理 open non-active-local orders，不增加 venue support、不提交 non-active-local OTO child。

### B. OrderEmulator 管理本地 OTO + 逐单到 Binance

- `Strategy.submit_order_list` 发现任一 order 有 emulation trigger，即路由 Emulator（上文路径）；所有原生订单已经统一进入 Cache。
- `crates/execution/src/order_emulator/emulator.rs:90–92` 建立 `active_local=true` manager。
- `:756–791` `handle_submit_order_list` 读取原生 Cache，发现 child 的 parent 是 OTO 就暂缓 child；其他订单调用 `manager.create_new_submit_order`。
- `manager.rs:142–188` 构建 **单个** `SubmitOrder`；有 trigger 则到 Emulator，无 trigger 则到 Risk（或已有 execution algorithm）。这个机制本身不是 Binance adapter 的 batch 拆单。
- parent fills 经 `emulator.rs:375–379` 的原生 event subscription → manager。`manager.rs:320–423` 原生计算 partial child target，`sync_oto_quantity`（785 行）生成幂等 modify action，active-local child 首次释放产生单独提交 action。
- 本地 quantity update 在 `emulator.rs:521–525` 调用原生 `update_order`；不依赖产品自制订单状态。
- 真正触发 emulated order 时，`emulator.rs:1395–1474` 生成 MARKET/LIMIT 转换；`:1486` 更新原命令；`:1543–1547` 单独送 algorithm 或 ExecutionEngine。
- Binance `futures/execution.rs:3235–3258` 接受单个 SubmitOrder → `validate_order`（3903 行起）→ `submit_order_internal`（502 行起）。`is_grouped_order` 只用于 `build_futures_order_list_batch:1525`，single validate 路径没有此拒绝。

### C. linked 字段不应清除

`emulator.rs:1426–1429` 与 `:1466–1469` 明确保留 `contingency_type`、`order_list_id`、`linked_order_ids`、`parent_order_id`。这些 native cache 关系正是 manager 后续处理 OCO/OUO 的依据。单单传输不把关系伪装为 venue 原生 OCO；无需也不应由 runner 删除关系来逃过 batch 检查。

子单从 local 转成 submitted/open 后，emulator 与 strategy manager 按 active-local ownership 分工。需要原生 `manage_contingent_orders=True` 管理已到 venue 的 siblings，而不是让 Emulator 永远接管已释放单。

## 必须保留的能力边界

| 项目 | rc7 实际能力/限制 | 对本项目的影响 |
| --- | --- | --- |
| partial fill sizing | native manager 已按累计 parent fill、持仓数量、步长、子单已成交量等计算 | 不应复制数量状态机；优先其 tests 和实现 |
| held children | Emulator 能释放 active-local children；strategy manager 不释放 non-local child | 单开 config flag 不是整套 bracket 解法 |
| 本地保护价格触发 | Emulator 支持 BID_ASK/DEFAULT quotes、LAST_PRICE trades | 当前仅 bars 的合同不够；不能把 OHLC 伪造 ticks |
| emulated LIMIT | 触发后变成 MARKET，见 emulated.md 与 emulator transform | `bracket(emulation_trigger=...)` 的共同 trigger 也作用于 LIMIT entry，可能破坏当前 LIMIT 入场/价格估值/GTD；不能当无行为变化开关 |
| mixed parent/child | 原生 routing 可处理无 emulation parent + local children；需在 native constructors/OrderList 中明确组织 | 需要最小原生联合实验，不能把全 bracket emulation 的结果当 mixed 已验证 |
| linked single orders | Binance single path 不因 linked 拒绝；linked batch path 拒绝 | “Futures 不支持 bracket”必须收窄到具体路径 |
| 已到 venue 的 STOP_MARKET 数量修改 | Futures modify 路径 `:3508–3535` 要求 price；无 price 生成 ModifyRejected | native manager 发 modify 不代表 venue stop 一定可改；不能假定 partial fill 自动完整覆盖 venue stops |
| native emulation 风险路径 | direct release 到 ExecutionEngine，不经 RiskEngine command checks；原生文档明确说明 | 不能声称此前产品的原生风险检查自动全部保留 |
| 掉线/进程退出 | held local orders 还不是 venue 保护 | 与已批准“保留 venue 保护单”的断线语义不同，须作为产品选择单列 |
| 当前 Live 准入 | `engine/live.py:541–544` 拒绝 emulation/contingencies/list/parent/linked，`:574` 拒绝 submit_order_list，`:577–584` 拒绝 modify | 现阶段不可直接用；更改是产品拒绝范围变更，不能称框架 workaround |

`require_source_config` 本身并没有全面拒绝 `manage_contingent_orders=True`，但源可提交订单被拦成无关联单；因此不能简单写成“已有配置开关被拒绝”，实际受限的是订单/命令面。若未来开放 list，应同时调查内部 native actions 是否经过产品要求的连接、归属和停止检查，而非仅在 Python 入口去掉一个 refusal。

## 优先复用的原生测试（本次只读）

- `crates/execution/src/order_manager/manager.rs::test_should_manage_order_selects_symmetric_ownership_classes`：local/non-local ownership 分工。
- `::test_handle_oto_partial_fill_resizes_once_and_submits_only_for_active_local`（2341 行）：partial resize、重复 event 幂等、只有 local manager 产生 submit；modify rejected 后 target 处理。
- `::test_handle_oto_sizes_partially_filled_child_by_leaves_quantity`（2724 行）。
- `::test_handle_oto_out_of_order_updates_reassert_latest_target`（4247 行）。
- `::test_handle_oto_parent_cancel_cancels_child_with_zero_target`（3830 行）。
- `::test_handle_event_non_active_local_manager_returns_oco_cancel_action`（1317 行）。
- `::test_handle_ouo_partial_fill_resizes_open_sibling`（4784 行）。
- `crates/trading/src/strategy/mod.rs::test_contingent_manager_dispatch_precedes_user_handlers_and_is_idempotent`（3534 行）。
- `crates/execution/src/order_emulator/emulator.rs::test_submit_order_list_handles_reentrant_order_events`（2760 行）。
- `::test_release_order_sends_transformed_command`（4468 行）。
- `::test_cancel_emulated_oco_leg_cancels_sibling`（5245 行）。
- `::test_release_gtd_stop_market_as_gtc_market_order`（4243 行）：说明真实转换语义，不能据此改当前 GTD 验收。
- `crates/execution/tests/integration/order_emulator.rs::test_modify_emulated_order_from_order_event_handler`：native event/modify reentrancy。

## 建议的下一步设计修订

撤回“先默认手写独立保护，再补 partial-fill 协议”的优先顺序。先冻结要保留的服务：LIMIT/GTD entry、venue-held protection、断线不恢复、实际归属与当前资金检查。逐项把这些要求映射到原生 manager/emulator + Binance 路径，区分以下选择：

1. 若允许本地保护并有真实 quote/trade 输入，优先 native Emulator + strategy manager；明确它改变的保护、风险路径和掉线语义，之后才提出具体授权与离线联合验证。
2. 若必须保留 venue-held STOP_MARKET，优先验证原生单单关系管理与该 adapter 修改能力；不能把本地 emulator 测试当 venue stop resizing 证明。
3. 若 native 与该 venue 的组合确实不能满足所选语义，记录具体反例后，才设计最小源业务编排（例如部分成交后撤余单的策略选择），不复制 native OTO/OCO/OUO 状态机，不让 runner 重写策略订单。

本补充证明原生机制存在和关键路由，**尚未证明目标 mixed bracket 在当前 Binance/product 组合满足全部保护要求**。这正是下一项离线实验应回答的问题；不需要升级，不需要真实连接，更不需要先修改验收标准。

## 补充：明确的原生配置候选与实验出口

`NO_TRIGGER` 在本 Python rc7 接口应使用 `emulation_trigger=None`（不靠虚构 enum）。以下为待测 native configuration，不是已经授权的产品变更，也不承诺现两份研究源码收益保持。

| 候选 | 订单与配置 | 实际 native 路由 | 主要边界 |
| --- | --- | --- | --- |
| A：本地 parent 触发，venue children | parent `emulation_trigger=LAST_PRICE` 或 `BID_ASK`；children `None`；parent OTO，children按所选OCO/OUO；`manage_contingent_orders=True` | list→Emulator；parent本地触发→ExecutionEngine直送；首个parent fill→active-local manager逐张child→RiskEngine→Binance | child可以是venue-held STOP_MARKET；但emulated LIMIT parent变MARKET，GTD市场释放变GTC，且parent绕过Risk，不符合当前LIMIT/GTD试验语义 |
| B：venue LIMIT/GTD parent，混合 children | parent LIMIT/GTD `None`；STOP_MARKET child `None`；TP child emulated以使整个list路由Emulator；显式构造原生订单关系；`manage_contingent_orders=True` | list→Emulator；parent单单→Risk→Binance；fill后STOP_MARKET单单→Risk→Binance，TP保持本地 | 更接近当前entry/venue stop要求，但TP变本地触发，需quote/trade；若TP为emulated LIMIT，释放成MARKET而非venue LIMIT |
| C：全部venue，单开manage flag | 所有trigger `None`，普通bracket/list，`manage_contingent_orders=True` | Strategy list→Risk→Binance batch builder | 仍会被linked batch检查拒绝；此flag不能替代Emulator的local child持有与释放 |

原生 `OrderFactory.bracket` 当前是一个共同的 `emulation_trigger` 参数（`crates/common/src/factories/order.rs:1143`；LIMIT entry转发在 `:1343`），不能假设有不同的 entry/sl/tp emulation 参数。Mixed候选应核实公开 native constructors 和 list组装能力，不能先删除 cache 的linked字段或临时改内部状态去拼接。

**A 的直接回答**：是，源码显示可以用本地 OTO 分发而让无 trigger 的 stop child 到 venue 托管。首次 child release 经 `manager.create_new_submit_order` 的 `SubmitToRisk`，不是 emulator价格触发的 direct-release 路径。只有parent本地触发那次直送ExecutionEngine。这个区分必须写进资金/连接检查测试。

**后续部分成交**：children 到 venue 后变 non-active-local，需要 strategy manager接手；它可以原生请求quantity update。但本版本 STOP_MARKET 没有 price 时，Binance `modify_order` 明确产生 `OrderModifyRejected`，因此 A/B 都不能仅凭manager存在就宣布后续partial fill保护完成。必须针对两次或以上parent fills建立最小 mock Binance 反例，核对新position quantity、stop当前quantity、native modify/reject事件和产品保护检查结果。若确实缺口成立，记录为该 native/venue 组合能力边界，然后再决定是否约束交易语义或提出最小额外行为。

**OCO 与 OUO**：OCO action是cancel，不需quantity modify，但一次partial exit就可能撤销另一腿；这不自动保留残余仓位的另一种保护。OUO会对open sibling做quantity modify，恰好会触到venue STOP_MARKET的能力边界。`manage_contingent_orders=True`负责已释放venue legs；本地legs由Emulatormanager负责。不能以选OCO避免modify就宣称partial-fill问题解决。

每个可行候选至少需验证：

1. 抓取native原始命令，证明父单类型/TIF/expiry、每个child路由、完整linked身份及Risk/ExecutionEngine路径；不以日志“已启动”代替。
2. parent首次partial、第二次partial、先cancel后late fill、重复fill事件与out-of-order update；child数量逐项对照nativecache/position，不自算第二账本。
3. STOP_MARKET resize拒绝、TP partial fill、双腿竞态、OCO或OUO对残仓的真实结果。
4. native内部action是否绕过Python入口检查，entry预算、停机后禁新入场、资金异步复核、归属和断线规则如何在实际命令路径保持。
5. 数据只用真实所需quote/trade类型，缺数据/断线时local与venue保护分别留下什么；原生保存/恢复不等于自动恢复策略。

设计选择应是“先证明哪组 native 配置满足正式合同”，而非“为了保留现任意禁止项，先实现自有增量保护算法”。R仍不改变任何现行为；U把产品准入变更与native联合验证列为前置。
