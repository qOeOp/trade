# GTD 取消路径：rc7 原生离线诊断结果

2026-11-08。**182 项离线测试通过；取消的框架路径已得到机制证据，历史订单的取消发起者仍未知。**
没有升级依赖、修改交易逻辑、修改 GTD 验收标准或连接真实交易所。本报告不把离线通过改记为实盘通过。

## 先复用框架，停止扩展取证设施

按用户纠正，先查社区讨论、官方执行测试规范和锁定版本已有测试。发现并实际复用了：

- 官方 [rc7 执行测试规范](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/docs/developer_guide/spec_exec_testing.md)
  中的 ExecTester、TC-E17（GTD 接受）和 TC-E18（到期）。规范要求尊重适配器已记录的终态映射；
  它不是把任意 CANCELED 直接判成 GTD 到期的依据。没有运行会连接交易所的示例脚本。
- 官方 [rc7 测试指南](https://github.com/nautechsystems/nautilus_trader/blob/v2.0.0rc7/docs/developer_guide/testing.md)
  要求关注进程全局/线程局部状态隔离。本次每个 Rust 用例单独进程运行，未把整套 libtest 混在一个进程。
- 社区 [#4974](https://github.com/nautechsystems/nautilus_trader/pull/4974) 讨论了撤单拒绝后恢复 GTD timer，
  包括接受与拒绝交错的情况。相关实现及正反例已在 rc7；管理关闭、停止和未接受订单都有现成测试。
  这不是本轮“无已知撤单拒绝、管理关闭、提前终态”的已知根因。
- Binance Futures 上游集成测试已有 Axum HTTP/WS server、请求捕获、回报注入器；
  沿用这些设施，没有新写 HTTP/WS 协议栈，也没有建立 BusTap 框架或自定义生产日志通道。

Context7 和搜索返回的 develop 资料只作入口；最终用 rc7 tag 的文档及源码核对行为。

## 实际版本、构建和隔离

- upstream tag `v2.0.0rc7` 解引用 commit：`55c0e82053142bce3a5cba4de4221d3929c2d3bc`。
- 在 `/tmp/trade-gtd-offline-origin-20261108/upstream-rc7` 展开本机已有官方 Git 对象。
  2,269 个共同的原生 `src/**/*.rs` 文件与此前核对的 rc7 发布源码逐字节相同。
  对新增测试 include 的 Strategy 文件，用保留的未改原件参与对照。
- 使用本机已有 `rustc 1.99.0-nightly (7608eb7b0 2026-08-05)`；没有安装或切换系统工具链。
  `cargo +nightly ... --locked` 构建，官方完整源码的 Cargo.lock 未改变。
  只构建临时测试二进制，没有构建、安装或发布新的 Python wheel/runtime。
- Cargo home 使用临时目录和已有 registry 缓存；依赖解析可访问公开包仓库。
  测试执行则由 macOS sandbox 限制为 loopback；清空继承环境，只传最小 PATH 等测试变量。
  测试凭据来自上游假数据，未读真实凭据、`.env` 或 Live 私有目录。
- 首个网络隔离控制没达到要求：允许规则过宽，保留失败，未运行原生连接测试。
  修订为分别限制 outbound、inbound、bind 后，本地连接成功，非 loopback 测试地址
  `192.0.2.1:443` 由 OS 返回 EPERM。随后全部原生协议测试都在此 profile 内运行。
  这个控制不是交易所连接，也不修改主机网络配置。

Python 产品测试使用运行镜像对应提交 `222243acd9f2ce9f7b64e826284d2865a2f59cc4` 的独立展开目录，
解释器使用现有 published rc7。所有 fixture 数据在临时目录；不接触活动 ledger。

## 测试结果与含义

| 分组 | 数量 | 实际验证 |
| --- | ---: | --- |
| 未修改的上游 Binance 集成用例 | 16 | HTTP GTD 单单/批量参数，单撤拒绝，含糊失败，批撤归属，方向过滤，全撤及 algo 路由 |
| 未修改的上游 Binance 单元用例 | 17 | GTD 合法性/本地管理映射，WS/REST 的 EXPIRED 映射开关 |
| 未修改的上游 Strategy 单元用例 | 41 | GTD timer 生命周期、撤单拒绝恢复、已停止/管理关闭反例、批撤 PendingCancel 等 |
| 复用上游 fixture 的新增原生对照 | 8 | 2 个计时器对照、6 个 HTTP/WS 来源及时间对照 |
| 冻结产品现有 Live 测试 | 100 | `test_live_connection`、`test_live_entry`、`test_live`，包含真实原生回测组件及 mock 边界 |
| 合计 | **182** | **全部通过；各层证据分开解释** |

产品的 100 项测试不是 100 次真实账户运行，也不是完整 LiveNode+Binance 全链路验收。
原生计时器测试使用 VirtualClock；没有把模拟时钟结果冒充真实墙钟或交易所行为。

### 1. 本地 GTD 管理的作用边界

新增测试直接复用上游 Strategy、VirtualClock 和 typed command saving handler。
在截止前 976ms、截止前 1ns、截止点推进时钟：

- `manage_gtd_expiry=false`：不建立 GTD timer，三个时点均没有取消命令。
- `manage_gtd_expiry=true`：截止前不取消，截止点产生一次关联该订单的 `CancelOrder`。

这与冻结实测源码构造探测得到的管理关闭配置一致，不支持“原生本地 GTD timer 提前取消”的猜测。
仍不是历史运行内存快照，也不排除策略其他主动取消入口。

### 2. HTTP 取消和终态回报是两件事

使用原生 Binance Futures 客户端、假双向账户、`use_position_ids=false`、HTTP 交易路由：

- 明确调用一次单撤：模拟 HTTP 端实际收到一次 `DELETE /fapi/v1/order`。
  注入用户流终态前没有 Canceled/Expired 事件；注入 CANCELED 后才产生 `OrderCanceled`。
- 完全不调用取消：模拟端分别注入截止前 976ms、截止点、截止后 1s 的 CANCELED。
  三种情况都产生 `OrderCanceled`，没有任何交易 DELETE 请求。
- 完全不调用取消：分别注入截止前 976ms、截止点的 EXPIRED。
  两种情况都保留 `OrderExpired`，没有交易 DELETE 请求。

上述提前回报是明确的故障/协议输入，不代表真实交易所允许提前到期。
测试说明适配器按回报状态和时间生成原生事件，并不自行把“靠近截止的取消”改称到期。
事件时间也保持注入值，未增加容差。

因此，同样的 `OrderCanceled` 既可能跟在本地取消请求后，也可能由独立用户流回报直接产生。
**仅凭 native cache 终态、时间接近截止或 PendingCancel 缺失，不能归属取消者。**

### 3. 全撤和传输失败不能用单撤模型解释

现成测试确认按方向全撤会分解到批撤，algo 单走对应端点，空缓存的有方向全撤不发请求。
策略归属由原生命令/回报保留。明确 venue 拒绝与含糊传输失败输出不同；后者不会伪造 CancelRejected。
这说明框架已有这些处理，产品应复用，不需要另写撤单账本或重试引擎。

## 对当前问题的判断

目前没有发现需要通过升级或交易逻辑补丁解决的原生取消路径缺陷。
历史轮次中，已记录的 `source_shutdown` 是取消回报后的收尾；原生 GTD 管理关闭。
但是历史没有保存完整的出站取消命令/请求证据，所以不能从本轮测试倒推出具体发起者。

GTD 原有 `venue_time_precedes_deadline` 和 `canceled_is_not_established_gtd_expiry` 两项失败保留。
取消来源未知也不等于 Binance 有缺陷。用户、其他进程/凭据、账户自动全撤和未记录的本地入口
仍不能仅靠这些历史原件完全排除。

原设计的 A 阶段已有原生路径证据；B 阶段完成 timer 对照和冻结产品现有测试。
**尚未执行完整冻结策略的连续行情、真实墙钟 >600 秒、LiveNode+mock Binance 联合实验。**
不把本报告的组件组合推导写成该实验已经通过。
下一次若继续扩大复现，应只补这一特定集成缺口，使用现成 upstream fixture/ExecTester 接缝；
新的真实轮次仍须具备比旧轮更多的取消来源观察能力，不能原样重跑期待偶然通过。

## 保留的失败与复现入口

所有材料在 工作目录 `/tmp/trade-gtd-offline-origin-20261108`（本机临时目录，不入库）。

- `upstream-build.log`：直接使用 sdist 补全目录构建时锁文件不匹配，停止；没有移除 `--locked`。
  改用完整官方 tag 后，同一版本 `upstream-full-build.log` 构建成功。
- `diagnostic-build.log`：额外测试 include 路径按源文件目录解析失败。
  `diagnostic_adapter_cases_v2.rs` 改用 `CARGO_MANIFEST_DIR` 定位同一官方 fixture；断言及交易逻辑未变。
  v1 和失败日志保留。
- `integration-results/results.json`、`binance-results/results.json`、`trading-results/results.json`：
  74 项现成测试逐项结果与独立 stdout/stderr。
- `diagnostic-results/results.json`、`adapter-diagnostic-results/results.json`：8 项新增对照及原生输出。
- `product-tests.log`：冻结产品 100 项测试原始结果。
- `run_selected.py`：枚举测试后按 exact name 每进程运行；同时要求退出码 0 与实际运行 1 项通过，
  防止错误 filter 导致“0 项通过”。
- `source-comparison.json`、`evidence-index.json`：源码比较、结果计数及文件哈希。

测试临时副本仅增加两个 `include!`：一个在原生 Strategy 的 `cfg(test)` 模块，另一个在 integration
测试模块。生产函数、发布依赖、产品源码、验收工具、历史记录和账户设置均未修改。
