# 2026-11-15 换账本后生产仍显示旧账本的图

用户在 2026-11-15 删除了 DoltHub 研究库、发布 0.4.0、在新的空账本上重新开始研究（工作站与服务器的旧账本都已归档）。之后用户报告 www.vibe-trading.info "读到的是脏数据"。本记录只诊断，修复由别的会话从本记录与索引出发去做。

| Item | Value |
|---|---|
| Sessions | 用户报告（2026-11-15 17:3x UTC）；没有研究会话证据 |
| Audit session | Claude Code（桌面端），会话 `0660267b-ae67-4c05-b258-d74244daae37` |
| Checkout / ledger | `origin/main` 在 0.4.0（`17b93b347`）之后的文档提交；服务器运行 0.4.0。工作站账本第 2 代，头 `ar2hm3t6…`（DoltHub 同头）；服务器镜像重建于 15:22 UTC，头 `mo0k901p…` |
| Coverage | 服务器 Web 容器的请求日志与它对 `/api/lines`、`/api/view`、`/api/state` 的回答；ledger 镜像容器的同步状态与镜像修订；`ide/research_graph/serve.py`、`ide/web/src/live.ts`、`ledger/replica.py` 的代码阅读。没有在浏览器里复现页面 |
| Cost | 用户看到已删除的研究线和它的图，以为生产读到了脏数据；新研究线 1 小时以上没出现在生产 |
| Net change | 只提方向 |

## Findings

| id | Finding | Evidence | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261115-05 | 账本历史被替换（新账本、头不是旧头的后代）后，研究图服务仍给出旧账本画的图：Hub 的已画视图按研究线名找"同一范围的最近一张"（`_available`），不看它画在哪个账本上；页面也先显示浏览器 IndexedDB 里存的同名研究线的图，服务答不出时保留它 | 服务器镜像在 15:22 换成新账本后，Web 容器（14:55 起运行）对 `/api/view?line=channel-breakout-model-filter` 仍答 200，`scope.ledger_commit` 是旧账本的 `rp02k2f5…`；同一页面对 `/api/state?…&at=rp02k2f5…` 答 400 `UNKNOWN_REF`。重启 Web 容器后同一请求答 202。`ide/research_graph/serve.py` `Hub._available`、`ide/web/src/live.ts` `start()` 与 `load()`（`shown !== null` 时失败不清旧图） | 修缺陷：头换成一条不相关的历史时，Hub 丢掉已画的视图、失败与按提交缓存的读数；页面存的图在其提交不是本账本的提交时丢掉，不显示 | minutes（每次换账本要重启 Web，用户每个浏览器要清站点数据） | open |
| 20261115-06 | 服务器的 ledger 镜像服务与 market-import 不随版本发布：发布只换 Web、Agent、Live 控制与 Paper 控制器，ledger 与 market-import 停在装机时的镜像。11-12 的"镜像每分钟从 DoltHub 同步"（`040dfb3cc`）因此从没上过生产，生产只在页面按 Sync DoltHub 时同步 | 服务器 `trade-ide-ledger-1` 的镜像修订 `7738d62ad`（11-11），其中 `ledger/replica.py` 没有 `keep_synced`；`/etc/trade/remote.env` 的 `TRADE_SERVICE_IMAGE` 是 11-11 的摘要。镜像同步状态 `history` 只有 15:22 的一次（重建时）；工作站 16:04 发布的提交到 17:31 仍没进镜像，手动 `ledger sync` 后 `changed: true`。`deploy/remote/README.md` 写明发布"不重建 Paper 运行、ledger 或策略容器" | 改发布设计（用户 2026-11-15 选"改，随版本更新"）：版本发布时连同 ledger 镜像服务与 market-import 一起换到该版本的服务镜像，只在 Paper 与 Live 空闲时；先写设计记录再做 PR | hours（新研究进不了生产，直到有人手动同步；镜像侧的修复都到不了生产） | open |

## Decisions

- 2026-11-15 用户授权重启生产 Web 容器（已做，17:4x UTC），并选择"改，随版本更新"（20261115-06 的方向）。手动把服务器 ledger 升到 0.4.0 用户没有选。
