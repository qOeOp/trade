# 2026-10-29 IDE 市场副本恢复与验证

发现 20261029-25，诊断见 [市场副本同步](doctor/2026-10-29-ide-market-replica.zh.md)。

## 实现

`trade-ide-pull` 使用独立的副本维护模块。普通 ledger 拉取仍为 DOLT_PULL ff-only；market
抓取全部远端分支、保留历史分支后只作 ff-only 合并。无共同祖先也归入既有 REMOTE_REWRITTEN
语义，不重试或自动重置。显式 `repair-market` 在未提交修改为空时才恢复，先成功保留旧 head
才移动 main。二者共享进程锁；配置限定到 IDE 自己的 `/data/dolt` 与 main 分支。

不新增存储事实、表、研究试验或策略。不改活动账本、活动市场库、Paper 服务或 Docker 配置。
没有删除任何历史分支，也没有引入第二个市场数据库。

## 本机恢复

用户已在本会话明确授权修复 IDE 市场副本，并要求保留研究记录、开 PR 不合并。
在现有 IDE 容器中运行本分支维护模块的 `repair-market`，无需重启进程：

- 原 main：`53tgna1pa02hb1t9v6r3h6pqh8d2e1s1`。
- 恢复时远端 main：`ntiu1ik58mc1v8juca5l9lmebjace7u9`。
- 原 head 保留为同一 market 库内的 `ide-retained/53tgna1pa02hb1t9v6r3h6pqh8d2e1s1`。
- `legacy-20261025` 与其远端引用同时保留。
- 研究快照 `obq0767clbimc413o0u57vso4ssprimd` 在恢复前后以 CLI reader 查询：
  trials 238、candidates 87、evidence bundles 730、runs 78，完全一致。
- IDE 后续 `research state --ledger=research --line=research-line-20261029-ema-entrynotional-multiyear`
  读取到更新的账本提交 `r8i67llpiri96a85aolmsvvfbs76rsgb`，gates 为空。
  实际 SSE 依次发出 queued、computing、ready；未再出现 PULL_FAILED。

## 验证

- Dolt 2.4.2：完整 unittest discovery，663 项通过，无跳过。
- 三项真实隔离 Dolt/file-remote 测试通过：普通拉取拒绝无共同祖先、显式恢复保留原历史与远端
  历史分支、重复恢复不移动 head、恢复后快进更新、未提交修改与保留失败不移动 main、错误分类。
- `uv run --frozen ruff check .` 与 `uv run --frozen mypy` 通过。
- 工程测试仅写抛弃式数据库。实际副本恢复是单独的用户授权维护操作，不把它当成工程试验。

限制：没有本机构建/部署新 IDE 镜像；运行中的原同步程序在修复副本后已继续快进。
新增的常规同步实现需通过 PR 镜像构建与后续部署交付；没有修改任何引擎执行行为或声称经济复现等价。

## 合并前复核：首次加载

用户随后授权检查 CI/review，修复问题后合并。复核发现 Hub 首次读取 head 时跳过 market 同步，
只有下一次账本 head 变化才拉市场；重启或新副本的首次历史图因此仍可能读取过时市场副本。
新增定向回归先确认原实现失败：市场拉取应失败，但原实现返回 202 并开始画图。
现在首次 head 与后续新 head 一样，先同步市场再发出绘图请求；同步失败沿用 PULL_FAILED，
成功重试后才构建图。没有变更拒绝条件、快进保护或记录权限。

修复后 `tests.research_graph.test_serve tests.research_graph.test_replica` 17 项通过；ruff、mypy
通过。此处的 663 项完整测试属于前一实现；新 head 的完整测试另在 CI 与本机重跑确认。
