# IDE 改读 compose 里的 ledger 服务、去掉自己的副本：方案（2026-10-30）

本文只讲方案，不含代码。它接的是 `ledger-compose-service.zh.md` §7 留下的那一项：「IDE 改读 compose 里的账本（去掉它自己的
副本和 `DOLT_PULL`）：值得做，但改的是 IDE 的数据来源，另行设计。」§6 的授权点经用户确认后，按 §7 分 PR 实现。

用户 2026-10-30 定的约束有三条：

- IDE 只拿只读账户；
- IDE 碰不到写入；
- 旧卷先留着，不删。

初稿经过一个独立子代理对照代码复核。它指出的问题都已改进正文，其中最重要的一条已经实测成立：`ledger sql` 的开头词检查可以被
MySQL 可执行注释绕过（§3.2）。这条缺陷不修，就不能切换。

## 1. 现在的样子和问题

本机现在有三份账本和市场库：

| 位置 | 内容 | 大小 | 谁写 |
| --- | --- | --- | --- |
| `trade-ide_trade-dolt-data` 卷（ledger 服务） | 活动的 `research` 和 `market` | 66.65 GB | 命令行，经 writer 账户和 root |
| `$TRADE_DATA/dolt-backups` | 两个库的 `dolt_backup` | 约 60 GB | root（`ledger backup` 和 `market review` 要用它） |
| `trade-ide_trade-ide-data` 卷的 `/data/dolt`（IDE） | 从 DoltHub 克隆来的副本 | 约 56 GB | IDE 自己的 root（`trade-ide-pull`） |

前两份各有用处，一份是活动库，一份是灾备。第三份只是为了让 IDE 能读，它保存的东西别处都有，却带来这些成本：

- **磁盘**：多占约 56 GB。
- **一条多余的同步链路**：
  - IDE 每 5 秒先跑一次 `trade-ide-pull ledger`；新 head 指向它还没有的市场提交时，再拉一次市场
    （`services/ide/research_graph/serve.py:251`、`:262`）。
  - 拉取失败，页面显示 `PULL_FAILED`。
  - 远端历史被改写，页面显示 `REMOTE_REWRITTEN`，要人手跑 `trade-ide-pull repair-market` 才能恢复。
- **页面落后**：一次写入要先发布到 DoltHub，再被 IDE 拉下来，页面才看得到。
- **多一个服务进程**：IDE 容器里有一个独立的 `dolt sql-server`，还有它自己的管理员密码（`services/ide/docker/entrypoint.sh`）。

## 2. 目标

- IDE 不再有自己的 Dolt 服务和数据副本。研究图谱和对话工具都直接读 compose 里的 `ledger` 服务。
- IDE 容器里只有两个 reader 账户：`research` 的和 `market` 的。它看不到 root 密码、writer 账户、DoltHub 密钥，也看不到旧副本的
  管理员密码，所以手里没有任何写入或发布的凭据。
  - Paper 面板照旧把 `/api/paper/` 转发给 paper 守护进程，由 paper 自己的账户去写它的记录。这条路径今天就有，本方案不改。
- 旧卷 `trade-ide_trade-ide-data` 原样保留：
  - 新 IDE 只挂载卷里的 `agent` 子目录，也就是对话代理的 API key 和对话记录，照常使用；
  - 卷里的 `/data/dolt` 和 `/data/ledgers`，新 IDE 看不见，也不读、不写、不删。
- 不改账本的结构，不加存储字段，不动 ledger 的数据和其他服务。

## 3. 只读账户到底能做什么（实测）

以下都在一次性容器里实测，没有碰活动服务：

- 镜像 `trade-service:main`，Dolt 2.4.2，`--network none`；
- 服务像 `_secure` 那样加固过：删掉通配的 `dolt_branch_control` 行；
- reader 账户只有 `GRANT SELECT ON db.*`。

### 3.1 数据和 Dolt 过程：写不进

- **能执行的**：`SELECT`、`AS OF`、读 `dolt_log`。
- **全部被拒**（command denied）：
  - 写数据和改表：`INSERT`、`UPDATE`、`DELETE`、`CREATE`/`DROP TABLE`。
  - Dolt 过程：`DOLT_COMMIT`、`DOLT_BRANCH`、`DOLT_CHECKOUT -b`、`DOLT_TAG`、`DOLT_RESET --hard`、`DOLT_REMOTE add`、
    `DOLT_BACKUP add`、`DOLT_GC`。
  - 权限和库：写 `dolt_branch_control`、`CREATE USER`、`GRANT`、`CREATE DATABASE`。

  这些尝试之后，表的行数、head、分支和标签都没变。

