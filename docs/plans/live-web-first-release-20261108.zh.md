# Live 忙时 Web 先行发布

状态：operator 于 2026-11-08 选定本方案（"Option B: Web goes first"）。已经过一轮独立评审，结论已并入正文，见文末"评审结论"。

## 问题

2026-11-08 13:15–13:18 UTC 连续合并了 #2488–#2496，其中前六个只改 `ide/web/`。最后一个 #2496 改了 `engine/live.py` 和 `live/views.py`。当时有一个 Live run（`web-c53ee…`，12:45 启动，预计运行 2 h 15 m）正在运行。结果是：服务器从 13:27 起每次检查都记一行 `Live is active or unresolved; keeping the current Web/control pair`，一直停在 #2485。

有两处设计共同造成了这个结果：

- `deploy-ready` 只登记 main 的最新提交。
- [只换 Web 的发布](live-web-only-release.zh.md) 只有在"从 owner control 的版本到候选版本，control 没有受影响"时才成立。

因此，只要 main 的头部带了一处 control 改动，Web 就得等到 Live 空闲。在它之前已经合并的纯前端改动也一起被扣住。一轮实盘可能长达 12 小时。

## 决定

Live 忙、候选又改了 control 时，先把候选的 Web 接到现有的 owner control 上发布出去。control 的更换留到 Live 空闲时，用一次成对发布补上。

前提是新 Web 能和旧 control 正确协作。这一点不再靠"代码一行没变"来推断，而是由一个显式的协议版本号来担保。

| 情形 | 条件 | 做法 |
|---|---|---|
| 只换 Web（现有） | control 未受影响 | 不变 |
| 成对发布（现有） | control 受影响，且 Live 空闲 | 不变 |
| **Web 先行（新）** | control 受影响，Live 忙，且 owner 与候选的 `live/protocol.py` `PROTOCOL` 相同 | 按只换 Web 的流程发布，Web 容器名带 `-pre` 后缀 |
| 保留现状（现有） | control 受影响，Live 忙，协议不同或缺失 | 不变：等待 Live 空闲 |
| **补配（新）** | 已提交的 Web 是 `-pre`，且 Live 空闲 | 对同一版本做一次成对发布，新 Web 用规范名 |

## 协议版本

`live/protocol.py` 里只放一个整数 `PROTOCOL`，含义是"浏览器与 Live control 之间的约定"，涉及两个方向：

- **新浏览器向旧 control 发请求**：旧 control 必须能照原样接受。请求体按精确键集校验（`configuration.fields`），所以写路由的路径或字段集一旦变化，旧 control 就会拒绝。这对 Request stop 不是"失败即关闭"，而是丢失：浏览器停不了一个仍在用真钱运行的 run。因此任何写路由路径或字段集的变化都要加一；字段名不变而语义变了（单位、含义）同样要加一。
- **新浏览器读旧 control 的应答**：新浏览器必须能显示旧 control 的应答。字段缺了，要按"该运行时较早"处理，不能报错，更不能让 Request stop 按钮消失。

任一方向破坏了约定，就把 `PROTOCOL` 加一。应答只做加法、且新浏览器能容忍缺失字段的改动（例如 #2496 的 `minute_results`），不需要加一。

**宿主如何读取**：宿主在它已经拉取的公开仓库里，先用 `git ls-tree` 确认该版本有没有这个文件，再用 `git show <sha>:live/protocol.py` 读取，按 `^PROTOCOL = ([1-9][0-9]*)$` 解析，不执行取回的代码。以下任一情况都不做 Web 先行，保留现状，并在日志里写明原因：

- 文件缺失（"undeclared"）；
- 文件在但不是恰好一行合法声明（"malformed"）；
- 两边的值不同。

Git 读取本身失败时不当作"未声明"：这次 tick 失败退出，此时还没写事务，也不写失败标记，下一次 tick 重试。

**约定测试**：不用文件指纹，而是直接检查约定本身。

- `tests/live/test_protocol.py` 为每个协议号列出浏览器发出的写请求：路径、到达的 control 动作和精确字段集，以及计划字段。测试用 `serve.write_route` 和 `control.execute` 实际核对。改了 Request stop 的字段集，这个测试就会失败（已用反向对照验证）。
- `tests/live/protocol-<N>.json` 是该协议号第一个 control 的真实 `/api/live` 应答，由本版本的 control 在测试夹具里产出。Python 测试确认今天的 control 仍然给出基线里的每一项；`ide/web/scripts/liveProtocol.test.mjs` 把基线（以及把可为空的字段置空后的版本）喂给页面真正的映射 `liveHomePresentation`，要求 run 能显示、Request stop 仍可用。

