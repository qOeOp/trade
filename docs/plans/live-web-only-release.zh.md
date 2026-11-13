# Live 运行时发布只改 Web 的版本

状态：已实施（86cf3aaf7，#2471）；独立评审结论已并入本文，现行行为以 `deploy/release.py` 为准。

## 问题

2026-11-08 合并了四个 IDE 前端 PR（#2465、#2466、#2467、#2469），改动只在 `ide/web/`。CI 产出的镜像都合格，服务器却一直停在 `5c9a227`。发布服务每两分钟记一行 `Live is active or unresolved; keeping the current Web/control pair`：只要有一个 Live run 在跑，任何改动都发不出去，包括根本碰不到 Live 的改动。

## 现状：Web 与 Live control 按版本绑定

- **一对一配对**：每个 Web `trade-release-web-<sha>` 配一个同版本的 control `trade-release-live-<sha>`。Web 以只读方式挂载 `release-state/live/<sha>/socket`（`deploy/release.py:358-367`、`deploy/live_host.py:139-149`）。
- **准入按 Web 判断**：control 读 `router/active.json`。只有已提交的 Web 正是它的 `--release-web` 时，才接受新的效果；有事务时，只接受 previous 发起的维护（`live/release.py:107-120`）。STOP 和只读请求不经过这道准入，但仍要经过 socket。
- **退役按 Web 判断**：不是已提交 Web 配对的 control 会被退役，先取消自动重启，再发协作式 SIGTERM（`deploy/live_host.py:258-285`）。
- **其他按 Web sha 定位的地方**：
  - `LiveHost.prepare` 读 previous 的快照（`live_host.py:81-87`）；
  - `restore` 和 tick 的恢复（`live_host.py:172-175`、`release.py:483-484`）；
  - `_recover` 里的 `restore` 和 `barrier(candidate)`（`release.py:274-275, 297-298`）；
  - operator CLI 的授权路径 `live/authority.py:33-36`；
  - 实盘 runbook，要求从 `active.json` 读出 Web 版本，再作为 `--release-web` 传入（`deploy/remote/README.md:228-245`）。
- **由此推出**：换 Web 就是换 control，而换 control 就是把一个在跑的真实账户交给另一个进程。所以发布要先确认 Live 空闲（`barrier(idle=True)`），不空闲就整对保留。这一条是对的，本设计不放宽。

问题在于绑定得比需要的紧：如果候选版本里 control 执行的代码一行没变，新 Web 完全可以继续连旧 control，账户归属也不必变化。

## 设计

发布分两类，由"从当前 owner control 的版本到候选版本，是否改到了 control"决定：

| 类别 | 条件 | 做法 | Live 忙时 |
|---|---|---|---|
| 只换 Web | control 未受影响，且 owner 的配置与安装声明一致 | 新 Web 挂载 owner control 的 socket，然后切路由；owner、control、账户锁都不动 | 照常发布 |
| 成对发布 | control 受影响 | 和现在一样：新建同版本 control，等 Live 空闲，在账户锁内提交 | 保留现状，等空闲 |

一旦合并了改动 control 的提交，后续每个候选都要和 owner A 比较，因此全部判为成对发布。Web 发布会停下来，直到 Live 再次空闲、成对发布完成为止。

### 怎样算"control 未受影响"

control 用的 `service` 镜像执行了 `COPY . ./`，镜像里还带着 `ide/` 和 `.git/`，所以每次提交镜像都不同。runtime 那种"完整构建输入相同才沿用"的判法在这里用不上。

这里改用与 `GitSource.agent_changed`（`release.py:136-144`）同形的路径判定：只有当 `git diff --name-only <owner sha> <candidate sha>` 列出的每个路径都在白名单里，才算未受影响。白名单只收两类路径：

- **在 service 构建上下文里，但 control 不加载也不导入的**：`ide/web/`、`ide/overview/`、`ide/agent/`。这三个目录里没有 Python。`live/`、`engine/`、`cli/` 没有任何一处导入 `ide`。
- **不在 service 构建上下文里的**（见 `deploy/Dockerfile.dockerignore`）：`docs/`、`tests/`、`.agents/`、`.github/`、`deploy/remote/`、`deploy/README.md`、`deploy/compose.yaml`、顶层 `*.md`。owner 的镜像不会因为这些路径重建，所以它们改变不了 owner。

其余路径一律视为受影响，包括：

- `ide/` 下的 Python，其中有 Web 一侧的 `ide/research_graph/live_proxy.py`；
- `deploy/*.py`、`deploy/Dockerfile`、`deploy/entrypoint.sh`；
- `pyproject.toml`、`uv.lock`；
- `live/`、`engine/`、`cli/`，以及不认识的新路径。

