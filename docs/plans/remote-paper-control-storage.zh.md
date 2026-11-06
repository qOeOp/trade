# Remote Paper 控制与最小存储决定（2026-11-06）

用户已要求按远程服务器方案实施登录、启动、停止、恢复与日志；Live后接，域名为www.vibe-trading.info，预算每月500元以内。本PR只完成Paper业务控制，不更改并发上限、不迁移生产run8或活动目录。

## 独立存储评审

按AGENTS，`recovery_storage_review`在实现保存未确认启动请求前，只读审查main 3e8c768d0的paper/runs.py、ledger/paper.py及前端调用链，批准以下最小集：

| 项 | 消费者与独立事实 | 既有字段/派生是否足够 |
|---|---|---|
| 既有paper_run.op_id | 服务在超时/刷新后查回最初被接受的run | 足够；不能替换为最新同候选run，不增加SQL字段 |
| sessionStorage中的pending request_id | 浏览器刷新后关联同一次尚未确认的用户操作 | 页面内存会丢失，尚未抵达服务端的操作不能从账本派生 |
| pending candidate、scope | 查回尚无记录时重发原请求 | 仅poll才能省掉；本次需要重发。多个pending分开保存，确认结果或确定拒绝后逐项移除 |

不保存浏览器中的账户、余额、成交或运行结果；不复制HTTP body到新表。pool与explicit即便解析成同集合也无法从现记录还原原选择模式，但不妨碍同op_id返回第一次结果。仅为额外拒绝规则存请求摘要没有本次需求支持，故不添加。

已有op_id查询必须先于动态defaults、市场/runtime解析及新运行限额检查。找到声明只证明已接受，不能报成running；前端随后读取服务器实际状态。当前浏览器存储被禁用时降级为本页内存，不承诺刷新后找回未抵达服务的请求。

## 停止、恢复与日志

HTTP停止在CLI `paper stop --request-only` 原子持久化既有STOP标记后才返回202，再异步完成等待、取消与封存。控制服务重启后继续处理带STOP的活跃run；不能只在内存里记stopping，也不建立新任务队列。

恢复API直接调用现有 `paper resume`：沿用同run、同原生原件和既有限制；不放宽dirty/tail、sealed、用户STOP或限速拒绝。显式结束后的Run again是新账户，与Resume分开。

日志API先验证run归属，只接受runner/egress两个枚举，禁止页面给容器名或路径。活跃日志来自对应Docker容器，封存后来自原capture，不双存；响应最多2000行/约256KiB，UI默认300行每5秒刷新。新动态容器的Docker文本日志轮转为10MB×3；原生交易journal及checkpoint不随之删除。

## 验证与边界

本地全套841测试通过；之后追加durable STOP与控制服务重启验证，并跑聚焦模块、ruff/mypy。前端82测试、TypeScript/规则检查与build通过。最终head另经CI验证。

实际CLI + 隔离Dolt + HTTP API + main原生镜像验证：同一op_id重复启动及封存后重试均只得到原run1；SIGTERM后调用恢复API，原journal prefix不变，started=1/resumed=1；停止后正常封存，封存日志可读。临时回执在/tmp/trade-remote-paper-flow-3/result.json。此探针处于EMA等待日线阶段，不是带真实生产仓位的恢复验证；不读取/写入活动研究账本，仅只读现有market membership。测试容器正常结束，隔离服务停止，回执保留。