页面若开始依赖基线里没有的字段，前端测试会失败，作者要么让页面容忍缺失，要么加一并记录新基线。

## 容器名

补配要在同一版本上新建一个规范名的 Web。所以 Web 先行的 Web 使用 `trade-release-web-<sha>-pre`，共 62 个字符。Caddy 按容器名拨号，Docker DNS 的标签长度上限是 63，这个名字在上限之内。

`release_host.revision(name)` 和 `managed()` 接受带 `-pre` 的 Web 名，解析出来的版本仍是 `<sha>`，所以失败标记、镜像标签核对、路由 `@id` 都照常按 sha 工作。

control 永远只用规范名。Web 先行时既不建 control，也不检查以候选命名的 control。

## 流程

`Release.apply(target)`：

1. 用 `control_changed(owner, sha)` 判断是否只换 Web，与现在相同。
2. 如果要成对发布，并且有 owner：先在 owner 自己的 control 上做一次 `barrier(idle=True)`，问 Live 是否在忙。这一步在拉取镜像、准备候选 control 之前，所以等待补配期间每个 tick 只花一次 `release-inspect`。
   - 账户锁被占用（`AccountLockBusy`）不算忙：浏览器的列表读取等短操作会以共享方式持有这把锁，而 `release-inspect` 根本没机会运行。这时记 `A Live operation holds the account lock; keeping the current Web/control pair`，保留现状，下一个 tick 再问。
   - `release-inspect` 回答忙（`LiveBusy`）时，检查：
   - owner 存在；
   - `protocol(owner) == protocol(sha)`；
   - 候选的 `-pre` 名不等于当前 Web。

   三条都满足，就按只换 Web 的流程执行（与只换 Web 共用同一段代码），候选名为 `<sha>-pre`。流程包括：清理旧 Web、检查内存余量、对 owner 做健康检查并记下它的 Id、事务写 `candidate_owner`、挂载 owner 的 socket、提交前核对 owner 的 Id 没变。日志记 `Preparing main Web release <sha> ahead of Live control <owner>`。

   任一条不满足，记 `Live is active or unresolved; keeping the current Web/control pair`，后面附上原因（协议不同、缺失、格式不对，或已在先行），然后返回。
   - owner 回答空闲时，照常准备候选 control，再在候选上做 `barrier(idle=True)`。如果这两次询问之间 Live 变忙，保留现状，下一个 tick 会走 Web 先行。
3. 失败、回滚和 `_recover` 都走现有只换 Web 事务的分支，因为事务里有 `candidate_owner`。失败标记按 sha 写，之后同一版本不会再自动重试，包括补配。这条与现有规则一致：修正要靠新的 main 提交。

`GitSource.choose(active)`：

- 已提交的 Web 是 `-pre`，且记录的版本等于它的版本时，返回这条记录，交给 `apply` 补配。
- 其他情况与现在相同。

`apply` 遇到"当前 Web 已是该版本"时：

- 如果当前 Web 是规范名，不做任何事，与现在相同。
- 如果当前 Web 是 `-pre`，按成对发布处理，新 Web 用规范名。这时 `prepare(owner)` 读的是 owner 的快照，事务写 `previous_owner`。Live 仍忙时，第 2 步得到的 `-pre` 名就是当前 Web，于是保留现状，不重复发布。

## 不变的部分

- control 的退役和账户锁沿用只换 Web 的设计：按路由 `@id` 认定 owner，owner 不会被退役，Web 先行不取账户锁。
- control 的准入要认识 `-pre`：`live/release.py` 的 `SERVING` 接受路由上和事务里的 `-pre` Web，按其中的 sha 比较；`-pre` 路由必须带 `@id`，`-pre` 事务必须带 `candidate_owner`。control 自己的绑定（`Binding`、`--release-web`）仍只接受规范名，`LiveHost` 遇到 `-pre` 名直接报错，不会把它映射到候选的 `live/<sha>/`。这一条与 `live/protocol.py` 在同一个提交里引入：声明了协议号的 control 一定认识 `-pre`，而 Web 先行只发生在 owner 声明了协议号之后。
- 只要 control 受影响，就只在 Live 空闲时成对切换。没有任何路径会在 Live 忙时换 control。
- 不新增状态文件，不新增事务键。`-pre` 只是名字，可以从 Web 名直接看出来。

## 代价与风险

