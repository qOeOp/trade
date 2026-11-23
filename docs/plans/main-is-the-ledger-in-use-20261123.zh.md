# DoltHub 的 `main` 始终是在用的账本（2026-11-23）

依据：所有者 2026-11-23 的书面决定（下列逐条记录，是本设计与其中远端改写的授权）。它取代
[`version-line-branches-20261123.zh.md`](version-line-branches-20261123.zh.md) 里“每个版本线发布为同名分支、只取该分支”
的安排；[`data-generation-in-release-20261123.zh.md`](data-generation-in-release-20261123.zh.md) 里的切换步骤（归档、
只起 ledger、服务器每 tick 一步、宽松回滚）照旧。

## 所有者决定（2026-11-23）

1. DoltHub 研究仓库的 `main` 始终是在用的账本（生产用 `main`）。
2. 升线（如 0.5.x → 0.6.0）时按此顺序：当前账本照常发布到 `main`；把远端 `main` 推成以旧线命名的归档分支
   （`v0.5`），核对它的头等于 `main` 的头；只有这之后，才把远端 `main` 强制替换为新的空账本（无关历史）。所有者授权
   每次升线都这样改写已发布的 `main`，前提是归档分支核对通过。归档分支此后永不改写、永不删除。补丁版本沿用 `main`。
3. 本地分支在所有地方仍叫 `main`；推送是 `main:main`；镜像与首启只取 `main`。
4. 线的身份不得是账本里存的字段、表或列；建议用 Dolt 标签（如 `line/v0.6`）。如果没有存字段就做不成，停下来报告。
5. 服务器等到：远端 `main` 属于目标线且有数据、旧线的归档分支存在且含旧镜像的头、Paper/Live 空闲；然后归档并重新
   镜像 `main`，不合并历史。
6. 现网一次性过渡在 0.5.4 里自动完成，不给所有者步骤清单。当前账本是 `v0.5` 线，远端 `main` 是上一代（v0.4 线，
   无标签）。Mac 上第一次 0.5.4 的 `deploy/update.sh` 依次：把远端 `main` 的头推成分支 `v0.4`（经临时 dolt 目录）并
   核对；把远端 `main` 强制替换为 v0.5 账本并打标签；让账本跟踪并推送 `main`；核对远端 `main` 的头等于本地头；
   只有在 `main` 核实含有 `v0.5` 的头之后才删除远端分支 `v0.5`（所有者批准）。服务器在 `main` 含有其镜像的头之后
   把镜像从 `v0.5` 换到 `main`：有日志、可重入，且不得先于 Mac。中断的步骤能续做。不碰 `vincent/trade-research-g2`。
7. AGENTS.md 只改切换例外那一句：点明升线切换在核对旧线归档分支之后改写 DoltHub `main`，授权来自所有者启动发布
   工作流。

## DoltHub 与 Dolt 事实（2026-11-23）

- 强推：CLI 文档 `dolt push` 的 `-f, --force`：“Update the remote with local history, overwriting any conflicting
  history in the remote”；删分支是 `dolt push origin :branch`
  （<https://www.dolthub.com/docs/cli-reference/cli>）。SQL 里的 `DOLT_PUSH` 与 CLI 同参，sql-server 推送 DoltHub
  的支持见 <https://dolthub.com/blog/2023-12-29-sql-server-push-support>。写权限包括推送
  （<https://www.dolthub.com/docs/concepts/dolthub/permissions>）。
- 分支保护：DoltHub 的保护规则需仓库管理员主动设置，博客写明当时唯一的选项是防止分支被删除，禁止强推只是计划
  （<https://www.dolthub.com/blog/2022-07-18-how-to-set-up-branch-protection-rules-on-dolthub/>）；没找到它已上线的
  来源。所以强推在没设规则的仓库上可行；所有者若日后给 `main` 设了禁止强推，升线时 `replace` 会以 `PUBLISH_FAILED`
  停下，`main` 不变，归档分支已在。
