# 一个研究仓库，每个版本线一个分支（2026-11-23）

> 同日修订：分支安排由 [`main-is-the-ledger-in-use-20261123.zh.md`](main-is-the-ledger-in-use-20261123.zh.md)
> 取代：仓库的 `main` 始终是在用的账本，升线时先把 `main` 推成以旧线命名的归档分支并核对，再强推新线账本到
> `main`；线由根提交上的标签 `line/<线>` 表示。下文的单分支取数、无 token 与建库规则照旧。

依据：所有者 2026-11-23 的决定（下列逐条记录，是本设计的授权），取代
[`data-generation-in-release-20261123.zh.md`](data-generation-in-release-20261123.zh.md) 里“每一代一个 DoltHub 仓库
`<基名>-g<N>`、用 API token 建库”的部分；那份记录里的切换步骤（归档、只起 ledger、服务器每 tick 一步、宽松回滚）照旧。

## 所有者决定（2026-11-23）

1. 只有一个 DoltHub 研究仓库 `TRADE_RESEARCH_ORIGIN`（不加后缀），每个版本线一个分支：1.0 之前 `v0.<次版本号>`（如
   `v0.5`），1.0 起 `v<主版本号>`。版本号规则：前一版本的账本不能再用时、且只在那时，升次版本号（1.0 前）或主版本号
   （1.0 起）；补丁版本共用其线的分支。所以版本线 ⇔ 账本代际。分支名由 `pyproject.toml` 的版本推出，不由
   `SCHEMA_VERSION` 推出。
2. 升线总是在新线的分支上开一个新的空账本，即使 schema 没变：所有者可以只为从头重做研究（研究流程改进）而升线。
   因此只保留“补丁版本改了 `SCHEMA_VERSION`/`PAPER_SCHEMA_VERSION` 就拒绝”这条发布规则；不加“升线必须改 schema”。
   换代的触发是“目标版本的线 ≠ 主机账本所在的线”。同一线内 schema 不同只可能来自没发布的 main 构建或发错的版本，
   部署拒绝（Mac）或等待并通知（服务器）。
3. 新一代：新账本，本地仍是 `main`，推为远端分支 `<线>`（`main:v0.6`）。本地分支在所有地方仍叫 `main`
   （`db.py` 的 `BRANCH`、授权、`read_as_of`、备份、IDE 读者都不变）。
4. 每次取数据只取当前线的分支，不带其它线的 chunk。
5. 不再建库：去掉 API token 路径；推新分支用已有的 `dolt login` 密钥。
6. 现网一次性过渡在下一个补丁版本 0.5.3 里自动完成，不给步骤清单：Mac 的 `deploy/update.sh` 把发布到 `<基名>-g2`
   的账本移到 `<基名>` 的 `v0.5`；服务器在 `<基名>/v0.5` 含有镜像的 head 之后跟进，不得先于 Mac。DoltHub 上不删除、
   不强推任何东西；`-g2` 留给所有者处理。

## DoltHub 事实（2026-11-23）

- 推新分支只需写权限：`dolt login` 让客户端“authenticated to push to DoltHub databases where we have write access”
  （<https://www.dolthub.com/docs/sql-reference/version-control/remotes>）；写权限包括 “pushing changes from Dolt”
  （<https://www.dolthub.com/docs/concepts/dolthub/permissions>）。文档没有单独写“推到新分支名会建分支”，但生产里已经
  这样做过：`-g2` 与原仓库的 `main` 都是账本首启用 JWK 密钥推出来的（推送前仓库里没有任何分支）。本地 dolt 2.7.2 对
  `file://` 远端核对：`dolt push origin main:v0.5` 在已有其它分支的远端上建出 `v0.5`（`[new branch] main -> v0.5`），
  并更新跟踪分支 `remotes/origin/v0.5`。
- 默认分支：DoltHub API v1alpha1 只有建库、fork、建/列分支
  （<https://www.dolthub.com/docs/products/dolthub/api/v1alpha1/databases>、`.../branches`），没有设默认分支的调用；
  网页设置里能否改，文档也没写。所以不留 token：默认分支只影响网页首先显示哪个分支，产品的每个读者都点名自己的线。
  所有者愿意时在 dolthub.com 仓库设置里切换（若网页提供），否则网页默认仍显示 `main`（上一代数据）。
- 服务端建分支（`POST /api/v1alpha1/{owner}/{database}/branches`，`revisionType`/`revisionName`/`newBranchName`）要
  API token。所以把 `<基名>` 现有的 `main`（第 1 代，0.5.0/0.5.1）复制成 `v0.4` 不能自动做：推送需要本地有那些
  chunk（要把第 1 代全部下载进活动账本或一个临时克隆并带密钥），而服务端复制要 token。所有者想要时在 dolthub.com
  从 `main` 建 `v0.4`，或保持 `main` 不动。
- 公开 SQL API（只读 GET，无凭据）：`/<owner>/<repo>/<分支>?q=...` 对不存在的分支答
  `query error: branch not found`；`SELECT COUNT(*) AS n FROM dolt_log WHERE commit_hash = '<hash>'` 可用（`n` 是字符串）。
