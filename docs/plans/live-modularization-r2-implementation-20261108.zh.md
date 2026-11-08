# R2：Live runtime 职责提取

2026-11-08 首稿，2026-11-09 在 R1（`engine.strategy`）合并后重做。保持 rc7、v7 及现有拒绝与验收协议，只搬移代码。

## 所有权

与已有的 `live_venue`、`live_cache`、`live_errors` 一样平铺在 `engine/` 下，不建子包，runtime Dockerfile 的 `COPY engine/*.py` 不变：

- `engine.live`：进程信号屏蔽（必须在导入原生网络模块前）、manifest、持久缓存上下文和 execute/finally；`python -m engine.live` 不变。
- `live_commands`：异步账户观察、唯一 pending intent、准入与原生 dispatch。原 Session 的八个命令方法改为显式传 Session；线程只返回 snapshot，原生线程最后复核，先清引用再 submit，失败停止顺序不变。
- `live_session`：运行内状态、日志、STOP/断线、保护/亏损检查、每分钟结果（#2496）与原生 cache 读取。
- `live_source`：原生配置分配、受限命令覆盖、回调与 Clock 封装。
- `live_lifecycle`：Observer 与 source_outcome。
- `live_node`：Binance/LiveNode 配置组装。
- `live_records`：私有原件写入与策略 ID。

依赖单向：`live` → 各模块 → `live_records`/`live_commands`/`live_session`；commands 对 Session 只有类型引用。`engine.live` 不再转出各模块的名字，测试从 owner 导入。动态 source 类的 `__module__` 显式保留原值（库调用为 `engine.live`，`python -m` 下为 `__main__`）。

## 等价核对

逐个比较 main（含 R1）`engine/live.py` 的 57 个函数/方法与新 owner 的 AST（把 `commands.f(session, …)` 正规化回方法调用）：54 项相同；`live_source`、`build_node`、`execute` 三项只差上述 `__module__` 参数传递。完整标准测试 1492 项通过、9 项因本机缺少固定 Caddy/OAuth2 Proxy 跳过；Ruff、Mypy 通过。

首稿（R1 之前的基线）曾用参考/候选两个运行镜像，对 Nautilus 的 Binance 协议夹具做离线联合实验：smoke、baseline、stop 两侧通过；early 两侧在实验夹具自身前置条件上同样失败，不是产品行为差异。那次针对的是旧镜像，不是本次重做后的镜像。
