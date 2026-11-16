# 版本发布带上 ledger 镜像与 market-import（2026-11-16）

依据：doctor 发现 20261115-06（`docs/plans/doctor/2026-11-15-stale-ledger-after-restart.zh.md`）。服务器的版本发布
只换 Web、Agent、Live 控制与 Paper 控制器；compose 服务 `ledger`（跑 `ledger mirror`）与 `market-import` 用
`/etc/trade/remote.env` 的 `TRADE_SERVICE_IMAGE`，停在装机时（2026-11-11，`7738d62ad`）的服务镜像，所以镜像每分钟
从 DoltHub 同步（`ledger/replica.py` `keep_synced`）从没上过生产。用户 2026-11-15 决定“改，随版本更新”：版本发布
连同这两个服务换到该版本的服务镜像，只在 Paper 与 Live 空闲时；先写本记录再做。发布自动重建这两个服务的授权
就是这个决定。2026-11-16 用户对“Paper 一直有运行时镜像一直不换”答「放宽」：不等 Paper 运行结束，只等没有进行中的
Paper 操作（见空闲条件第 1 条）；写入暂停与排空、Live 空闲与持锁、所有健康检查照旧。

## 现状（读代码得出）

- `deploy/release.py` `Release.apply` 把 Web、Agent、Live 控制与 Paper 控制器作为一个事务换到版本 N；
  `deploy-ready` 的 `release.json` 已带该版本的 `service` 摘要，Paper 控制器与 Live 控制就用它建。
- `ledger` 是受保护容器（`release_host.py` `DockerHost.protected`）：事务期间它的 Id、StartedAt、OOM、重启计数
  一变，发布就失败回滚。这条检查本记录不改。
- Paper 的 runner 与 egress 在各自的内部网络上，不连 Dolt；连 Dolt 的是 Paper 控制器：列表、封存、续跑、
  start/stop 用的生命周期锁（Dolt `GET_LOCK`，连接断了锁就没了），以及页面上开的比较（最长一小时）。连接失败在
  `ledger/db.py` `connect` 变成拒绝，控制器的封存循环下一轮重试，不会退出；但一个运行在中断时结束，续跑失败会
  留下 `recovery` 代码，`Notices.watch` 会据此发一条误报。
- 封存循环每 15 秒还会重新封存“已封存但容器或运行目录还在”的运行，在生命周期锁里写库。
- Live 的运行不连 Dolt；Live 控制在准备运行时读研究账本头部，准备在账户锁里。发布已有的“Live 空闲”是
  `LiveHost.barrier(..., idle=True)`：持有账户锁，并用控制自己的镜像跑一次 `live release-inspect`。
- `paper` 库与研究镜像在 `/srv/trade/dolt`（宿主目录）与 `trade-dolt-data` 卷里，容器重建不动它们；账户密码在
  服务目录里，`ledger mirror` 每次启动重写 reader 与 controller 的 service 文件，内容不变。
- 发布单元 `trade-release.service`：`ProtectSystem=strict`、`ProtectHome=yes`、`ReadWritePaths=/var/lib/trade-release`。
  `/etc/trade/remote.env` 与 `/opt/trade-app` 对它只读；它每个 tick 已经用 `docker compose config --environment`
  读 `remote.env`（`deployment_env`），所以 compose 插件在沙箱里找得到。

## 设计

**何时换。** 只在没有发布的 tick 里（`choose` 没选出新版本），放在 `retire_live` 之后、清理之前：发布的 tick 可能
已经花了半小时预热，不再叠一次重建（单元 75 分钟上限），换镜像失败也不会让 `retire_live` 跳过。取
`deploy-ready` 的记录：它的 revision 是活动 Web 的 revision 时，用它的 `service` 摘要；不是（新版本还在等 Live
空闲）就什么也不做，等那个版本先发布。

**换哪些。** `ledger` 与 `market-import` 两个容器各自看：在运行、镜像不是目标、而且创建时间早于活动 Web 容器的，
才换。没在运行的（操作员没启动 market-import，或停了它）不碰，从不新建。创建时间晚于活动 Web 的，说明这个版本
提交以后它已经被重建过：要么是本步骤换失败后放回了旧镜像，要么是操作员自己重建的，都留到下一个版本。这样不需要
任何新的状态文件就不会每两分钟重试一次（审阅时的第一版用 `failed/<revision>` 标记，见独立审阅）。

**怎么换。** 用主机已有的 compose 定义，只换镜像：

```
TRADE_SERVICE_IMAGE=<admitted service digest> \
docker --config /var/lib/trade-release/docker --host unix:///var/run/docker.sock compose \
  --env-file /etc/trade/remote.env \
  -f /opt/trade-app/deploy/compose.yaml -f /opt/trade-app/deploy/remote/compose.yaml \
  -f /opt/trade-release/deploy/remote/cd.compose.yaml -f /opt/trade-release/deploy/remote/paper-cd.compose.yaml \
  --profile local-research-import up --detach --no-deps --timeout 60 --pull never [--wait --wait-timeout 600] <service>
```