- 公开 SQL API（只读 GET，无凭据）读得到 `dolt_tags` 与 `dolt_branches`（用 `dolthub/SHAQ` 的 `_migrationtest` 标签核对）。
  按哈希查 `SELECT COUNT(*) AS n FROM dolt_log WHERE commit_hash = '<h>'` 约 0.5 秒；按 `commit_order = 1` 走全历史在
  API 上超时（约 54 秒 context deadline exceeded），所以线由“哪个 `line/` 标签的哈希在 `main` 的历史里”判断。`LIKE
  'line/%'` 在 pymysql 无参数时会被当成格式符，改用 `LEFT(tag_name, 5) = 'line/'`。
- 现状（只读 GET）：`vincent/trade-research` 的 `main` = `rah0i0u9ehq2besq95isujpun0lkqerm`（上一代，schema 1，
  无标签），`v0.5` = `4iqpmcaj1imq5nilk9m0eb4qn1t26jfn`（schema 2），没有标签。
- dolt 2.7.2 本地（`file://`）实测：
  - `push origin <hash>:<branch>` 可推一个提交；`remotes/origin/main:<branch>` 是不支持的映射。
  - 无关历史的普通推送失败（no common ancestor）；`push --force` 与 `CALL DOLT_PUSH('--force', 'origin', 'main:main')`
    替换历史。
  - 推同名标签不带 `--force` 也会覆盖远端标签。
  - `fetch` 只自动跟随新下载历史上的标签，客户端已有的提交上的标签不跟；显式 `refs/tags/X:refs/tags/X` 能取，缺标签时
    报 `invalid ref spec`。
  - `push origin :b` 需要本地有跟踪分支并会删掉它；`CALL DOLT_BRANCH('-d', '-r', 'origin/x')` 删跟踪分支。
  - `dolt sql -r json` 按字母序排列列，所以读多列用 CSV。`dolt_log` 有 `commit_order`，根提交为 1。

## 设计

### 线的身份：标签，不是存储字段

- 线是 `v0.<次版本号>`（1.0 前）或 `v<主版本号>`（1.0 起），由 `pyproject.toml` 的版本推出（`shared/version.py`
  `line`、`order`、`tag`）。账本的线是它根提交上的标签 `line/<线>`：`ledger init` 建研究账本时在 schema 提交前打在
  初始提交上（`ledger/db.py`）。标签是 Dolt 引用，不是表、列或行；没有新增存储字段。
- 读线：`main` 历史里恰有一个 `line/` 标签的哈希；多于一个拒绝（`LEDGER_UNKNOWN`），没有则为“无线”。写账号仍不能
  打标签：标签由管理员在建库与过渡时打。
- 发布只推 `main:main` 与本线标签；只取 `refs/heads/main:refs/remotes/origin/main`。首次发布、`replace` 与过渡先推
  标签再推 `main`，所以远端 `main` 不会以无标签状态出现。线不是本版本的账本不发布（`PUBLISH_FAILED`）。

### 升线（以后每次）

- Mac（`deploy/update.py` Cutover，`ledger/service.py`）：照旧先发布旧账本、查 DoltHub（`main` 必须是本账本的线或
  目标线，且 schema 合目标），停掉其它服务后再发布一次（失败即停，账本仍在跑），停 ledger、归档、只起 ledger。
  新账本首启读远端 `main`（临时读到账本目录）：是目标线就取它；是更早的线就把 `main` 的头普通推成以那条线命名的
  分支，取回核对分支头等于该头（`publish.archive`，从不强推；分支若已存在且是别的历史，推送被拒，`main` 不动），
  再建新账本，`publish.replace`：推标签、强推 `main:main`、取回核对远端头等于本地头。无线或更晚的线拒绝
  （`BOOTSTRAP_FAILED`）。中断后重来：归档已在就是无操作的推送，`main` 已是新线就直接取。
- 服务器（`deploy/generation.py`）：`main` 有目标线、目标 schema 的数据，且旧线分支含镜像的头，Paper 无运行、Live
  空闲，才归档；卷被删掉，新镜像首启只取 `main`。镜像只跟踪 `main`；镜像启动时删掉其它跟踪分支并补取本线标签。

### 一次性过渡（0.5.4）

