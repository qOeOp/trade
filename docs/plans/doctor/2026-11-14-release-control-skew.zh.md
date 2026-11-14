# 2026-11-14 发版控制代码与版本错位：v0.3.0 主机升级失败

| Item | Value |
|---|---|
| Sessions | 无研究会话；v0.3.0 主机发布（trade-sgp-01，`trade-release.service` 日志 06:23–06:52 UTC） |
| Audit session | Claude Code desktop，claude-opus-5-5，会话 `c6ee7b85-8de9-4ef4-8eca-13f68718117e`；只读诊断子 agent 在 detached worktree（65a3c1299）对照 tag v0.2.0；[#2990](https://github.com/qOeOp/trade/pull/2990) |
| Checkout / ledger | `origin/main` 65a3c1299，对照 v0.2.0；未读写账本 |
| Coverage | `deploy/*.py`、`deploy/remote/`、`paper/release.py`、`live/` 的发布接口、`CHANGELOG.md` 与发布相关 plans；主机只读日志与目录；Live 声明在主机上不存在（`/var/lib/trade-release/live/` 无此目录）。未在页面上核实半升级期间 Paper 页的读数 |
| Cost | 实测：Web 0.3.0 与 Paper 控制器 0.2.0 并存 06:26:15–06:51:45 约 25 分钟；管理员手动换装控制代码、两次移走失败标记、改名保留的失败容器，本会话约 30 分钟；诊断子 agent 约 19 万 token、6 分钟 |
| Net change | 本记录只记发现。-18 的修复 [#2990](https://github.com/qOeOp/trade/pull/2990) 改两句消息，不增减机制；-16、-17、-19 待用户决定，提案的增减写在各行 |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261114-16 | 发布版本 N 的永远是主机上已装的 N-1 控制代码，它在运行时依赖 N 镜像的 CLI、HTTP 字段与文件格式；0.x 不保持跨版本兼容，每个改了这些接口的版本都会在主机上失败 | 用户先问新版本是否上线（来源 user，本应由 Product contracts and delivery 工作流发现）。主机 06:26:46 由 v0.2.0 控制准备 Paper 控制器 cbb6204fe，06:29:57 失败于 v0.2.0 `release_host.py:234`：v0.2.0 `paper_host.py:239-250` `compatible()` 在候选里执行 `python -m paper.release check`，[#2976](https://github.com/qOeOp/trade/pull/2976) 已从镜像删掉 `check`（main `paper/release.py:44` 只剩 `barrier`）。控制代码不随版本更新：`install-release.sh:8-10` 在已装主机上拒绝，README 要求人工安装且“timer is not a host-code execution channel”，而 tag 推送后 CI 移动 `deploy-ready`，下一 tick（≤2 分钟）就由旧控制开始发布，`CHANGELOG.md` 0.3.0 要求的“随发布重装控制代码”没有可执行的时机。同类潜在接口：`paper serve` 参数、`paper.release barrier` 协议、`live serve` argv 与 `live release-inspect` 的 JSON、IDE 入口参数、PROBE 读的 `/api/lines`、`/api/paper/runs`、`/api/about` 等字段、`deploy/live_configuration.py` 两侧精确字段集校验（v0.2.0 的 `OPERATOR_FIELDS` 含顶层 `symbols`，v0.3.0 不含，两侧不可能同时通过；本次主机无 Live 声明所以未触发）。字段改名在 `observe()` 里不报错而是放行：06:23 的 v0.2.0 控制读 `live`，v0.3.0 已改名 `readings`（52da8a635），每条运行的 `last` 都是空，Paper 进度门等于没检查 | authority（控制代码随准入版本交接：主机配置与 README 安全规则） | wrong output | open |
| 20261114-17 | 控制代码造成的失败永久封锁该版本：标记删除后，保留的同名失败候选容器让 `create()` 拒绝，唯一出口“ship a corrected version”仍由同一旧控制发布 | 回滚只 stop 候选（`paper_release.py:50`）并写 `paper-failed/<sha>`（`:62`），`apply()` 见标记静默返回（`:70`）；06:47:50 移走标记后失败于 `paper_host.py:162` “Paper release identity is retained; ship a corrected version”，Web 侧同理（`release_host.py:325-326`）；prune 永远保留最新失败容器（`release_host.py:526-528`）。管理员改名容器后 06:51:45 提交成功 | authority（放宽拒绝：删除标记即重试，重建前移除标签吻合且已退出的失败候选） | minutes | open |
| 20261114-18 | Paper 或其他 tick 级失败打印“Web release kept or rolled back”，通知说“当前 Web 与 Paper 控制器不变”，而 Web 已切换 | 主机日志 06:29:57、06:47:50；`release.py` `report_failure` 未知 phase 落到 Web 默认标签，`Notices.released` 的固定文字 | fix | wrong output | in PR [#2990](https://github.com/qOeOp/trade/pull/2990) |
| 20261114-19 | Web 与 Paper 控制器分开提交，Paper 失败后主机无限期停在 Web N 配 Paper N-1；0.x 下两者 API 不兼容（`readings`/`live`、`compare`/`reconcile`） | Web 在 `release.py:550-552` 提交，Paper 在 Web 已到同一 revision 后才动（`paper_release.py:117-120`），失败标记分开（`docs/plans/paper-continuous-delivery.zh.md:54` 有意如此）；本次持续约 25 分钟，Paper 页读数错误是推断，未在页面核实 | authority（设计：Paper 失败时 Web 是否一并回滚） | unknown | open |

写错升级步骤的文档随 -16 的修复改正：`CHANGELOG.md` 0.3.0 两处“reinstall … `install-release.sh`, as every release does”、`deploy/remote/README.md` 说控制代码经 `install-release.sh` 到达主机、`docs/plans/live-web-only-release.zh.md` “重跑 install-release.sh”、`docs/plans/runtime-release-pairing.zh.md` “下一 tick 前完成替换”。

## 不采用的方案

- CI 扣住控制接口有变化的版本：主机不回报状态，放行需要新的人工事实；接口变化多在 `paper/`、`cli/`、`ide/` 里，按 `deploy/*.py` 的 diff 判断不可靠；先装新控制会让 N 的控制去恢复、观察 N-1 的容器，是反向的同种耦合。
- 控制代码造成的失败不写标记：它与版本缺陷都表现为 `docker exec` 失败，分不开；不写标记会每 2 分钟重来一次冻结 Paper 写入与 warm，正是标记要防的循环。

## Decisions

（待用户决定 -16、-17、-19。）