compose 让进程环境压过 env 文件，所以摘要在重建时传入，`remote.env` 不改：发布单元写不了 `/etc/trade`，放开它
是改主机配置，要用户授权，也没必要。文件列表与 `install-release.sh` 的相同；`.github/scripts/check-remote-deploy.py`
用原生 compose 核对这一优先级。摘要先经 `DockerHost.pull` 核对（本仓库、该 revision、amd64、admitted 摘要），
所以 `--pull never`。`--timeout 60` 给 Dolt 60 秒正常停（默认 10 秒后 SIGKILL）。`ledger` 用 `--wait` 等它的健康
检查（`ledger service check --ledger research`）过，最多 600 秒；`market-import` 的健康检查看数据是否滞后，不是
镜像好坏，所以不等健康，只在 30 秒后核对它仍在运行、没重启、镜像就是目标（它的写入是临时文件加 `os.replace`，
而且 compose 本来就会在它崩溃时重启它）。都换完后，经路由的 Web 健康（含 `/api/live`）与 Paper 控制器健康要在
3 分钟内通过：ledger 自己健康不代表读者已重连。

服务的定义（命令、挂载）仍是操作员检出 `/opt/trade-app` 的，跟 `edge` 一样：一个版本改了这两个服务的定义，
仍要操作员更新检出；新镜像与旧定义合不上时健康检查不过，按失败处理。重建也会顺带应用检出与 `remote.env` 里
别的未生效改动，这与操作员自己 `compose up` 一样。不从拉取的 Git 检出读 compose 文件，因为主机从不执行拉取检出
里的部署代码。

**与 Paper 控制器切换的先后。** 在整对提交之后、下一个 tick，不在事务里：事务期间 `ledger` 是受保护容器，重建它
会让事务的身份核对失败；Web 候选的预热与观察要经 Paper 控制器读 Paper 库（运行数据推进），这时 Dolt 不能断。
每次恢复都重新取受保护快照，所以两个 tick 之间换掉 ledger 不影响后续事务。提交后再换，Web N 与 Paper 控制器 N
会先读 N-1 的镜像一小会儿（同一个 Dolt 协议；0.x 的账本格式变化本来就要新账本，不靠镜像服务迁移）。重建对读者
是一次短暂中断（Web、Agent、Paper 控制器、Live 控制），之后它们按每次连接重新读 service 文件，接着工作。

**空闲条件。**

1. 没有进行中的 Paper 操作（2026-11-16「放宽」后）：经活动 Web 读 `/api/paper/runs`（`Notices.watch` 与
   `DockerHost.lines` 已用的探测，多带出 `starting` 与每个运行的容器数）：没有正在启动的，也没有 `stopping`、
   `ended`、`unsealed` 的运行（控制器马上要停、续跑或封存它们）。在跑的运行和它们的 runner/egress 容器、已封存
   运行剩下的容器都允许。读不到当作有操作。
2. 空闲时冻结 Paper 的全部写入（Paper 路由 `all`，页面的 POST 得到 503 `PAPER_UPGRADING`），用
   `PaperHost.barrier` 取一次生命周期锁并放开，排空冻结前已放进来的 start/stop/seal，等过控制器的列表缓存
   （2 秒）后再读一次，仍空闲才继续。结束时（成功、失败或等待）`PaperHost.normalize` 解冻；进程崩溃时下一个
   tick 的 `recover` 照旧解冻。
3. Live 空闲：活动 Web 配了 Live 控制时，在 `LiveHost.barrier(活动 Web, idle=True)` 里做重建，与 `apply` 前的
   询问同一个机制；每换一个服务后调用一次 `held()`；忙或账户锁被占就打印原因，下个 tick 再问。持锁期间 Live
   不会开始准备（准备要读研究账本）。

**在跑的运行跨过重启（按代码核对，放宽的前提）。**

- runner 不连账本：`engine/paper.py` 不导入 `ledger` 或数据库驱动；runner 在自己的 `--internal` 网络上，只与
  egress 相通，到不了 `ledger`；检查点与日志写在运行目录里（`engine/paper_checkpoint.py`）。重启对它没有影响。
- 控制器在运行期间每 15 秒（`paper/serve.py` `seal_found`）读一次列表（Dolt）、给在跑的运行写新月份的成员文件
  （只读市场目录）。重启期间列表读失败变成拒绝，打印后下一轮再读。
- 在重启期间结束的运行：控制器下一轮续跑或封存它。`paper.runs.resume`、`seal`、`stop` 都先取生命周期锁（一个
  Dolt 连接），续跑在记录尝试次数（`launches.jsonl`）之前就读库，所以重启期间失败不消耗每小时的续跑次数，也不
  启动容器；封存是带 op id 的单个 Dolt 提交（`ledger/paper.py` `seal_paper_run`），先写库再删容器，重试是重放。
  这些失败都在下一轮（15 秒）重试，运行不会因此丢失。