### 3.2 服务级变量：能改，而且 `ledger sql` 挡不住

reader 能执行 `SET PERSIST` 和 `SET GLOBAL`。改动对管理员会话和之后新建的会话都生效。实测改成功的变量有：

- `dolt_commit_verification_groups = ''`
- `max_connections = 1`
- `read_only = 1`
- `dolt_transaction_commit = 1`

命令行 `ledger sql` 本来是要挡住这一点的（`cli/main.py:48`–`53` 的注释）。它只接受以 `SELECT`、`SHOW`、`DESCRIBE`、`DESC`、
`EXPLAIN`、`WITH`、`TABLE`、`VALUES` 开头、正文里没有 `;` 的语句（`cli/main.py:305`–`317`）。但这个检查先删掉所有
`/* … */` 注释再看开头的词，而 Dolt 会执行 `/*! … */` 里的内容。实测下面四条语句都通过了检查，并且被 Dolt 执行了：

```sql
/*!SET PERSIST max_connections = */ (SELECT 7)
/*!SET GLOBAL dolt_commit_verification_groups = */ (SELECT '')
/*!80000 SET GLOBAL read_only = */ (SELECT 1)
SELECT 1 /*!, (SELECT 2) */
```

执行之后，`max_connections` 变成了 7，验证组被清空，`read_only` 变成了 1。

**今天的影响**

- 宿主机上的 Agent 经 `ledger sql` 就能改活动服务的全局变量。
- IDE 的对话工具 `ledger_sql`（`services/ide/agent/src/tools.ts:53`）同样能做到，只是现在改的是 IDE 自己的副本。

**本方案的影响**：改完之后，IDE 里的模型就能借这条路改活动服务。所以这个缺陷必须先修（§7 的 PR 0）：

- 可执行注释 `/*!` 和优化器提示 `/*+` 一律拒绝；
- 或者换成解析器判断，不再只看第一个词。

两种做法都是收紧拒绝检查，需要用户授权（§6 第 1 条）。

### 3.3 验证组被关掉以后：不会悄悄放行，但有两处缺口

**已有的防护**：每次连接都会读 `@@GLOBAL` 上的验证组，只要它不是 `commit`，就以 `COMMIT_CHECKS_DISABLED` 拒绝。

- 账本的检查在 `ledger/db.py:676`（`connect` 调 `require_commit_checks`），对 reader 连接也生效。所以验证组一旦被改，研究图谱、
  paper 的读取和健康检查 `ledger service check` 都会一起失败，容器变成 unhealthy。
- `ledger service run` 每次启动时也查一遍（`cli/service.py:252`）。

**缺口一：市场导入。** 市场导入只在开始时查一次，到提交之间隔着整个导入过程，可能长达数小时：

| 导入 | 检查 | 提交 |
| --- | --- | --- |
| 日线 | `market/store.py:599` | `:744` |
| 报价 | `market/store.py:965` | `:1041` |
| aggTrades | `market/aggtrades.py:222` | `:266` |

这段时间里有人关掉验证组，这次导入就会在不跑提交测试的情况下提交。修法是在 `_commit` 前再查一次（§7 的 PR 1，需授权，§6 第 2 条）。

**缺口二：root 的提交路径。** `upgrade`、`init`，以及显式传 `--skip-verification` 的路径，本来就不走这项检查（`ledger/db.py:468`、
`:544`、`:917`、`:950`）。这些是管理员操作，不在本方案范围内，只在此记下。

### 3.4 修好之后还剩什么

拿着 reader 密码直连服务的人，仍然可以通过改全局变量让活动服务拒绝服务。所以 IDE 容器里能接触到 reader 密码的代码，只能是产品
命令行：

- 对话工具只经命令行执行，参数先校验，不经过 shell（`tools.ts:1`–`5`、`:80`）；
- 研究图谱服务也只调命令行；
- 本方案不给 IDE 加任何直连 SQL 的入口，以后谁要加，得重新评估这一节。

另外两件和本方案无关的事，单独提议：

- paper 和 market-supply 把整个 `${TRADE_DATA}/dolt` 以只读方式挂了进去，里面的 `service.json` 含 root 密码和 writer 账户
  （`services/ide/docker/compose.yaml` 中这两个服务的 `volumes`）。market-supply 只读，可以改用本方案的 reader 文件；paper 要写
  记录，需要另外设计。
