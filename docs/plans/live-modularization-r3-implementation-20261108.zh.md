# R3：Live 宿主与共同应用操作提取

2026-11-08。独立main基线 `ed7a49756`，分支 `codex/live-modularization-r3-20261108`。按已评审Live模块化设计实施，不依赖尚未合并的R1，不修改engine或交易协议。

## 所有权

- `live.host` 持有原Docker transport、完整容器/网络身份核对、资源名称、runner/egress argv、已识别资源回收。它不新增准入政策，不决定账户是否平仓、释放或请求是否重放。Nautilus不负责网页主机的Docker/跨进程控制；本次仅迁移已有产品机制，没有替代框架交易功能。
- `live.runs` 保留manifest、冻结源码/凭据身份、原账户占用与收尾事实。公开命名既有 `prepare_locked`、`launch_locked`、`require_confirmed_locked`、`stop_locked`，供Web和带锁CLI包装调用。`maintain_locked` 明确原status的副作用；observe及CLI status保持只读。
- `live.control` 继续是应用入口。旧CLI的prepare→review→launch及confirm→launch组合移至命名operator函数；同一个Authority保持贯穿，同时保留原来各阶段的锁与再次准入。网页仍由requests.dispatch先登记意图再调用相同锁内核心。没有给旧CLI伪造request ID，没有合并或跳过既有检查，也没有改变失败发生顺序。
- inventory及测试mock一起迁到真实host owner，不保留两套Docker函数或假转发。历史格式、日志名称、凭据绑定、HTTP/CLI返回字段及发布协议不变。

## 等价核对

离线AST核对原runs的45个函数，正规化新owner/函数命名、两处纯argv函数展开及显式maintenance转发后全部一致。包括原拒绝条件、错误消息、write/effect顺序、回收和未知结果路径。核对脚本和逐函数结果在 `/tmp/trade-live-refactor-goal-20261108/check-r3-extraction.py` 与 `r3-ast-comparison.json`。该结果证明提取范围，不代替集成测试。

原CLI的分阶段锁时序特意保持：review后仍可能有部署切换，launch重新核对同一Authority；确认后root/锁被替换的原失败注入继续有效。不是将CLI包入新的大锁以便删除重核对。

## 验证进度

238项Live回归通过，涵盖请求未知/重复、凭据、authority、inventory、release、host身份、只读观察和Web控制。Ruff全仓通过，Mypy122文件通过。第一次host提取测试漏迁移一处换行mock目标导致2个error，已修复并保留 `r3-host-tests.log`；原断言未改。完整标准测试1450项通过、9项按环境跳过；第一次完整测试暴露同名paper.runs mock误迁与未跟踪新文件被打包fixture遗漏，均修复，保留失败日志 `r3-full-tests.log`；最终日志 `r3-full-tests-2.log`。随后独立审查。

未启动真实Docker容器、连接venue、读取凭据或部署。首次错误mock可能调用了只读Docker inspect/logs，修复后使用原fixtures隔离；未产生容器变更。所有Dolt测试保持隔离。R3没有engine/runtime输入变动，R1固定镜像paired验证另行推进；不冒充整个Live重构已完成。
