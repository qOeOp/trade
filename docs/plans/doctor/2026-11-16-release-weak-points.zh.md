# 2026-11-16 发布与生产运行的薄弱处

用户在 0.4.0 发布后连续遇到问题（"发个版一堆问题"）。本记录是对 `origin/main`（`6318c94dc`）发布路径与生产运行的一次只读复查，排除已有记录的 20261115-05/-06、20261116-01/-02。只诊断；修复由别的会话从本记录与索引出发去做。

| Item | Value |
|---|---|
| Sessions | 用户报告；没有研究会话证据 |
| Audit session | Claude Code（桌面端），会话 `0660267b-ae67-4c05-b258-d74244daae37`，一个只读子代理做代码阅读，关键证据由审计会话复核 |
| Checkout / ledger | `origin/main` `6318c94dc`；没有在服务器上运行任何东西 |
| Coverage | `deploy/release.py`、`deploy/release_host.py`、`deploy/compose.yaml`、`deploy/remote/`、`paper/runs.py`、`ide/agent/src/tools.ts` 的代码阅读。内存与重启两条是推断，没有在主机上测量 |
| Cost | 见各行 |
| Net change | 只提方向 |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261116-03 | 发布提交后没有东西看 Web 是否还在答：健康检查只在切换与观察的 90 秒里跑，之后每个 tick 的 `Notices.watch` 只读 Paper 恢复码与账本发布延迟，探测失败一律吞掉；概览、Agent、ledger 镜像与 market-import 的健康没人读 | `deploy/release.py` `Notices.watch`（两处 `except Exception: pass`）；`deploy/release_host.py` `health`/`observe` 只在发布与服务移动时调用；Web、Agent 没有 `HEALTHCHECK`；compose 的健康状态 Docker 不处理也没人读。20261116-02 正是这样 50 分钟无人知道 | 修缺陷：每个 tick 探测 `/api/overview/health`、`/api/agent/health`、路由到的 `/api/paper/health`，读 ledger 与 market-import 的健康、OOM 与重启次数，经现有 `Notices` 发出；Web 不答本身也是一条通知 | hours（生产部分不可用直到用户自己打开页面） | open |
| 20261116-04 | 主机上的 compose 定义与 docker-api 镜像不随版本移动，漂移没人发现 | ledger 与 market-import 从 `/opt/trade-app/deploy/compose.yaml` 重建，只换镜像（`deploy/remote/README.md`）；docker-api 只钉在该文件；两个发布 overlay 只在安装时装一次（`install-release.sh`） | 修缺陷：每个 tick 比较 `/opt/trade-app` 与活动修订的 `deploy/compose.yaml`、`deploy/remote/` 与 docker-api 摘要，不同就通知。让发布也移动 docker-api 扩大了发布会重启的范围，要用户授权 | hours（一个改了容器选项或 ledger 命令的版本会让 Paper 启动被拒或服务移动失败） | open |
| 20261116-05 | 发布要求主机可用内存 ≥ 2 GiB，Paper 准入只留 1 GiB；开着的 Paper 运行可以挡住每次发布，tick 只报 "unclassified runtime failure"；market-import 没有内存上限 | `deploy/release_host.py` `memory_available`；`paper/runs.py` 的准入余量；`deploy/release.py` `failure_summary` 的已知消息表没有这条；`deploy/compose.yaml` market-import 无 `mem_limit`。各常驻容器上限合计约 7.0 GiB，主机 7.2 GiB | 修缺陷：失败摘要认出内存不足；给 market-import 设上限。对齐两个余量改动拒绝检查，要用户授权；先在主机上测量 | hours（发布静默卡住） | open |
| 20261116-06 | 有缺陷的发布控制代码挡住自己的修复：一个 tick 先 `prepare`、`recover` 再 `handoff`，控制代码在前两步抛错时下一个版本永远到不了主机 | `deploy/release.py` tick 的调用顺序；`control.py` `hand_off` 只保留当前与前一个；README 写明没人手动装控制代码 | 文档：写明运维的手动退路。改成先交接再恢复会放宽"写事务的控制代码恢复它"这条拒绝，要用户授权 | hours（修复版本发不上去） | open |
| 20261116-07 | 提交后的回滚只能向前（revert、CI、用户打标签），手动切回旧容器没有步骤，且下一个 tick 会重新选中新的坏版本 | `deploy/remote/README.md` 回滚一节；`release_host.py` 保留三个旧容器"供运维手动回去"；`release.py` `choose` 以祖先关系重选，除非写 `failed/<sha>` | 文档：写明手动回滚步骤（停 timer、写 `failed/<sha>`、改路由、持久化 `active.json`） | hours（90 秒后才出现的回归要等几小时） | open |
| 20261116-08 | Paper runner 的内存上限依据 21 个合约 6 小时的峰值 324 MiB，运行 2 已到 522/640 MiB | `paper/runs.py` 的 `RUNNER_*` 注释；服务器 `docker stats`（2026-11-16 04:2x UTC） | 先测量运行时间更长时的内存曲线；改 `RUNNER_*` 改变 `PAPER_MEMORY_FULL` 的拒绝，要用户授权 | none（测量后：匿名内存稳定，见 Decisions） | rejected |
| 20261116-09 | Agent 每次工具调用起一个 `cli.main` 子进程，并发无上限，容器 1 GiB；与 20261116-01 同型 | `ide/agent/src/tools.ts` `runProduct`（`execFile`，无并发限制） | 修缺陷：同样限制并发 | minutes | open |
| 20261116-10 | 主机重启与 dockerd 重启从没演练过：发布创建的容器启动顺序无定义，timer 开机 30 秒就触发，Paper runner 可能没有重启策略，`live-restore` 未知 | `deploy/` 与 `docs/plans` 里没有重启的说明；`docker-api/check.go` 允许 runner 无重启策略；`trade-release.timer` | 演练一次重启并决定 `live-restore`，都要用户授权（主机重启、主机配置） | hours（推断） | open |