**兼容性依据**：白名单之外一个字节都没变，所以候选的 control 代码和 Web 的 Python 代码都与 owner 那一版完全相同。新前端能调用的任何 control 接口，旧 control 里都已经有。注意，CI 并不会把 Web 和 control 配在一起跑，所以这里的依据是"代码相同"，不是"测过"。

### owner 与路由在同一次写入中提交

只换 Web 之后，已提交的 Web 是 B，owner control 仍是 A，owner 不能再从 Web 名字推出来，必须记下来。

做法：在 `route_config` 的路由对象上加 Caddy 的 `@id` 字段，值为 `live-<owner sha>`。Caddy 允许任何配置对象带 `@id`，它只影响能否通过 `/id/` 寻址，不影响路由。这样 `persist_route` 一次原子写入就同时提交了路由和 owner，不需要新的状态文件或状态机。评审对比过的备选方案是单独一个 `live/owner.json` 指针，它要多一个文件，还要规定写入顺序，所以不采用。

- **读取**：有 `@id` 就以它为准，没有就等于 Web 版本。现有路由都没有 `@id`，正好落在后一种情况。
- **写入**：`route_config(name, owner)` 的 owner 是必填参数，没有默认值；只有 owner 不等于 Web 版本时才写 `@id`，所以成对发布写出的路由和现在逐字节相同。所有写路由的地方都必须传入 owner：`release.py:308, 404, 442, 510` 和 `release_host.py:203`。`known_routes`、两次提交前检查和 `switch` 比较的是 `(name, owner)`，不再只比较 name。
- **兜底防线**：`retire` 不退役 socket 仍被已路由 Web（磁盘路由与 Caddy 已加载路由）挂载的 control，挂载关系由宿主现有的 `docker inspect` 读出。只看已路由的 Web：成对发布后旧 Web 还在运行时，它挂载的旧 control 仍应退役。万一某处写路由时漏了 owner，这一层也能保证 owner 不会被 SIGTERM，STOP 仍然可用。

### 所有按 Web sha 定位 control 的地方，改为按 owner sha

| 位置 | 改为 |
|---|---|
| `live/release.py` `_committed` 和 `admission_locked` | 已提交的 owner == 本 control 的版本，才放行 |
| `LiveHost.prepare(previous)` | 读 previous owner 的快照 |
| `LiveHost.restore`、tick 的恢复 | 确保 owner control 在运行 |
| `LiveHost.retire`、`_retired` | 不退役已提交的 owner、事务中涉及的 owner，以及 socket 仍被已路由 Web 挂载的 control |
| `live/authority.py` `path`，实盘 runbook | 从 `active.json` 读 owner 的版本作为 `--release-web`，镜像也按 owner 的版本选 |

control 的命令行参数不变：`--release-web` 仍然指它创建时配对的 Web 名字，只是比较时取其中的 sha。

### 事务

- **只换 Web 的事务**：写入 `candidate_owner` 键，值为 owner 的 sha。成对发布的事务不加这个键，字节上与现在完全一致；只有当 previous 的 owner 与 previous 的 Web 不同时，才额外写 `previous_owner`。
- **为什么要区分**：仍在运行的旧 control 只认现有的那组键（`live/release.py:96-99`），这样旧 control 遇到成对发布时不受影响。旧 control 遇到只换 Web 的事务会拒绝新效果，这是失败即关闭，属于安全方向。
- **准入**：事务存在时，如果事务前后的 owner 都是本 control，就完整放行，因为归属没有变化。否则沿用现有规则：只允许 previous 发起维护。没有这一条，只换 Web 的事务从预热到观察最长约 1800 + 90 秒（`release_host.py:104-105`），在这段时间里，正在跑的 run 无法 reconcile，也无法做其他新操作。
- **`_recover` 按事务类型分支**：
  - 只换 Web：启动 owner control，不取账户锁，也不建 `barrier`（候选没有自己的 `live/<sha>/`），然后 `persist_route(previous, owner)`，最后清除事务。
  - 成对发布：沿用现有流程。

### 只换 Web 的流程

1. 选出候选，判定为 control 未受影响。
2. 在写事务之前检查内存余量。余量不够就保留现状，不写失败标记。现在这项检查在事务之后，失败会走回滚，再被 `mark_failed` 永久挡住（`release.py:309, 362-363`）。Live runner 在跑时内存往往紧张，这种情况很可能出现。
3. 对 owner control 做健康检查，并记下它的容器 Id（`live.checked(owner)["id"]`）。
4. 写事务，内容为 candidate、previous、`candidate_owner`，以及 Agent 交接所需的现有字段。
5. 新建 Web，`live_socket` 指向 owner 的 socket 目录。如果 `agent_changed`，按现有方式交接 Agent。`ide/agent/` 在白名单里，所以这一步也必须做。之后预热、切路由、观察，都与现在相同。
6. 提交前再次核对 owner 的容器 Id 没有变，然后 `persist_route(candidate, owner)`，再清除事务。整个过程不取账户锁，也不运行 `release-inspect`。
7. 旧 Web 按现有方式退役。owner control 保留。

