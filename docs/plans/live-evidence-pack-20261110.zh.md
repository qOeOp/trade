# Live 证据包（重排计划第 1 步，R3.1）

2026-11-10，用户批准"Approve, start step 1"。依据：`execution-paths-replan-20261110.zh.md` 的 R3.1 和第 5 节第 1 步。
这一步只记录，不改任何检查、拒绝或下单路径，所以不需要授权。

## 要解决的问题

Live 以前只记生命周期事件、订单和持仓事件、每分钟的结果和账户快照，不记它收到的行情，结束时也不导出原生报告。
所以任何一分钟 Live 都无法和同一源码的回放对照：既不知道它看到的 K 线、MARK 和资金费，也没有回放格式的订单、成交、持仓和账户记录。

## 记录什么、放在哪里

放在运行私有目录的 `out/evidence/`，和 `events.jsonl` 分开。Live 页面按 16 MB 上限整份读取 `events.jsonl`，一天 1440 根以上的 K 线不该进去。
证据包和执行记录一样，永不进账本、DoltHub 或 Git。

| 内容 | 文件 | 来源 |
| --- | --- | --- |
| 源码实际收到的 K 线 | `market.jsonl` 的 `bar`；历史请求（预热）送来的记为 `historical_bar` | 在源码数据回调的停止门之后、源码之前记录，所以停止请求之后的 K 线源码没收到，文件里也没有 |
| ~~每分钟第一个 MARK~~ | ~~`market.jsonl` 的 `mark`~~ | 已取消（20261113-120）：对照工具不读，资金费按 Binance 公布的费率结算 |
| ~~资金费结算~~ | ~~`market.jsonl` 的 `funding_settlement`~~ | 已取消（20261113-120），同上 |
| 原生订单、成交、持仓、账户报告和订单事件 | `reports-<ns>/` 下的 `orders.csv`、`fills.csv`、`positions.csv`、`account.csv`、`order_events.jsonl.gz` | 节点停止后、销毁前，从原生缓存生成 |
| ~~原生合约~~ | ~~`reports-<ns>/instruments.json`~~ | 已取消（20261113-120）：对照工具不读，合约条款见 `preflight-*.json` |
| 启动时的账户、设置、钱包、Binance 合约条款和手续费 | 已有的 `preflight-*.json`、`connected-account-*.json` | 不重复记录 |

行的形状沿用 Paper 的日志：`wall_ns`、`kind` 加字段，`bar` 与 `funding_settlement` 的字段和 Paper 相同。`bar` 多一个 `bar_type`，因为 Live 源码可以订阅不止一种 K 线。
所以第 4 步（R3.2）的共用对照工具可以用同一个读取函数读两边。

## 回放格式

回放引擎的报告方法内部调用的是 Nautilus Python 的 `ReportProvider`，持仓报告还带上持仓快照。
Live 用同一个 `ReportProvider` 从缓存生成，再经过回放同样的写出函数（新的 `engine.write_reports`，回放也改为调用它）。
原生探针确认：一次两轮开平仓的回放里，从缓存生成的四张表和 `order_events.jsonl.gz` 与回放引擎自己的输出逐字节相同；不带快照时持仓表不同。这个对照现在是单元测试。

`exposures.csv.gz` 和 `returns_series.csv` 来自回放的资金观察器，Live 没有对应物，不导出；`fill_volumes.csv` 要市场目录的 K 线，也不导出。对照时由回放一侧给出。

报告在每个 `run` 和 `reconcile` 进程结束时写一份，目录名带时间，先写到临时目录再改名。
`reconcile` 恢复同一个原生缓存，所以它的报告覆盖整个运行；进程崩溃时，下一次 `reconcile` 补上。
"每天一次"的导出留给连续运行（第 6 步）：那时运行不再结束。

## 不改变运行

- 证据写入失败不抛给源码或 Observer，每个部分（`market`、`reports`）只在 `events.jsonl` 记一次 `evidence_unavailable`，不标记失败、不触发停止、不影响 `clean_stop`。
  这一行本身写不进日志时，按已有的日志失败处理，与改动前相同。
- Observer 多订阅资金费；Paper 用同一个 Binance 数据客户端配置订阅它，已在服务器上运行。
- 报告在 Live 判定是否平仓之后才生成，生成时才加载 pandas。

## 没有记录的

报价、逐笔成交和每分钟第一个以外的 MARK 不记：当前 Live 源码不依赖它们做对照，量也大。R1 把订阅扩大到 Live 时再决定。

Nautilus 原生事件流（`StreamingConfig`）能写同样的 K 线和订单事件，但 rc7 的 Binance 节点开了它就在收尾时失败，暂不改用。探针和升级后要做的，见 `paper-trading-design.zh.md` §6.3。

## 验证

- `tests/engine/test_live_evidence.py`：原生引擎里源码收到的 K 线和历史 K 线被记录、停止后不再记录；Observer 记录每分钟第一个 MARK 和资金费结算；缓存报告与回放报告逐字节相同；写入失败只记一次且不改变运行。
- 反向对照：去掉源码记录、去掉 MARK 记录、去掉持仓快照，分别让对应测试失败。