- 除验证组外，其他服务级变量（`read_only`、`max_connections`、`dolt_transaction_commit`）被任何账户改掉都没有人发现。

## 4. 方案

### 4.1 ledger 服务另写一份只含 reader 的服务文件

`service.json` 里有 root 密码和 writer 账户，不能交给 IDE。所以 `ledger service run` 另写一份只含 reader 的
`<readers>/service.json`：

```json
{"port": 13330, "databases": {"research": {"reader": {"user": "…", "password": "…"}},
                              "market": {"reader": {"user": "…", "password": "…"}}}}
```

**文件名必须是 `service.json`**，因为 `_service` 读的是 `<service>/service.json`（`ledger/db.py:135`）。配置文件里的 `service` 指向
这个目录。

**什么时候写**：每次启动都写，在开始服务之前。两条启动路径都要覆盖：一是已有 `service.json` 时，在检查之后写；二是第一次自举时，
在 `bootstrap` 返回之前写（自举路径不经过 `_check_service`，见 `cli/service.py:280`）。写入用 `_private_write`，原子替换，权限 0600。

**内容**：全部从 `service.json` 推导，不是新数据，也不进账本。

**为什么够用**（复核时已逐一核对调用方）：

- 文件里没有 `socket`，`managed()` 为真。连接走 `service_connection` 的 `TRADE_DOLT_HOST` 分支，经 TCP 连到 `ledger:13330`
  （`ledger/db.py:190`–`211`）。
- `connect`（`ledger/db.py:640`–`682`）、`read_as_of` 和 `store.connect`（`market/store.py:183`–`217`）只取对应角色的账户，不需要
  `binary`、`socket`、`secured` 或备份字段。
- 对话工具的全部命令，加上研究图谱用的 `line list`、`research graph` 和 `ledger sql`，都只用 reader 连接。
- writer 连接会以 `LEDGER_UNKNOWN` 拒绝（`ledger/db.py:651`–`653`）。
- root 路径（`admin._admin`、`publish._admin`、`paper delete`）读 `root_password` 时会以 `KeyError` 失败
  （`ledger/admin.py:63`、`ledger/publish.py:48`、`ledger/paper.py:321`）。失败的形式不是一个拒绝，但结果安全，§8 按这个结果验收。

**放在哪里**：写到命名卷 `trade-ledger-readers`。ledger 以读写方式挂在 `/var/lib/trade-readers`，ide 以只读方式挂在
`/run/trade/ledger-readers`。不用宿主机目录，原因是：

- compose 会先建好所有容器，再按依赖顺序启动（paper 那段注释写过）；
- 如果宿主机目录这时还不存在，Linux 上的 Docker 会以 root 身份建它，以 `TRADE_UID` 运行的 ledger 就写不进去；
- 命名卷第一次挂载时，会复制镜像里同一路径的内容和权限。所以 service 镜像要像 `/var/lib/trade-dolt` 那样，先把
  `/var/lib/trade-readers` 建好并设成 1777（`services/ide/docker/Dockerfile:45`）。

**参数**：ledger 新增 `--readers=/var/lib/trade-readers`。不传就不写，宿主机上的用法不变。

**为什么必须是产品代码**：这是一条信任边界（AGENTS.md「Code or Agent」）。哪些密码进 IDE 容器，要由写 `service.json` 的那个进程
决定。如果让 IDE 的启动脚本自己去筛 `service.json`，IDE 就得先拿到完整的文件。

另一种做法是给 IDE 单独建一个 reader 账户，好处是能单独吊销。没有选它，因为它要改自举流程和账户的生命周期，而现有的 reader
已经足够只读。

### 4.2 IDE 的 compose、配置文件和启动脚本

compose 里 ide 服务的改动：

```yaml
  ide:
    image: ghcr.io/qoeop/trade-ide:main
    environment:
      TRADE_DOLT_HOST: ledger
      TRADE_LEDGER_HOME: /run/trade/ledgers
    configs:
      - {source: ide-research, target: /run/trade/ledgers/research.json}
      - {source: ide-market, target: /run/trade/ledgers/market.json}
    volumes:
      - type: volume                                # 旧卷只挂 agent 子目录；/data/dolt、/data/ledgers 不可见
        source: trade-ide-data
        target: /data/agent
        volume: {subpath: agent}
      - trade-ledger-readers:/run/trade/ledger-readers:ro
    depends_on:
      ledger: {condition: service_healthy}
```