- dolt 2.7.2 本地核对（`file://`）：`dolt clone` 即使 `--single-branch --branch L` 也把 fetch spec 存成
  `refs/heads/*:refs/remotes/origin/*`，且先下载所有分支的 chunk（gc 后才变小）；默认 `fetch` 取全部分支。
  `init` + `remote add` + `fetch origin refs/heads/L:refs/remotes/origin/L` + `reset --hard` 只取 L 的 chunk。
  缺分支时 fetch 报 `invalid ref spec: 'L'`，空远端报 `no branches found in remote`。`dolt remote remove` 连带删除
  该远端的跟踪分支。`gc` 清空 reflog。

## 设计

### 产品代码

- `shared/version.py`：`product_version()`（从 `cli/main.py` 移来）与 `line(version)`。`ledger/publish.py` 的
  `LINE` 是本版本的线；推 `main:<LINE>`，只取 `refs/heads/<LINE>:refs/remotes/origin/<LINE>`，读
  `remotes/origin/<LINE>`。`file://` 远端同样处理。`research_origin` 与 `-g<N>` 规则删除；CLI 与首启页面原样传
  `TRADE_RESEARCH_ORIGIN`。
- `publish.where`：用 reader 账户、不校验 schema，读 origin 的 URL、跟踪分支名（发布或取过的账本恰有一个：它的线；
  0.5.2 的账本是 `main`）与本地 head。部署用版本自己的代码读它。不存新字段：线由跟踪分支名推出。
- 首启（`ledger/service.py`）：`init`、`remote add`、单 refspec `fetch`、`reset --hard`、`gc`、再 `reset --hard`
  （`init` 自带的提交与它的 reflog 被 gc 去掉，第二次 reset 记下首启这一步，镜像页的历史与克隆时一样）。fetch
  报“无分支/无此分支”时，可写服务建新账本并发布为线的分支；镜像一律 `BOOTSTRAP_FAILED`。不再为每个远端分支建本地
  分支。
- 镜像同步（`ledger/replica.py`）：`DOLT_FETCH('origin', <线的 refspec>)`，快进到 `origin/<LINE>`。启动时的
  `REMOTE_MISMATCH` 不变。
- 一次性迁移（`ledger/service.py` `_move_origin`，下一条线删除）：以后的启动里，若本代码的线是 `v0.5`、研究账本的
  origin 是 `<origin>-g<N>`、参数是 `<origin>`，就 `DOLT_REMOTE remove/add` 换成 `<origin>`（记一行日志，跟踪分支随之
  删除），其它情况不动。这是所有者第 6 条决定要求的“改账本的 origin”，只对这一种形状生效；`set_remote` 与镜像启动的
  `REMOTE_MISMATCH` 对任何其它 origin 照旧拒绝。部署只在安全时才起新版本的账本（见下）。

### 部署共用（`deploy/generation.py`）

- `version`：在版本镜像里读 `{line, research, paper}`，origin 就是 `TRADE_RESEARCH_ORIGIN`；没有线（0.5.3 之前的版本）
  就拒绝：它会把 `main` 推到仓库，而仓库的 `main` 是上一代。`TRADE_RESEARCH_ORIGIN` 以 `-g<N>` 结尾也拒绝。
- `place(where, wanted)`：origin 是仓库且跟踪 `[线]` → `same`；跟踪别的线 → `cutover`；还没跟踪 → `unpublished`；
  origin 是 `<仓库>-g<N>` → 目标线是 `v0.5` 时 `move`，否则 `cutover`；其它 origin 一律报错（改公开副本是所有者的事）。
- `probe(origin, line)` 读线分支上的 `ledger_schema`：有账本、无此分支（`empty`）、分支在但没有账本表（`other`）、
  仓库不存在；`contains(origin, line, head)` 读线分支是否含某提交；只认明确答复。

### 工作站（`deploy/update.py`）

- 有账本数据却没有账本容器、账本没在跑：拒绝（比较不了线）。env 没写 `TRADE_RESEARCH_ORIGIN` 时取账本发布去的仓库
  （去掉 `-g<N>`），全部检查通过后写进 env 一次（同 0.5.2）；账本也没有 origin 才拒绝。
- `cutover`：先发布旧账本（失败即拒绝），探测新线分支：有该版本 schema 的账本 → 首启取它；无分支/空库 → 首启新建并
  发布；分支在但不是账本（`other`）→ 拒绝，交所有者看；仓库不存在 → 拒绝，请在 dolthub.com 建一次。之后同 #3482
  （日志、归档、只起 ledger、放回 market.json）。日志多记 `line`；续做时版本的线与日志不同就拒绝（归档的是那条线的
  切换，这个版本不会起它）；0.5.2 的日志没有 `line`，同样拒绝。
- `move`：先把旧账本发布到 `-g2`（失败即拒绝），写新镜像，`up --wait ledger`（新版本账本启动时换 origin），在新账本里
  `ledger publish`（推 `main:v0.5`，取回核对），结果的 remote 必须是仓库；然后照常 `up -d`。不归档，不写日志：中断后
  下一次 update 看到 origin 已是仓库而没跟踪分支（`unpublished`），先发布再继续。