## Decisions

- 2026-11-16 用户："我们这发版流水线也太脆弱了 发个版一堆问题"。无需授权的 -03、-04（通知部分）、-05（摘要与上限部分）、-06/-07（文档）、-09 由修复会话去做；需授权的部分已问用户。
- 2026-11-16 用户答「都授权」，其中 -04 的后一半：发布也移动 docker-api。实现：与 ledger、market-import 同一步、同样条件（没有进行中的 Paper 操作、冻结 Paper 写入、Live 空闲），用活动版本 `deploy/compose.yaml` 钉的摘要经 `TRADE_DOCKER_API_IMAGE` 重建（不是重启），失败一起回退；检出的定义不读该变量时不动并说明。
- 2026-11-16 用户对 -05 需授权的一半：「都授权」。Paper 准入在新 run 的上限之后留给主机的可用内存从 1 GiB 改为 2 GiB，与发布启动候选前要求的可用内存读同一个常量 `RELEASE_MEMORY_MIB`（`deploy/release_host.py`）；发布的 2 GiB 门槛不变。
- 2026-11-16 用户授权 -04、-05、-06、-08、-10 的需授权部分并同意自动合并（"都授权 自动合并"）。
- 20261116-08 测量后不改上限：05:03–05:53 UTC 每 5 分钟读运行 2 的 runner cgroup（运行 1–2 小时），匿名内存 370–383 MiB 不增长，文件缓存 199 MiB（可回收），`memory.current` 587 MiB、`memory.peak` 596 MiB，`memory.events` 的 high/max/oom 全为 0。522→574 MiB 的上升是页缓存，不是泄漏；匿名内存离 640 MiB 上限约 250 MiB。以 `rejected` 关闭；运行更久后若匿名内存增长再重开。
- 2026-11-16 用户答「都授权」，其中 -06：先交接再恢复，放宽"写事务的控制代码恢复它"。实现：tick 先交接给更新的已准入控制，再准备主机、恢复；新的控制恢复旧控制留下的 Web 或 Paper 事务，只读与自己写的格式完全相同的日志（键与字符串值），否则以 `pending journal not in this control's format` 拒绝并原样留给运维，不猜。手动退路（#3130）只剩交接之前或交接本身出错的情形。