- 卷的 `subpath` 需要 Compose 2.23 以上、Engine 26 以上。本机是 Compose 2.40.3 和 Engine 29.1.3。
- ide 本来就和 ledger 同在 `default` 网络（ide 没有 `networks:` 键），所以网络不用改。

两个配置文件不含密码，和现在的 `paper-market` 一样写成 compose 配置：

```json
{"name": "research", "holds": "research", "kind": null, "database": "research",
 "service": "/run/trade/ledger-readers", "research_branch": "main"}
{"name": "market", "kind": "market", "database": "market", "service": "/run/trade/ledger-readers"}
```

账本配置的 `kind: null` 让命令行从这里永远不发布。再加上 reader 文件里没有 writer，这是两道互相独立的拦截。市场配置和现在
`entrypoint.sh:82`–`84` 写的一样，不带 `role`。

**镜像和启动脚本**：

- 启动脚本 `entrypoint.sh` 删掉克隆、`dolt sql-server`、建账户、写 `service.json`/`admin.password`、设验证组、写配置文件这几步，
  只启动对话代理和 `ide.py serve`，不再传 `--pull`。
- 对话代理的 `--data=/data/agent` 不变。
- Dockerfile 去掉 `pull.sh` 的复制（`:58`），以及 `ENV TRADE_LEDGER_HOME=/data/ledgers DOLT_ROOT_PATH=/data/dolt/home`（`:60`）。

**IDE 的运行用户**：IDE 仍以容器内的 root 运行。实测 Docker Desktop 上，容器内的 root 读得了宿主机用户的 0600 文件；Linux 上
root 也不受这个权限位限制。改成以 `TRADE_UID` 运行，就得先改 `/data/agent` 的属主，不在本方案范围内。

### 4.3 删掉的东西

全部删掉，不留兼容层（用户 10-19：重构期不兼容旧代码）：

- **IDE 容器的脚本**：
  - `services/ide/docker/replica.py`、`pull.sh`；
  - `tests/research_graph/test_replica.py`。
- **研究图谱服务**：
  - `services/ide/research_graph/cli.py:52`、`:71` 的 `--pull`；
  - `serve.py` 里与拉取相关的一切：docstring `:6`–`15`、`:327`–`329`，`REWRITTEN`（`:53`），
    `pull`/`pulling`/`rewritten`（`:132`–`141`、`:181`、`:188`–`269`、`:335`–`336`），事件里的 `hub.pulling`（约 `:487`）；
  - `tests/research_graph/test_serve.py` 中对应的约 13 处。
- **页面**：
  - `services/ide/web/src/live.ts:11`、`:15`、`:89`、`:94`；
  - `state/update.ts:5`、`components/UpdateStatus.tsx:10`；
  - `scripts/live.test.mjs:107`–`111`。
- **说明文档**：
  - `services/ide/README.md:13`、`:25`–`30`、`:91`；
  - 同一 README `:133`–`153` 的「Recovering an IDE market copy after a remote history replacement」一节。
- **蓝图**：
  - `docs/rd/design-skill-research-graph.mdx` 与 `.zh.mdx` 的 `:29`、`:31`；
  - `docs/rd/platform-architecture.mdx` 与 `.zh.mdx` 的 `:15`；
  - `docs-site/lib/product-architecture.ts:317`–`318`、`:741`–`742`。
- **AGENTS.md:69**–**72**：IDE 用 `DOLT_PULL` 快进自己副本的那条例外，删掉后就没有对象了（§6 第 4 条）。

研究图谱仍然每 5 秒读一次 head，只是读之前不再拉取。

### 4.4 行为上的变化

- **页面看到的是活动账本的 head**，不再是 DoltHub 上已发布的状态。
  - 每次写入后都会立即发布，所以两者通常一致。
  - 只有发布失败（`publish_failed`）时才不同：页面会显示还没发布的那个提交，而现在页面反倒看不到它。
- **市场直接读活动库。** 活动库有全部分支和历史（包括 `legacy-20261025`），所以页面不再有「等市场拉完」这个状态，旧研究线钉住的
  市场提交照样能解析。
