# GTD 完整策略、连续行情与原生 Binance 联合实验

2026-11-08。**四组联合运行已完成：在连续行情下没有复现接入层主动取消；三组自动核对通过，提前终态组的一项诊断脚本断言失败，保留失败。历史实盘取消者仍未知。**

本报告承接 `live-gtd-native-offline-diagnosis-20261108.zh.md` 的 182 项组件测试，补完整冻结策略、产品接入层、原生 Binance 客户端联合运行的缺口。没有升级 rc7、修改策略、交易检查或 GTD 验收标准。

## 运行的是什么

实际构造旧 GTD 运行的完整 `ControlledPassiveEntry`，源文件哈希保持 `c7d5867d…a2f1`；使用该运行对应的产品提交 `222243acd9f2ce9f7b64e826284d2865a2f59cc4` 的原 `build_node`、`live_source`、`Session` 和 `Observer`。

执行引擎、风险、账户和订单缓存、行情解析、定时器及 Binance 客户端都是已发布的 `nautilus_trader==2.0.0rc7`。并非简化策略或自写撮合引擎。HTTP/WS 端复用官方 rc7 的 `crates/adapters/binance/tests/integration/futures/exec_client.rs`、Axum router 和官方 JSON fixtures；仅增加测试消息输入、请求捕获与控制场景。

每组独立进程、端口和原生缓存，在 macOS loopback-only sandbox 下运行，使用假凭据及合成账户。原生真实墙钟不加速；历史请求实际返回 81 根 15m bars，源码选择相邻 80 根预热；之后按墙钟推送闭合 1m、15m、报价和 mark price。产品原账户复核与入场异步分发实际执行。

运行参数仍为 90/90/2/8100。每组只提交一次 SELL/SHORT、0.001 BTC、LIMIT 50250、GTD 入场。测试地址与假身份、稳定 50000/50001 报价、空仓 100 USDT 是合成输入，不是实盘账户观察。

## 结果

全部于 2026-11-08 08:28–08:46 UTC 实际运行，每组客户端和 fixture 最终退出码均为 0。退出码仅说明进程完成，不代替下表的证据核对。

| 场景 | 从接受到终态 | 订单 HTTP DELETE | 原生终态 / 源码结果 | 自动核对 |
| --- | ---: | ---: | --- | --- |
| 连续行情，截止后 30s 注入终态 | 808.363s | 0 | OrderExpired；source_failed=false | 通过 |
| 连续行情，截止前注入终态 | 776.973s | 0 | OrderCanceled；source_failed=false | **失败，见下文** |
| 原 STOP 文件 | 5.994s | 1 | OrderCanceled；source_failed=false | 通过 |
| 闭合 K 线停更，报价继续 | 119.747s | 1 | OrderCanceled；source_failed=true，明确记录行情停更 | 通过（检出预期故障） |

基准组声明截止 `08:45:59.000 UTC`，注入 EXPIRED 的实际时间 `08:46:29.011`。该组持续经过真实截止点及之后 30.011s，原生命令日志没有 CancelOrder/BatchCancelOrders/CancelAllOrders，HTTP 也没有任何订单取消请求。它还接收并完成一次 15m 实时快照；未出现源码连续性、保护或账户检查失败。

提前终态组实际注入时间为 `08:45:58.032 UTC`，早 968ms（10ms 轮询调度使它不恰好等于计划的 976ms）。原生保留该事件时间与 CANCELED，没有转换成 Expired，没有任何本地取消命令或 HTTP 取消请求。原生事件创建时间先于 source_shutdown，外层订单日志写入晚于 source_shutdown，复现旧实测的回调记录顺序；这说明此种顺序可以由独立终态输入产生。

两组接受时，goodTillDate 仍距当前超过 778s，保留原生 GTD 参数要求。没有缩短为几十秒、调整框架时钟或增加到期容差。

STOP 组完成：产品观察原 STOP 文件，原生策略发送 `CancelOrder`，模拟端捕获一次匹配 client/venue order ID 的 `DELETE /fapi/v1/order`，收到 CANCELED 后退出。无 source finding。

行情停更组完成：入场后停止闭合 K 线但继续报价；源码在最后 minute close 后 120 秒触发 `live minute stream stalled`，原生取消命令和一次 HTTP DELETE 都被捕获。最终 native flat，但 source_failed/failed 保持 true、source finding 保留。**故障注入按预期被检测，不把失败运行改记为正常通过。**

## 保留的自动核对失败

`verify_joint.py:51` 原样要求 `source.last_live_minute == fixture最后一根1m的close`。提前终态组终态后正常停机仍有约 5 秒 post-stop delay：

