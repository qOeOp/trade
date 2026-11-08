# 模块化 / 单源码设计的 Nautilus 证据矩阵

2026-11-08；配套[正式设计](live-modularization-single-source-20261108.zh.md)。源码事实、已执行测试、尚待验证的建议分开记录。以下本地 native 路径均相对 `/tmp/trade-gtd-offline-origin-20261108/upstream-rc7`，该目录来自官方 tag `v2.0.0rc7`，commit `55c0e82053142bce3a5cba4de4221d3929c2d3bc`。锁文件和生产源码未为本设计修改。

## 来源与决策

| ID | rc7 文档 / 源码 / 测试 | 确认的事实 | 设计影响 |
| --- | --- | --- | --- |
| N1 | [Strategies](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/docs/concepts/strategies.md)、[Live](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/docs/concepts/live.md) | 同一Strategy源可以用于不同环境；venue、transport、timing、persistence、external activity、reconciliation仍不同 | 统一源不等于统一撮合、经济或全局FIFO |
| N2 | `crates/trading/src/python/strategy.rs`、`crates/trading/src/strategy/config.rs`；本库`test_strategy_construction.py` | 原生分配决定Rust配置，注册后才可依赖cache/clock/order_factory | 保留原生分配、公共构造参数一次转换，不另造配置系统 |
| N3 | [Binance高级订单与GTD](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/docs/integrations/binance.md)、`crates/adapters/binance/src/futures/execution.rs`的contingency判断 | USD-M linked order-list batch 路径拒绝关联单；不能由此排除原生本地 contingent/emulation 后逐单提交。Spot OCO不能推导成Futures OCO | 不在runner隐式拆 bracket；先核对原生本地管理与逐单路径、现产品入口限制及venue止损托管 |
| N4 | 上述Binance文档GTD policy；`crates/adapters/binance/tests/integration/futures/exec_client.rs::test_submit_usdm_gtd_order_encodes_expiry_over_http` | 原生USD-M GTD整秒且严格大于当前+600s；use_gtd=false需要策略本地管理 | 不升级、不切GTC、不改历史验收；复用现有timer和协议测试 |
| N5 | `crates/trading/src/strategy/mod.rs::test_handle_cancel_rejected_restores_future_gtd_timer`、`test_restored_gtd_timer_event_cancels_order`、`test_on_start_does_not_panic_when_gtd_disabled` | timer建立、撤销、恢复由原生管理 | 不实现第二套GTD scheduler；原生能力已存在 |
| N6 | `crates/adapters/binance/tests/integration/futures/exec_client.rs::test_sided_cancel_all_routes_matching_side_through_batch`、`test_sided_cancel_all_routes_algo_orders_individually`、`test_unsided_cancel_all_hits_cancel_all_endpoint` | 单撤、方向全撤、algo路由不同 | 来源检查覆盖native命令与各HTTP端点，不能用PendingCancel缺失排除全撤 |
| N7 | 同文件`test_submit_reduce_only_limit_order_respects_position_mode`、`test_submit_partial_exit_position_side_follows_reduce_only`、`test_startup_reconciliation_preserves_both_hedge_legs` | 适配器处理positionSide与reduce-only语义；Hedge账户、策略OMS不是同一维度 | 使用原生路由，不自建多空腿账户模型；不自动扩大并发支持 |
| N8 | `crates/adapters/sandbox/tests/integration/execution.rs::test_reduce_only_oto_bar_fills_preserve_child_lifecycle`、`test_client_start_restores_partially_filled_order_without_reaccept`、`test_client_start_restore_fills_only_remaining_quantity` | Sandbox已有partial fill、保护与恢复机制测试 | 先复用nativefixture，移除100ms之前测试异步顺序；不能把Sandbox组合支持当Binance支持 |
| N9 | `crates/trading/src/strategy/mod.rs::test_stop_with_manage_stop_false_cleans_up_active_exit`、`test_stop_with_manage_stop_true_defers_when_running`；Live文档post-stop生命周期 | native管理退出与运行尾部事件处理已有能力 | 原生和产品退出owner要唯一；保留已授权Observer归属退出，不混启第二owner |
| N10 | `crates/backtest/src/python/config.rs:92`、`crates/system/src/kernel.rs:435`；`test_configured_catalog_serves_builtin_quotes`、`test_request_bars_catalog_lookup_uses_bar_type_identifier`、`test_request_bars_catalog_plus_client_split` | Python `BacktestEngineConfig(catalogs=[DataCatalogConfig(...)])` 经 kernel 原生注册 Catalog；DataEngine 服务 request_bars，Python 原生 on_historical_bars 返回。无直接 register_catalog 方法不代表无入口 | 撤回 v1 新增 historical_bars 构造参数；三个模式同 request/callback，Replay 声明范围只读 Catalog；完整覆盖必须验证，缺口不得落入无 handler 的 BacktestDataClient |
| N11 | [Execution testing spec](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/docs/developer_guide/spec_exec_testing.md)；`examples/live/sandbox/exec_tester.py` | ExecTester按适配器支持能力选择用例，TC-E17/E18、E20/E21、E40–E44已有GTD/止损/取消规范 | 先原生测试，再最小产品接缝；示例真实连接不因“测试”自动授权 |
| N12 | `crates/trading/src/strategy/mod.rs::log_cmd_send`、`crates/common/src/logging/config.rs` | 策略原生发送命令在INFO，LoggerConfig支持模块/组件过滤；engine debug还受自身开关影响 | 采用原生日志；不做第二套BusTap、命令账本；Logger开到DEBUG不等于所有engine trace自动启用 |
| N13 | [Reconciliation](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/docs/concepts/execution/reconciliation.md)、本库`paper_session.py`与`test_paper_session.py` | 原生状态对账/源私有状态恢复不同；现Paper协议有timer/未终态单等边界 | 不把重连或cache恢复当source可恢复；Live只对账保持原样 |