- 唯一的可见后果：失败的那一轮把 `recovery` 代码挂在列表上，tick 结束时的 `Notices.watch` 会发一条“运行停了且
  续不上”的误报。所以换完之后（Paper 已解冻）最多再等 3 分钟，等换镜像期间新出现的 `recovery` 代码被控制器的
  下一轮清掉；仍在的是真的，照常通知，但不回退换镜像。
- 页面上正在跑的比较（`paper compare`）不在列表里，重启时会失败，可以再开一次（它是派生报告）。

**失败与回退。** 任一步失败（重建、`held()`、读者健康）：把这次碰过的服务按相反顺序重建回原来的镜像（重建前从
容器读出，`--pull missing`，`ledger` 照样等健康），然后让 tick 失败，`failure_summary` 归为
“service move failed and was undone”，Telegram 照旧发 “Release tick failed”。放回的容器比活动 Web 新，所以以后的
tick 不再自动重试，直到下一个版本；手动再换的办法写在 `deploy/remote/README.md`。放回本身失败归为
“service move and its undo failed”，交给操作员。tick 在重建中途被杀：Paper 下个 tick 解冻，账户锁随进程释放；
compose 若已建好新容器，它比活动 Web 新，不再动；若 ledger 停在缺失或停止的状态，不自动拉起（区分不了是否是
操作员停的），由操作员处理，见未解决。

已用过的旧服务镜像在 tick 结束的清理里删掉（没有容器用的服务镜像本来就删），手动退回时按摘要重新拉。

**`remote.env` 的落差。** 换过之后 `remote.env` 的 `TRADE_SERVICE_IMAGE` 仍是旧摘要。操作员以后做整项目
`compose up` 前，要先用 `python3 -m deploy.images --revision <活动 revision> --env /etc/trade/remote.env`
写上发布的摘要，否则 compose 会把 `ledger` 换回旧镜像。只重建 `edge` 等 `--no-deps` 的单个服务不受影响。

## 放弃的

- “发布不重建 ledger”这句话（`deploy/remote/README.md`、`remote-continuous-delivery.zh.md`、`cd.compose.yaml`）。
- 改写 `remote.env` 或给发布单元加可写路径：要改主机配置，传参即可。
- 把镜像换到事务里一起回滚：要么改受保护检查，要么事务等 Paper 空闲而让 Web 发布卡在 Paper 运行上。
- 用 `docker run` 绕过 compose 重建：操作员下一次 `compose up` 会把它换回去，而且丢了 compose 的标签。
- 失败标记：第一版写 `failed/<revision>`，审阅指出它改变清理对已提交版本容器的计数，也是新的主机存储状态；改用
  容器创建时间（Docker 已有的事实）。
- Docker API 代理照旧由 PR 改摘要，不随版本。

没有新增存储字段，也不改任何拒绝或审计检查：受保护容器检查照旧只管事务期间；空闲条件是用户决定的等待，不是
放宽或收紧已有检查；探测多读的两个字段是 Paper 接口已有的。主机配置（单元、`remote.env`、compose 文件内容）
不改，只改了 `cd.compose.yaml` 与 `paper-cd.compose.yaml` 的注释。

## 独立审阅

实施前由独立只读子代理（Plan）按代码审阅第一版设计（当时的空闲条件是“所有运行都已封存且没有剩下的容器”，
后被用户放宽，见开头），结论“有条件通过”，要求七项改动，均已采纳：

1. 只在没有发布的 tick 里换，放在 `retire_live` 之后、清理之前（原设计在发布提交后同一 tick 里换）。
2. 收紧 Paper 空闲：“都已封存”不等于没有写入（封存循环回收剩下的容器、正在启动的请求在取锁前就读研究账本），
   要求没有正在启动的、没有剩下容器的运行，并在列表缓存过期后再查。
3. 换完后核对经路由的 Web、Live 与 Paper 控制器健康，不只看 ledger 健康。
4. 给 `--timeout 60`，Dolt 默认 10 秒就被杀。
5. 中途崩溃时不要让标记挡住修复。
6. 失败标记沿用 `failed/<revision>` 是新含义的主机存储状态，要用户决定，且会改变清理的计数；改为不存任何状态
   （见上）。
7. 在 `failure_summary` 里给失败归类。

审阅确认：顺序（提交后、事务外）成立；沙箱里 `docker compose` 可用（`deployment_env` 已在用）；进程环境压过
env 文件；secrets 文件在 `/srv` 下可读；发布容器没有 compose 标签，不会被当成孤儿；崩溃后 `recover` 会解冻 Paper。

## 未解决

- 中途崩溃让 ledger 缺失或停止时不自动拉起；要自动修复需要能区分“发布留下的”与“操作员停的”，那要新的状态，
  要用户决定。
- 发布控制在真主机上跑 `docker compose up` 还没验证过；只有隔离测试与本机原生 `compose config` 核对。