正在运行的 Live run 的 runner、control 进程、账户锁、凭据和 socket 都不动；切路由时，新旧 Web 连的是同一个 control。

但有一点不能忽略：Web 预热时会大量绘制研究图（`--memory 1536m --cpus 1.5`），这段时间会与真实账户的 runner 争用 CPU。内存方面，Web 设置了 `--oom-score-adj 500`，内存紧张时优先被杀的是 Web，不是 runner。CPU 没有这样的保护。上线后要观察 runner 的事件延迟，看这种争用是否需要额外限制。

## 迁移与授权

- **第一次必须成对发布**：改动涉及 `live/release.py` 和 `live/authority.py`，从 owner 比较 diff 时，这两个路径不在白名单里，所以带着这些改动的第一个版本会自动走成对发布，也就是要等一次 Live 空闲。之后才会有只换 Web 的发布。
- **宿主代码要手动安装**：`deploy/release.py`、`live_host.py`、`release_host.py` 不会自动更新，要 operator 在服务器上重跑 `install-release.sh`。这是一次主机操作，需要单独授权。
- **新旧代码共存**：
  - 旧宿主 + 新 control：兼容。路由没有 `@id` 时 owner 等于 Web。
  - 新宿主 + 旧 control：兼容。成对发布的事务字节不变。
- **不能回滚宿主代码**：路由带上 `@id` 之后，不能再把宿主代码回滚到旧版。旧版的 `retire` 会按 Web 名字退役 owner。
- **这是放宽一条发布检查**：从"Web 与 service 必须同一 revision"改为"control 未受影响时可以不同"，按 AGENTS.md 需要 operator 明确授权。
- **需要同步修改的契约**：
  - `deploy/remote/README.md:66`（"The control uses the same service revision as its Web image"）；
  - `deploy/remote/README.md:112`；
  - `deploy/remote/README.md:228-245`（runbook）；
  - `docs/plans/live-web-control.zh.md` 中"Web 与 service 的实际 OCI revision 必须相同"一句。
- **新增的存储事实**：路由上的 `@id`，以及事务的 `candidate_owner` 和 `previous_owner`。这几项要补进 `live-web-control.zh.md` 的存储字段表：
  - 使用方：准入、退役、恢复。
  - 为什么不能从已有字段推出：一旦发生过只换 Web 的发布，owner 就不再等于 Web 版本。

## 不做的事

- 不放宽空闲检查：只要 control 受影响，就只在 Live 空闲时成对切换。
- 不让 control 监听 TCP，不新增发布状态机或调度器，不改 Paper 的发布扩展。

## 验证计划

- **单元测试**：
  - 路径判定的边界：`ide/web/x`、`tests/x`、`deploy/remote/x` 判为未受影响；`ide/research_graph/live_proxy.py`、`deploy/release.py`、`uv.lock` 和新出现的未知路径判为受影响。
  - `admission_locked`：覆盖"有无 `@id` × 有无事务 × 两种事务"的放行矩阵。
  - `retire`：不退役 owner，也不退役 socket 仍被挂载的 control。
  - `_transaction`：旧 control 遇到成对发布的事务时，照常解析。
- **用假宿主驱动 `Release.apply` 和 `_recover`**：
  - Live 忙时，只换 Web 的发布能提交；成对发布返回"保留"。
  - 只换 Web 时在每一步注入失败，回滚都能完成，owner 和 owner 的容器 Id 都不变。
  - 从"Web B 加 owner A"的状态出发做成对发布，`prepare` 读的是 A 的快照，提交后 A 被退役。
  - 内存不足时保留现状，不写失败标记。
- **探针**：在一次性的 Caddy 里加载带 `@id` 的 `route_config`。确认能加载，`GET /config/` 返回的内容里有 `@id`，`live_route()` 读回一致，转发行为不变。
- **上线后核实**：在 Live run 运行期间发布一个只改 `ide/web/` 的提交。确认：
  - control 的容器 Id 不变，run 的状态不变；
  - 新 Web 能读 `/api/live`，STOP 可用；
  - 按 owner 走 runbook 时，CLI 能通过授权检查；
  - 预热期间 runner 的事件延迟没有异常。