Context7当前列出rc8/develop等版本，查询所得示例来自develop；本设计仅用其定位路径，上表再用rc7本地源码核对。官网GitHub的rc7执行规范与Binance文档本轮再次读取。未升级工具、Python包或runtime。

## 实际执行与复用范围

本轮在当前产品代码上执行，使用已安装rc7、macOS loopback-only sandbox，独立进程，无真实凭据、Docker、venue或ledger写入：

- `tests.engine.test_strategy_construction`：9项通过，包括继承分配、Paper/Live原生分配、GTD/stop配置消费者、TypeError不重试、SOURCE_REACH正反例。
- `tests.engine.test_partial_entry_protection`：4项通过，覆盖partial entry到期、同刻多层到期、入场bar碰止损、OTO子单数量与后续目标。
- 日志 `/tmp/trade-live-unification-design-20261108/construction-tests.log` 和 `protection-tests.log`。这13项是现行为依据，不是新架构实现测试。

前轮的[182项原生/产品测试](live-gtd-native-offline-diagnosis-20261108.zh.md)及[连续行情联合实验](live-gtd-continuous-joint-experiment-20261108.zh.md)复用已有结果，不重复计数。后一轮四组实际运行完成、三组自动核对通过，提前终态组停后行情断言失败仍保留；不能写成“四组验收全通过”。

上表N8所列Sandbox测试本轮只查源码，尚未执行新contract的无hold对照。N10 已有两个通过的最小原生探针，以及两个覆盖失败探针；不声称完整正式源的全部 warmup 负例已验证。GTD历史来源仍未知，不影响R模块设计。

## 本地代码锚点（产品基线1a0482263）

- `engine/load.py:240`：唯一源码加载和既有拒绝；`engine/run.py:174`：公共分配；`engine/paper.py:318`、`engine/live.py:501`：模式构造。
- `engine/paper.py:410`：100ms hold；`engine/live.py:423`起：异步entry消费与检查；`engine/live.py:646`：停止后的callback过滤。
- `live/requests.py:337`：单锁下claim→effect；`live/control.py`：Web用例；`cli/main.py:2351`起：旧CLI与web-command分派。
- `live/runs.py:737`内部维护型status、`:742`只读observe；`live/views.py`：有界安全投影，不是native账户账本。
- `ide/web/src/state/liveTrading.ts`、`lib/liveTradingCommands.ts`：读刷新、pending身份及非重试语义。
- `engine/README.md`的Native parity回放段：新CI镜像reference/candidate对照要求。新源码的信号/订单组织变化需要研究验证，不能套保持行为的结论。

新增持久字段决策：本设计不增加数据库/manifest/journal字段。运行内值对象不增加独立持久事实；已撤回 historical_bars 新参数；旧source/runtime/config/credential/request身份继续表达独立事实。如果实施发现必须增存字段，须回到独立字段审查，不能把本节当通行证。

## 本轮独立评审与原生探针补证

- `review-native-v1.md` 纠正 N10：顶层 API 探测不充分，配置是有效原生入口。`native-catalog-probe-v3.py/.log` 通过；v1/v2 请求超过 Catalog 端点，完整历史回调未完成，失败原件保留。三个脚本均在 `/tmp/trade-live-unification-design-20261108/`。
- `native-warmup-boundary-probe.py/.log` 通过：`engine.run(start=T)` 使 on_start clock 为 T；82根合成实际 bars 覆盖 `[T−81P,T−1ms]`，request 返回81根，末80根精确为 `{T−kP−1ms | k=0..79}`；history 先于两根实时15m回调。P=15m，无输入缓冲或新构造参数。只证明该原生成功路径，不代表实时缺失/超时/乱序测试已通过。
- 原生接口的检查必须覆盖配置、绑定、调用链与现有测试。一次错误配置失败、产品禁止入口或 adapter 的单条路径拒绝，不能推出框架缺能力。未经这些证据不增加自有机制。

## 关联保护能力的具体边界

详见[rc7 原生保护补充审查](live-modularization-native-protection-20261108.zh.md)。原生 `OrderManager` 已实现 OTO 缩量、OCO/OUO，`OrderEmulator` 能持有 children 并原生逐单释放，现产品禁止入口不等于框架缺机制。`crates/execution/src/order_manager/manager.rs::test_handle_oto_partial_fill_resizes_once_and_submits_only_for_active_local`、`test_handle_ouo_partial_fill_resizes_open_sibling` 与 `crates/execution/src/order_emulator/emulator.rs::test_release_order_sends_transformed_command` 是优先复用测试。

但本地触发订单的原生释放直达 ExecutionEngine，不能声称所有风险检查已覆盖；Binance `futures/execution.rs:3508–3535` 对无 price 的 STOP_MARKET modify 产生 ModifyRejected，不能宣称 native manager 自动完成全部 venue 保护。正式设计优先验证 mixed 原生候选 B，未验证前不实现自有替代，也不进入 U2。以上新增原生测试本轮只读，未执行。