- 同一线内 schema 不同：拒绝。

### 服务器（`deploy/generation.py` `Generation`）

- `due`：同上判定。`cutover` 的等待条件改为“线分支有该版本代际的账本”。`move`：等到 `contains(仓库, v0.5, 镜像 head)`
  （Mac 已推）、无 Paper runner；然后在与切换相同的保持里重读镜像 head 再核一次（等待期间镜像可能又同步了旧库），（冻结 Paper 写入、无进行中的操作、Live 空闲并持账户锁）写日志
  `{kind: move, line, revision, service, phase: archived, market: stopped}`（没有 `archive`），用版本自己的定义
  `up --wait ledger`（镜像启动时换 origin），检查版本读得了库、镜像的 origin 是仓库，记为 `started`；下个 tick 记为
  `done`，不删归档。卷不动：它也装着服务器的 Paper 库。`done()` 照旧让失败发布的回滚宽松（旧版本对换过 origin 的镜像报
  `REMOTE_MISMATCH`）。
- 日志多了 `kind` 与 `line`；更新的控制接手时，线不同就拒绝（“pending for another line”），避免在没归档的旧线数据上
  起另一条线的账本。
- 镜像还没取到线（`unpublished`）或同线 schema 不同：等待并通知。
- 账本启动换 origin 是 Dolt 的 remove 再 add（Dolt 没有改名）：在两者之间停掉的启动留下没有 origin 的账本，下次 `v0.5`
  启动补上 origin。

## 设计评审（2026-11-23，独立 Plan 子 agent）

采纳：线从数据（跟踪分支）读，不从账本容器的镜像版本读（容器缺失、更新的控制接手时镜像与数据可能不符，会把旧线数据
推上新线分支）；有数据没容器拒绝；接手的控制线不同拒绝；退回 0.5.3 之前的版本拒绝（它会推 `main` 并 fetch 全部分支）；
不用 root 容器直接改 Dolt 文件，改为账本启动时自己换 origin（经 `cli.main`，不碰 `REMOTE_MISMATCH`）；Mac 的 move 用
`up --wait ledger` 后再发布；`TRADE_RESEARCH_ORIGIN` 以 `-g<N>` 结尾拒绝；所有取数路径（首启、发布核对、镜像同步、
`publish.state`）都只取线分支。

需要所有者知道的后果（不是本 PR 能改的）：

- 每次升线，服务器的切换都会删掉卷，里面的 Paper 库先打包进归档（`trade-dolt-data.tgz`，不含研究镜像）再删，新账本不读它；归档只留
  最近一代。#3482 起原先不打包，只剩备份 `dolt-backups/paper`。
- `main` 渠道（预发布）在版本号升线之前带着 schema 变更时，Mac 的 update 会拒绝（同线 schema 不同）；#3482 时它会切到
  `-g<N>` 新库。
- 发布工作流在打标签前就会合并升线的版本号；这之后、打标签之前用 `main` 渠道更新的 Mac 会把新线分支真正推到 DoltHub。
- 服务器 move 之后若这次发布失败回滚，旧版本对换过 origin 的镜像报 `REMOTE_MISMATCH`，镜像（以及同服务里的 Paper）停
  到下一个 0.5.3 及以后的版本发布为止；`done()` 让回滚本身照常完成。
- 服务器上 0.5.2 格式的 `generation.json`（没有 `kind`/`line`）若在升到 0.5.3 时还没做完，tick 会停下报日志格式不认，
  交运维处理；0.5.2 的切换在一次发布内做完，正常不会留下。

## 第二次评审（2026-11-23，独立子 agent 审 diff）

采纳：`_move_origin` 中断后补 origin；服务器 move 在保持里重读 head；env 没写仓库时从账本 origin 推出（不新增拒绝）；
Mac 日志记 `line`、续做时核对；`probe` 区分“无分支”与“分支没有账本表”，Mac 拒绝后者、服务器继续等；补测镜像只用
reader 账号的 `publish.where`。回滚后 Paper 停机、旧格式日志两条写进上面的后果。

## 检查

- `tests/ledger/test_service.py`：首启只有 `main` 与 `remotes/origin/<线>`，取不到别的线的提交；没有本线分支时可写
  服务新建账本并推为新分支、其它线不动，镜像拒绝；`-g<N>` origin 在下次启动只对 `v0.5` 换成仓库、一次、不换到别的仓库。
- `tests/ledger/test_replica.py`：同步只取本线（另一线的分支与提交都取不到）；镜像的 reader 读得出 `publish.where`。
- `tests/ledger/test_publish.py`：推与核对都在线分支上。
- `tests/ledger/test_first_run.py`：线的推算与 refspec。
- `tests/deploy/test_update.py`、`tests/deploy/test_generation.py`、`tests/deploy/test_release.py`：判定的每一种、
  升线不改 schema 也切换、同线 schema 不同拒绝/等待、move 的顺序与等待（Mac 未推则不动）、中断续做、日志形状、接手
  另一线拒绝、API 的明确答复。