- **对话工具的查询压在活动服务上。** `market_coverage` 和 `ledger_sql` 现在和导入、回放、写入共用一个 Dolt 进程。
  - 能管住查询的有三处：命令行工具 180 秒的超时（`tools.ts:82`）、研究图谱命令 600 秒的超时（`serve.py:78`）、连接本身 600 秒的
    `read_timeout`（`ledger/db.py:660`）。
  - 但进程被杀掉以后，服务端的查询会不会跟着停下，还没有测过。
  - `ledger sql` 会把结果整个取回来（`fetchall`），大结果会占用共享 Dolt 进程的内存。
  - 这些都放进 §8 验收。
- **不能再只装一个 IDE 来看公开数据。**
  - 现在只起 IDE 镜像，它就能从 DoltHub 克隆一份只读的观察站。
  - 改完以后，IDE 依赖 ledger 服务，而 ledger 第一次启动必须有 DoltHub 密钥（`DOLTHUB_CREDENTIALS`）。
  - 我建议放弃这种用法：目前没人这样部署，本机和服务器都用整套 compose。以后真需要观察站，再给 ledger 加一个不用密钥的只读镜像
    模式（§6 第 5 条）。

## 5. 旧卷

- 新 IDE 只挂载旧卷的 `agent` 子目录，约 56 GB 的 `/data/dolt` 原样留着。
- 这份副本也是回滚的退路：把 compose 和镜像退回切换前记下的 digest，旧 IDE 就能直接用它起来，不用重新克隆。
- 删除这份副本是破坏性写入，需要用户另外授权，并且只删卷里的 `/data/dolt` 和 `/data/ledgers`，保留 `/data/agent`。这件事不在本
  方案的任何 PR 或切换步骤里。

## 6. 需要用户授权的事

1. **修 `ledger sql` 的可执行注释绕过**（§3.2）：拒绝 `/*!` 和 `/*+`，或者改成解析器判断。
   - 现在：Dolt 会执行这类注释里的 `SET GLOBAL`/`SET PERSIST`，检查放行。
   - 改后：这类语句一律以 `WRITE_VIA_SQL` 拒绝。
   - 这是收紧拒绝检查。不修就不能切换：IDE 里的模型会借这条路改动活动服务。
2. **市场导入在提交前再查一次验证组**（§3.3 缺口一）。
   - 现在：导入开始时查过一次，之后可能隔几个小时才提交。
   - 改后：中途有人改了验证组，这次导入以 `COMMIT_CHECKS_DISABLED` 拒绝，不提交。
   - 这也是收紧检查，可以和第 1 条一起批。它不挡切换，但本方案让活动服务的 reader 多了一个持有者，所以一并提出。
3. **把活动服务的 reader 密码交给 IDE 容器，并在切换时重启一次 ledger 和 ide**。
   - 网络路径今天就有。真正的变化是：IDE 容器里第一次出现活动服务的凭据（只读）。
   - ledger 要换上会写 reader 文件的镜像，Dolt 会停几秒，这几秒里 paper 和宿主机命令都连不上。
   - 切换前，我先在隔离的 compose 上测一个运行中的 paper 会话能不能撑过 ledger 重启；再挑没有回放、导入和写入在跑的时候切换，切之前
     再问一次。
4. **删掉 IDE 的 `PULL_FAILED`、`REMOTE_REWRITTEN` 两个停止状态，以及 AGENTS.md:69–72 的 `DOLT_PULL` 例外。** 副本没了，这些
   检查也就失去了保护对象。但它们属于拒绝或停止检查，AGENTS.md 是用户的规则文件，所以单独列出来。
5. **放弃单独部署 IDE 观察站这种用法**（§4.4 最后一条）。

初稿里的「健康检查加验证组检查」一条已经删掉：`ledger service check` 经 `read_as_of`、`connect` 和 `require_commit_checks`，早就在
查这一项（`cli/service.py:312`、`ledger/db.py:676`）。

旧卷不删，因此不需要授权。

## 7. PR 拆分

每个 PR 都基于 `main`，不叠加；后一个等前一个合并之后再开。

0. **`fix(cli): refuse executable comments in ledger sql`**（§6 第 1 条）
   - 修复检查；
   - 测试：§3.2 的四条语句全部以 `WRITE_VIA_SQL` 拒绝；普通注释和字符串里的 `/*!` 字样不受影响。
   - 它和 IDE 无关，是一个现有缺陷，也可以先作为 doctor 发现登记，再按发现修。
1. **`fix(market): check the commit verification group right before each import commit`**（§6 第 2 条）
   - 可以和 PR 0 并行。
