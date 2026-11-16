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
| 20261116-08 | Paper runner 的内存上限依据 21 个合约 6 小时的峰值 324 MiB，运行 2 已到 522/640 MiB | `paper/runs.py` 的 `RUNNER_*` 注释；服务器 `docker stats`（2026-11-16 04:2x UTC） | 先测量运行时间更长时的内存曲线；改 `RUNNER_*` 改变 `PAPER_MEMORY_FULL` 的拒绝，要用户授权 | minutes（runner 被杀后用掉一次恢复机会并留下缺口） | open |
| 20261116-09 | Agent 每次工具调用起一个 `cli.main` 子进程，并发无上限，容器 1 GiB；与 20261116-01 同型 | `ide/agent/src/tools.ts` `runProduct`（`execFile`，无并发限制） | 修缺陷：同样限制并发 | minutes | open |
| 20261116-10 | 主机重启与 dockerd 重启从没演练过：发布创建的容器启动顺序无定义，timer 开机 30 秒就触发，Paper runner 可能没有重启策略，`live-restore` 未知 | `deploy/` 与 `docs/plans` 里没有重启的说明；`docker-api/check.go` 允许 runner 无重启策略；`trade-release.timer` | 演练一次重启并决定 `live-restore`，都要用户授权（主机重启、主机配置） | hours（推断） | open |

## Decisions

- 2026-11-16 用户："我们这发版流水线也太脆弱了 发个版一堆问题"。无需授权的 -03、-04（通知部分）、-05（摘要与上限部分）、-06/-07（文档）、-09 由修复会话去做；需授权的部分已问用户。
- 2026-11-16 用户答「都授权」，其中 -04 的后一半：发布也移动 docker-api。实现：与 ledger、market-import 同一步、同样条件（没有进行中的 Paper 操作、冻结 Paper 写入、Live 空闲），用活动版本 `deploy/compose.yaml` 钉的摘要经 `TRADE_DOCKER_API_IMAGE` 重建（不是重启），失败一起回退；检出的定义不读该变量时不动并说明。
- 2026-11-16 用户对 -05 需授权的一半：「都授权」。Paper 准入在新 run 的上限之后留给主机的可用内存从 1 GiB 改为 2 GiB，与发布启动候选前要求的可用内存读同一个常量 `RELEASE_MEMORY_MIB`（`deploy/release_host.py`）；发布的 2 GiB 门槛不变。