- Mac：0.5.3 的账本跟踪 `v0.5`、无标签，`place` 得 `move`。`move` 先用旧版发布（必须成功），换镜像，
  `up --wait ledger`，再发布：0.5.4 的 `publish` 先做 `onto_main`：
  1. 只在跟踪分支恰为 `[v0.5]` 且本版本线是 `v0.5` 时动作，其它组合拒绝。
  2. 在 `<服务目录>/line-archive` 的临时 dolt 目录里只取远端 `main`（前后都清掉）。
  3. `main` 已是 `v0.5` 线：必须含本账本根提交，跳过替换（续做）。`main` 无标签、schema 1、不含本账本根提交（上一代）：
     推成 `v0.4` 并核对。其它情况拒绝，什么都不推。
  4. 给根提交打 `line/v0.5`，推标签，强推 `main:main`，取回核对远端 `main` 含本地头。
  5. 发布照常推送并核对后，`_drop_moved_branch`：取回 `v0.5`；已删就清跟踪分支；否则只有已发布的 `main` 含 `v0.5`
     的头才推 `:v0.5` 删除，不含就拒绝且 `v0.5` 留着。
  `moved` 轮询（最长 30 分钟，账本自己的 5 分钟一轮可能正持锁）直到跟踪 `[main]`、线 `v0.5`，之后其它服务才换。
- 服务器：`place` 得 `move` 后等到 `main` 是 `v0.5` 线、schema 2 且含镜像的头（Mac 之前 `main` 是无标签的上一代，
  所以只能等）；在 Paper 暂停、Live 空闲下再读一次，写日志（kind `move`），用新定义起 ledger：镜像启动删掉
  `v0.5` 跟踪分支、取 `main` 与标签；下一 tick 核对跟踪 `[main]`、线 `v0.5` 后记完成。不归档。
- 0.5.4 起，版本早于 0.5.4（ORIGIN 不报 `main`）的部署被拒（Mac 与服务器），以免旧版把 `main` 推成分支。

## 评审

- Plan 子代理设计评审（编码前）采纳：归档从不强推、取回核对；只在首次发布、`replace` 与过渡时推标签；无标签 `main`
  只在 schema 1 且不含本地根时视为上一代；要求恰一个线标签；临时目录前后清理；远端无 `main` 时普通推送；Mac 的
  `moved` 轮询 `where`；切换在停掉其它服务后再发布一次；`version()` 拒绝早于 0.5.4；镜像只跟踪 `main`；服务器等
  “旧线分支含镜像头”。
- 第二位评审（新开子代理看 diff，按数据丢失、强推顺序、归档核对、续做、镜像带其它分支、服务器先动六项）：没找到
  正常运行下丢数据的路径。采纳：中断后续做的切换若旧账本已被停下，先 `docker start` 并等健康再做最后一次发布（原来会
  跳过）；给归档核对补一个推送“成功”却落在别的提交上的测试（去掉核对即失败，已验证）；AGENTS.md 那句改为只有工作站
  的新账本改写 `main`；“不改不删”改为“不改写、不删除”（已有归档分支只接受快进）。不采纳：在强推前再取一次 `main`
  做租约检查——Dolt 没有 `--force-with-lease`，再取只把几秒的窗口缩得更短；强推之后旧账本的提交本就会被拒
  （PUBLISH_REJECTED）并留在本地，租约挡不住，见下条剩余风险。
- 同时发现并修掉一个缺陷：`ledger/db.py` 在导入时读 `pyproject.toml` 求线标签，装成 wheel 的包（Live 镜像）没有这个
  文件，导入失败（`tests.deploy.test_service_context` 报出）；改为建库时才读（`db.line_tag()`）。

## 接受的剩余风险

- 归档核对与强推之间有窗口：这期间旧账本已停（升线）或本账本持发布锁（过渡），别处若推 `main`，强推会覆盖它；
  这些提交仍在推送者本地。同理，若有人违反 AGENTS.md 在别处对真实仓库首启一个更晚线的活动账本，而旧账本仍在写，
  `main` 会被归档后替换，旧账本之后的发布被拒（PUBLISH_REJECTED），那些提交只留在它本地。
- 远端标签同名推送不带 `--force` 也会被覆盖（重做升线时正是需要的）。
- Mac 删掉 `v0.5` 后、服务器换到 0.5.4 前，服务器的 0.5.3 镜像同步失败并保持原头；服务器回滚到 0.5.3 同样如此，直到
  再发布 0.5.4 或更晚的版本。
- 过渡的临时目录要下载上一代 `main` 的全部 chunk（一次）。

## 检查

见 PR 正文（只写实际跑过的检查）。
