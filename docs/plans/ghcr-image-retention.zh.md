# GHCR 镜像版本保留

状态：已定并执行选项 2（用户 2026-10-31 让 Agent 代选）。来源：doctor 20261029-34 剩下的一项。

## 现状

2026-10-31 用 `gh api /users/qOeOp/packages/container/<包>/versions` 计数。三个包都是公开包，每个版本都带 `sha-<提交>` 标签，没有无标签版本。

| 包 | 版本数（10-29 审计时） | `main` | `pr-N` | 只剩 `sha-` | 最早 |
|---|---|---|---|---|---|
| trade-runtime | 178（154） | 1 | 52 | 125 | 2026-10-11 |
| trade-ide | 335（221） | 1 | 140 | 194 | 2026-10-25 |
| trade-service | 138（24） | 1 | 63 | 74 | 2026-10-28 |

- 推送方：`runtime-image.yml` 推 trade-runtime，`ide-image.yml` 推 trade-ide 与 trade-service。每个 PR、每次 main 推送都构建一版。没有任何工作流删除旧版本。
- GitHub Packages 对公开包不收存储费，所以版本多只是列表长，不产生费用。

## 谁依赖这些版本

- **trade-runtime 被研究记录依赖。**
  - `trial.image_ref` 和 `paper_run.image_ref` 存的是 `<仓库>@sha256:<摘要>`。
  - `replay reproduce` 与 `paper reconcile` 按这个摘要从 GHCR 拉取镜像，拉不到就拒绝（`RUNTIME_UNAVAILABLE`）。
  - 活动账本现引用 4 个摘要，GHCR 上都在：

    | 摘要 | trial 数 | 构建提交 |
    |---|---|---|
    | `11e47d6a` | 197 | `33bc93550` |
    | `9ab421a9` | 15 | `5d1ebea4e` |
    | `8d373a4e` | 1 | `5a596ca62` |
    | `b0b2337d` | 266 trial 与 1 个 paper 运行 | `e0fe58aa3` |

  - 保留的旧账本备份（`dolt-backups/research-before-clear-20261022T0507`）和历史导出清单也可能引用更早的摘要。删任何 runtime 版本之前，都要先把这些一并列出来。
  - AGENTS.md 把删除保留的运行镜像列为需要用户授权的破坏性写。
- **trade-ide 与 trade-service 没有持久记录依赖。**
  - compose 只按会移动的 `:main` 标签拉取。
  - 唯一的回滚参照是切换前手记的摘要（`ide-reads-ledger-service.zh.md`），记在仓库之外。

## 选项

1. **都不删（现状）。** 不加机制，不花钱，所有记录都能复现；代价只是列表长。
2. **一次性清理 trade-ide 与 trade-service。**
   - 保留 `main`、开放 PR 的 `pr-N`，以及最近 5 个 main 构建（回滚用）。
   - 其余约 450 个版本删掉。
   - 不加工作流，以后需要时再按同一规则清一次。
3. **在 2 的基础上清理 trade-runtime。**
   - 保留集合：
     - 活动账本、保留备份和历史导出里出现过的所有摘要；
     - `main`、开放 PR 的 `pr-N`；
     - 最近 5 个 main 构建。
   - 其余删掉，大约 160 个。
   - 收益只是列表变短；一旦漏算保留集合，被删的那条记录就再也复现不了。
4. **加定时工作流自动执行 2。** 多一个带 `packages: write` 权限的工作流；在没有费用压力的前提下，它省掉的只是偶尔一次手动清理。

## 建议

选 2，不选 3 和 4。

- trade-runtime 全部保留：复现依赖它，删了又不省钱。
- trade-ide 和 trade-service 一次性清理，因为没有任何记录依赖它们。

授权项：

1. 删除公开包的版本属于修改公开内容，需要用户同意。
2. 若选 3，还要用户对删除运行镜像单独授权。

## 决定与执行（2026-10-31）

用户让 Agent 代选，选了 2：trade-runtime 全部保留，trade-ide 与 trade-service 一次性清理，不加工作流。

- **保留**：每个包 6 个版本。
  - `main`；
  - 开放 PR #1936 的 `pr-1936`；
  - 另外 4 个最近的 main 构建。main 构建指 `sha-` 标签的提交在 `origin/main` 第一父链上的版本。
- **删除前核对**：本机运行中的容器所用镜像都在保留集合里。ide 用 `trade-ide@sha256:d2cae705`（`main`）；paper 与 market-supply 用 `trade-service@sha256:c0d28500`（最近 main 构建之一）。
- **删除**：逐个调用 `DELETE /users/qOeOp/packages/container/<包>/versions/<id>`。trade-ide 删 330 个，trade-service 删 133 个，失败 0。
- **结果**：trade-ide 与 trade-service 各剩 6 个版本，trade-runtime 仍是 178 个；两个 `main` 标签仍能拉取。GitHub 允许在 30 天内恢复删除的包版本。
- 以后两包版本再多时，按同一规则再清一次。