2. **`feat(ledger): write a reader-only service file for read-only containers`**
   - `ledger service run --readers`，两条启动路径都写；
   - service 镜像里建 `/var/lib/trade-readers`；
   - compose 给 ledger 挂上 `trade-ledger-readers` 卷，并传这个参数；
   - 测试：文件里只有 `port` 和 reader 账户；用它连接时 reader 能读，writer 和 root 路径都失败；
   - README 说明。

   注意：PR 合并后、`:main` 镜像重新构建完成前，不要对 ledger 跑 `docker compose up`，否则 ledger 会以一个不认识的 `--readers`
   参数起不来，paper 也会跟着断。切换步骤里要写明：先确认镜像 digest 已更新。
3. **`refactor(ide): read the compose ledger service instead of a replica`**
   - compose 里 ide 的环境变量、配置文件、`subpath` 挂载和 `depends_on`；
   - 精简启动脚本，Dockerfile 去掉两处；
   - 删除 §4.3 列出的全部内容；
   - 修改 README、蓝图和 AGENTS.md，以及 `ledger-compose-service.zh.md` §7 的那一句；
   - 相应修改测试。

## 8. 验收

先在隔离的 compose 上验收：用一个新的 `TRADE_DATA`，ledger 从 `file://` 远端自举，不碰活动账本。切换后再在本机复核一遍。

- **能读**：
  - 研究图谱页能打开；head 移动后 5 秒内，页面收到新视图；页面不再出现 `pulling`。
  - 对话代理的每个工具都在 180 秒内返回：`research_state`、`research_status`、`candidate_list`、`candidate_show`、
    `replay_report`、`ledger_sql`、`market_coverage`。
  - Paper 面板照常工作。
- **写不进**（在 ide 容器里）：
  - 命令行的写命令全部失败，例如 `candidate publish`、`ledger backup`、任何 `replay` 写入。writer 路径失败的形式是
    `LEDGER_UNKNOWN`，root 路径是 `KeyError`。
  - 用 reader 文件里的账户直接连服务，`INSERT`、`DOLT_COMMIT`、`DOLT_BRANCH`、`DOLT_TAG`、`DOLT_PUSH` 全部被拒。
  - `ledger sql` 拒绝下面这些：`SET PERSIST …`；§3.2 的四条可执行注释语句；`SELECT … INTO OUTFILE`；`GET_LOCK`。最后两项先实测
    Dolt 的行为，再决定是否也要拒绝。
- **看不到不该看的**：
  - 在 ide 容器里搜遍文件系统，找不到含 `root_password`、writer 账户或 `admin.password` 的文件，也找不到 DoltHub 密钥；
  - 没有 `dolt sql-server` 进程，没有进程监听 3306；
  - `/data` 下只有 `agent`。
- **活动服务没被改动**：
  - 切换前后，`@@GLOBAL.dolt_commit_verification_groups` 都是 `commit`，`read_only` 都是 0，`max_connections` 没变；
  - ledger 上 `research` 和 `market` 的 head 不因 IDE 而移动。
- **查询能被停下**：
  - 用 `ledger_sql` 跑一个超过 180 秒的查询，比如 `research` 表的自连接、`WITH RECURSIVE` 或 `SLEEP(300)`（`research_reader` 只有
    `research.*` 的权限，所以不用市场的表）；
  - 命令行被杀掉以后，服务端 `SHOW PROCESSLIST` 里的那条查询也要消失，至少要在可以接受的时间内消失；
  - 如果它不消失，就先给命令行的 reader 连接加上服务端超时再切换。这又是一处产品代码，到时候单独列出来。
- **旧卷原样**：`trade-ide_trade-ide-data` 还在；`/data/dolt` 的大小和文件不变；`/data/agent` 里的代理和对话记录都在。
- **其他服务不受影响**：
  - 除了切换时那一次计划内的重启，ledger、paper、market-supply、docker-api 都不因本方案重启；
  - 正在跑的 paper 会话继续运行。

## 9. 不做

- 删除旧卷，或删除其中的 `/data/dolt`（§5）。
- 让 paper 和 market-supply 改用 reader 文件；给其他服务级变量加监控（§3.4 末尾的两件事，单独提议）。
- 给 root 的提交路径补验证组检查（§3.3 缺口二）。
- 以 `TRADE_UID` 运行 IDE（§4.2 最后一段）。
- 给 ledger 加一个不需要密钥的只读镜像模式（§4.4 最后一条）。