## 0.4.1 上线后补记（2026-11-17）

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261117-02 | 0.4.1 发布后把 ledger 镜像与 market-import 换到新服务镜像失败并退回，失败原因没有留下：tick 只打印 "unclassified runtime failure (RuntimeError at deploy/release_host.py:239)"，即某个 `docker` 调用的报错被摘要吞掉；退回时两个容器被重建，创建时间晚于路由的 Web，此后每个 tick 都按"运维重建过"跳过，本版本内不再重试 | 服务器 `journalctl -u trade-release.service`：11-16 15:38:39 Moving ledger、15:38:51 Moving market-import、15:42:32 失败（约 3 分钟 = `move` 里 `readers()` 的 180 秒等待），15:43:21 "service move failed and was undone"；之后每个 tick "ledger was recreated after trade-release-web-38e0c07…; it stays on …0efb93e3…"。`deploy/release.py` `report_failure` 只打印 `failure_summary`；`Release.follow` 用创建时间判断"运维重建" | 修缺陷：失败时记下哪个读取者、哪个端点、HTTP 状态（不记响应体）；退回造成的重建不算运维重建（例如以镜像是否等于目标、或退回时记下的事实判断），下一 tick 可在同样条件下再试，连续失败要有上限并通知 | hours（ledger 镜像仍是 11-11 的，生产上新研究不会自动同步；20261115-06 的修复在生产上没有生效） | open |
| 20261117-03 | 工作站的 compose 服务从不随版本移动：market-import 仍是 11-11 的镜像（修订 `f8c1fe192`），没有 11-15 的"跟进所有持有 metrics 的合约"修复，ADA/BNB/DOGE/DOT/LINK/XRP 的 metrics 停在 11-14，把市场最新日卡在 11-14，审计运行 1 的对账因此等了一天多 | 工作站 `docker inspect trade-ide-market-import-1`；`market.files.followed_metrics` 读数（六个合约 11-14，BTC/ETH/SOL 11-15）；手动 `market import-metrics --month 2026-11` 这六个之后最新日变为 11-15 | 工作站部署的升级步骤（重建 compose 服务到当前版本）要用户授权；是否让工作站也随版本移动，另议 | hours | open |

## 主机重启演练（2026-11-17）

2026-11-17 01:42 UTC 按用户 11-16 的授权打开 Docker `live-restore`（新建 `/etc/docker/daemon.json`，`systemctl reload docker`，13 个容器都没受影响），然后重启主机。01:44 主机起来，Web、Agent、Paper 控制器、Live 控制、ledger、market-import、docker-api、路由都自动起来，发版 tick 正常（20261116-10 的演练部分）。Paper 运行 2（`pa-trend-second-entry@52`）没能恢复：

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261117-04 | 不声明 Paper 恢复协议的源码，被 SIGTERM 结束时 runner 已像 STOP 一样撤单收尾，控制器却只看 `stop_reason` 当成暂停，每轮都尝试 resume 并被拒，运行停在 ended、不封存 | 运行 2 的 `inputs/strategy.py` 没有 `PAPER_RECOVERY` 与 `on_save`/`on_load`；runner 日志 11-16 04:07:19 "Paper checkpoint deferred: PAPER_RECOVERY_UNAVAILABLE: the source has not completed its recovery protocol"，22 小时没有 `recovery/current.json`；`events.jsonl` 01:42:20 `stop_requested reason=SIGTERM open_orders=2`、两单撤销、01:42:31 `summary_written stop_reason=SIGTERM`；控制器 01:44:42 "paper resume 2: … no complete native checkpoint"。`paper/serve.py` 以 SIGTERM/SIGINT 判暂停；`engine/paper.py` `pausing()` 对无协议源码为假 | 修缺陷：只有真正暂停的结束才恢复，其余照常封存（用户 2026-11-17 授权） | minutes（运行停在 ended 不封存，直到有人按 Stop） | open |
| 20261117-05 | Paper 页面从不告诉运营者一个运行不可恢复：开跑前、运行中都不显示源码没有恢复协议；结束后列表带着 `run.recovery` 拒绝码却没有组件显示，反而给出只会被拒的 Resume 按钮 | `ide/web/src` 无 `PAPER_RECOVERY` 或可恢复性的显示；`paper/serve.py` 列表带 `recovery`，`ide/web/src/lib/paperApi.ts` 有类型；`RunTile.tsx` 的主按钮 Resume | 修缺陷：结束的运行显示拒绝码并隐藏或禁用 Resume；运行中注明"中断即结束" | minutes | open |
