# 2026-10-31 未结项的用户决定

| 项 | 值 |
|---|---|
| 会话 | 无研究会话：用户 2026-10-31 请求逐条过等用户决定的 doctor 未结项 |
| 诊断会话 | Claude Code，claude-opus-5-5，会话 ff0b8f21-dc0c-463f-a398-d660c332ddec |
| 检出 / 账本 | main `dc1498097`；未读写活动账本 |
| 覆盖 | 下表 6 行。每行先对照其诊断记录与 main 上的代码，再向用户给出建议，用户答「都按建议来」 |
| 净变化 | 本记录不改机制；各 PR 的净变化写在 PR 正文里 |

## 决定

| id | 用户决定 | 依据 | 结果 |
|---|---|---|---|
| 20261029-02 | 批准：检出必须是当前的 `origin/main`，「在 main 的历史里」不够 | 已复发两次：一次在旧代码上重诊早已修好的缺陷，另一次缺了已合并的发布修复 | in PR [#1932](https://github.com/qOeOp/trade/pull/1932) |
| 20261029-04 | 开工：运行器改 WARNING，阶段日志写入时即按头尾限量 | 原先截断在阶段结束后做，未截断前整份输出先落盘 | in PR [#1936](https://github.com/qOeOp/trade/pull/1936) |
| 20261029-20 | 批准：成交量导入只把二进制浮点渲染值舍入，容差为 4 个 ulp | 82 份重导日志的 `rounded_volumes` 合计为 0 | in PR [#1934](https://github.com/qOeOp/trade/pull/1934) |
| 20261025-32 | 开工：`ledger publish` 输出各段耗时，先量再改 | 下一次研究会话照常写入即可量出瓶颈 | in PR [#1933](https://github.com/qOeOp/trade/pull/1933) |
| 20261029-21 | 结案，不改 | #1928 查过 rc7 的结算代码，仍用 `EXPIRATION-` 前缀，审计判断在起作用；没有证据表明 rc7 的事件带可用的来源字段 | rejected |
| 20261029-118..120 | 搁置 | 119、120 已判为 none；118 要用真实模型和 IDE 的模型凭据实测，而 IDE 现在没有配置聊天 Agent。等用户启用 IDE 聊天时再测 | open |

## 20261029-34 的现状

清单中需要用户授权的删除，已于 2026-10-29 按用户决定执行（[全产品审计](2026-10-29-whole-product-audit.zh.md)第 102 行）。2026-10-31 用户又让清理了 /tmp、已合并 PR 的工作树、悬空镜像和孤儿 Dolt 服务。同日只读复核如下：

| 项 | 2026-10-29 清单 | 2026-10-31 现状 |
|---|---|---|
| `dolt/data.before-compose`、`market-legacy-20261025`（库与备份） | 19 GB、13 GB | 已不存在 |
| `dolt-backups/market` | 27 GB | 85 GB，是 aggTrades 导入写进同一备份的结果，不是多出的副本 |
| `market-archive-cache` | 11 GB，保留 | 11 GB，保留 |
| IDE 卷里自带的 DoltHub 克隆 | 27.8 GB，去副本「另行设计」 | 已不存在：#1917（2026-10-30）起 IDE 用只读账户读 compose 里的 Dolt，旧卷 `trade-ide_trade-ide-data` 已删（`docker volume inspect` 查无此卷） |
| 悬空镜像 | 16 个 | 3 个，都是今天 PR 构建的产物 |
| 本机 runtime 标签 | 4 个无引用的 `pr-*` 与 `5606616830e8` | `main`、`pr-1936`、`pr-1943`，加上运行中 paper 用的 `b0b2337df0c5` |
| 匿名卷 | 2 个，0 B | 1 个 |
| `.claude/worktrees` | 14 个，8.1 GB | 17 个，都是在跑或刚开 PR 的会话 |
| `~/.codex/worktrees` | 15 个约 9 GB，另有 44 个空目录 | 77 项共 3.2 GB，0 个空目录 |
| 非 main 本地分支 | 139 个（95 个已合并） | 84 个：56 个的 PR 已合，1 个已关，1 个开放（#1936），26 个没有 PR |
| GHCR 保留版本 | runtime 154 / ide 221 / service 24 | 未动 |

剩下的都不是产品缺陷：分支清单（删前先把清单列给用户）、GHCR 版本保留（[方案](../ghcr-image-retention.zh.md)，待用户定）。