- **新浏览器配旧 control 期间**，新功能可能还不可用。例如 #2496 期间，浏览器会显示"该运行时没有分钟结果"。按约定，这是能正常显示的较早状态。
- **协议版本号仍靠作者加一**。约定测试能抓住写路由、字段集、计划字段的变化，以及页面对基线应答的依赖；抓不住的是字段名不变、语义改变（单位、含义），这一类只能靠作者和评审。
- **补配要等 Live 空闲**。如果在这之前 main 又有了新提交，补配会直接成为那个新提交的成对发布，不会出现两次切换。
- **改宿主代码需要单独授权**：要在服务器上手动安装新的 `deploy/release.py` 和 `release_host.py`，这一步需要 operator 另外点头。

## 迁移

- **第一次 Web 先行有前提**：owner 的版本里必须已经有 `live/protocol.py`。现在的 owner 是 `d235d88`，没有这个文件，所以这次改动本身要先等一次成对发布（Live 空闲时），之后才会出现 Web 先行。
- **新旧代码可以混用**：
  - 旧宿主代码不认识 `-pre` 名，但它永远不会遇到这种名字，因为只有新宿主代码才会创建。
  - 新宿主代码处理现有状态时，行为与现在相同。
- **路由带上 `-pre` 之后，不能再把宿主代码回滚到旧版**：旧版的 `revision()` 会拒绝 `-pre` 名并停下来。这是失败即关闭，不会误退役 owner。

## 验证

- **单元测试**（假宿主 `PairHost` / `PairLive`）：
  - Live 忙且协议相同时：Web 先行能提交；owner、它的 Id 和账户锁都不动；路由带 `@id`；容器名带 `-pre`。
  - Live 忙但协议不同或缺失时：保留现状，不写失败标记。
  - 从 `-pre` 状态出发，Live 空闲时补配：新 Web 用规范名；新 control 用候选版本；owner 被退役。
  - 从 `-pre` 状态出发，Live 仍忙时：不重复发布。
  - Web 先行在每一步失败时都能回滚：Web 回到原来的 Web，owner 不变。
  - `revision` 和 `managed` 接受 `-pre`，并拒绝其他后缀。
  - control 准入：路由上是 `-pre` Web 时，owner 仍可写，直到它自己的 control 补配；缺 `@id` 的 `-pre` 路由、缺 `candidate_owner` 的 `-pre` 事务、其他后缀都被拒绝。
  - 约定测试见"协议版本"。
- **上线后核实**：下一次 Live run 运行期间合并一个改 control 的提交，确认以下几点：
  - 日志出现 `ahead of Live control`；
  - control 的 Id 和 run 的状态都不变；
  - 新 Web 能读 `/api/live`，Request stop 可用；
  - run 结束后补配完成，control 换成新版本。

## 评审结论（2026-11-08，独立子代理）

- **阻断，已修**：初稿没改 control 一侧。owner control 的 `live/release.py` 只认规范 Web 名，`-pre` 路由或事务一出现，就拒绝除 STOP 外的一切新效果（包括后台 `maintain_existing` 和 operator CLI），宿主的健康检查却看不出来（`/api/live` 仍是 200，只是 `write_enabled: false`）。现在 control 认识 `-pre`，见"不变的部分"。
- **阻断，已修**：初稿把"请求字段变化被精确键拒绝"当作安全。对 Request stop 来说，被拒绝就是丢了停止能力。现在写路由的路径和字段集变化都要求加一，并有测试核对。
- **应修，已修**：初稿说"页面容忍缺失字段"，但当前代码只把少数字段标为可选，TypeScript 的可选也不在运行时检查。文件指纹绊线被换成上面的约定测试，用真实应答驱动页面映射。
- **应修，已修**：`revision()` 会剥掉 `-pre`，`LiveHost` 的目录和 control 名因此可能被误映射。`LiveHost.own` 现在拒绝 `-pre`。
- **备注，2026-11-08 后续 PR 已修**（见"流程"第 2 步和"宿主如何读取"）：
  - 协议文件读取失败曾被记成"未声明"：现在缺失、格式不对、Git 读取失败三者分开处理。
  - `-pre` 状态下每个 tick 都会重跑 `prepare` 和 `release-inspect`：现在先问 owner，忙就直接返回；等待补配期间只剩一次 `release-inspect`。同样适用于协议不同、只能等待成对发布的情形。
  - `AccountLockBusy` 曾被当作"忙"，所以空闲账户也可能走 Web 先行：现在锁被占用只保留现状，等下一个 tick。
- **更简单的备选，未采用**：沿 `deploy-ready` 的追加历史，找最新一条"control 未受影响"的记录走只换 Web。它不需要协议号和 `-pre`，但帮不了 control 改动之后才合并的前端改动；而且中间提交的镜像常被 `ide-image` 的并发取消，历史里往往没有可用记录。operator 选了本方案。