- `08:45:58.033398` 产品开始停止；策略最后处理的 minute close 为 `08:44:59.999`。
- `08:46:00.044` fixture 仍在连接上发送下一根，close 为 `08:45:59.999`。
- 原 `live_source` 对行情回调先检查 `observe_stop_intent()`，停止后不再调用源策略。因此最后这根不进入源码状态。

诊断断言混合了停止前的行情处理要求和停止后的 fixture 输出。原始联合核对 stderr 与脚本均保留，**没有修改断言、过滤原始输入后重跑为通过，或将该组记入自动通过数**。单独提取的 `early-boundary-observations.json` 是时间与请求事实，不是替代验收判决。

该问题不改变“本地取消请求为零”的两处直接记录，也不改变旧实盘 GTD 判据。若后续修订这条离线核对，需按仓库检查变更流程单独处理；本报告不依赖修订才能得出有限的取消路径结论。

## 如何交叉核对

一次性离线断言读取四类材料：模拟协议端全部 HTTP 请求及注入时间、原生 DEBUG 命令/事件日志、产品 events.jsonl、运行结束后原生 cache 的订单事件和源码诊断。

核对完整源文件哈希、管理 GTD 关闭、单一入场、接受到声明截止超过 600 秒、GTD 值一致、原生事件身份与时间、取消路径、闭合 K 线相邻性、source finding 和各进程正常结束。监听流正常关闭的 DELETE listenKey 单独识别，不混同订单取消。没有用“无 PendingCancel”单独判定无取消。

原生 INFO 日志已提供策略发送命令，DEBUG 提供额外运行轨迹。原产品固定 WARNING 会漏掉 INFO；这次通过测试配置启用原生输出，未编写新的生产追踪器。后续若安排新的真实取证，应优先保留该原生日志，再讨论跨进程或交易所侧来源证据。

## 当前能收敛的判断

1. 完整冻结类在正常相邻行情、跨 15m 边界、真实 GTD 截止及截止后窗口，没有自动取消；没有得到需要升级 rc7 或修补交易逻辑的证据。
2. 产品 STOP 和源码行情停更都能产生实际原生取消，并留下不同于独立终态输入的命令、请求和原因记录。旧实测保留的 source_findings 为零，没有行情停更原因；但这些离线对照不能穷尽真实环境的所有故障或外部进程。
3. 取消回报后的 source_shutdown 可以是结果，不能凭外层日志的写入顺序反推它发起取消。历史记录缺失出站命令/请求证据，无法由本次合成实验补回。
4. 下一步若进行真实取证，优先使用已验证的 rc7 原生 INFO 命令日志；本轮未改生产日志配置，也没有启动新实盘、读取真实凭据或连接交易所。旧实盘仍未通过 GTD 自然到期验收。

## 解释边界

- 这是完整冻结 GTD 类的**未成交取消路径**实验；不代替两策略成交、保护单和平仓的验收，也不验证自然信号与收益。
- 本地使用 published rc7 的 Darwin wheel；不是原 Linux OCI 镜像的部署/平台等价证明。生产函数未改，但未覆盖 Docker 宿主、真实代理和 Redis 持久化故障。
- cache 仍是 Nautilus 原生内存 cache，未装 Redis。未调用管理真实凭据/宿主进程的 `execute()` 外壳；实际运行了构造节点后的产品 Session、Observer 和源代码包装。
- 实验 universe 扩为全时段。已单独核实所有实验开始至后一小时均在原 universe 的有效区间内，这个字节差异没有改变本次 `eligible` 结果。
- 合成提前 CANCELED 只验证因果与映射，不能证明 Binance 的真实取消由谁发起。旧实盘的 `venue_time_precedes_deadline`、`canceled_is_not_established_gtd_expiry` 两项失败保持不变。

## 原件与复现

工作目录 `/tmp/trade-gtd-joint-20261108`：`EXPERIMENT.md`、`experiment-inputs.json`、`eligibility-and-platform.json`、`joint_fixture.rs`、`run_joint.py`、`operate.py`、`verify_joint.py` 以及各组 server/client 日志、产品原生事件、cache 导出、进程回执。源代码正文和执行原件均留在 `/tmp`，不进入 Git。

baseline-v1/v2 复制了生产 Docker 专用代理，原生客户端连接超时，没有进入策略。失败记录保留；v3 仅将离线测试的代理改为空并开启原生日志。所有子进程走自己的正常退出流程，没有终止其他会话进程。

三组自动核对结果见 `verified-baseline-stop-gap.json`；完整执行失败见 `verify-all.stdout` / `verify-all.stderr`。所有组保留启动时原生 `incomplete bounded reconciliation reports` 警告；未出现运行期 ERROR。该警告未被删除或作为已解决的问题报告。
