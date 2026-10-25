# 2026-10-25 EMA12 审计记录回读

[2026-10-21 EMA12 审计](2026-10-21-ema12-autonomous-audit.zh.md)写于本地分支 `codex/doctor-ema12-audit`（6b6eb54cb，基于 95672ebd3），从未开 PR，索引里没有它新增的 20261021-26 到 -30。原记录按规矩不改；本记录把每条发现对照当前 main 回读，决定哪些进索引。没有新的研究会话，只看代码、测试、提交历史和公开设计站。

| 项 | 值 |
|---|---|
| 会话 | 无新研究会话；回读对象是上述记录及其 /tmp 证据目录（`/tmp/ema12-doctor-20261021` 等，10-25 清理时保留） |
| 审计会话 | Claude Code desktop，claude-opus-5-5，会话 `0ea320e5-411e-4b41-a0b2-38f75547c255`（由仓库清理会话派出的新会话） |
| 检出 / 账本 | main `0784c9d8a`；未读写任何账本 |
| 覆盖 | 五条新发现各自的消费者代码与测试；M1、-03、-20 的当前状态（`market/coverage.py`、`cli/main.py` 帮助、`docs/rd/` 源文件与 https://qoeop.github.io/trade/ 公开页）。缺口：本机只有 Dolt 1.80.2，-27 的 Dolt 集成回归测试没在本机跑 |
| 用时构成 | 只有回读，无研究、修复或等待 |
| 产品导致的无效试验 | 不适用（无研究会话） |
| 新发现按动作 | 无新发现；回读结论见下表 |
| 复发项 | M1（原记录 10-21 实测复发，main 索引尚未登记） |
| 用户先发现 | 0 |
| skill 体积 | 未改 skill |

## 回读

| id | 原记录的发现 | main `0784c9d8a` 上 | 索引处理 |
|---|---|---|---|
| 20261021-26 | 新会话被宿主预载历史记忆，严格盲测不可认证 | 仍成立。宿主初始上下文不归仓库控制；skill、AGENTS.md 和之后的诊断记录都没有处理“盲测前先证明初始上下文没有注入历史”；10-21 之后也没有新的盲测 | 加入未结，measure，open |
| 20261021-27 | 由账本名派生的 database_role 账户名超过 Dolt 32 字符上限，`ledger init` 抛栈 | 已不成立。#1630（0b675a3ad，10-21，晚于原记录）让 `ledger/db.py` 的 `_account_name` 在超过 32 字符时改用 `lg-` 加库名与角色的哈希前缀，不加拒绝条件；回归测试 `test_long_database_names_have_distinct_private_accounts` 与 `test_long_research_and_market_accounts_are_rolled_back_and_rebuilt` 覆盖长名唯一、长度和回滚重建 | 不进索引：原记录写成时修复已在合入途中，不是待修项。之后的研究会话都没走到长账本名初始化，没有复核 |
| 20261021-28 | 四角组成认证要求 a、b 从 base 的全文三方合并无冲突并等于 ab；职责说明头一行一个职责，两处改动改同一行时合并必冲突，交互问题被挡住 | 仍成立。`report/comparison.py:443–447` 的全文合并契约、`report/attribution.py` 的 `merge3`（`merge3-lines-v1`）未变；`cli/templates/strategy-header.md` 仍是每职责一行；`research-round/references/attribution.md` 的 Interactions 一节与 10-21 相同，没有在规划时提示可达性 | 加入未结，measure，open。改认证仍需授权 |
| 20261021-29 | goal 暂停状态约 4 分 59 秒后才被运行中的研究会话观测到 | 仍成立。research-start 现在要求向用户提问前自己暂停 Goal（20261025-06 记了 Codex 宿主禁止这样做），但没有覆盖“用户暂停后多久被观测到”这一方向；宿主 pause 是否即时中断仍未验证 | 加入未结，measure，open |
| 20261021-30 | 指纹等价测试夹具用当前 mtime 写 gzip，`exposures` 的整文件哈希跨秒不等，测试偶发失败 | 已不成立。#1630 把 `tests/engine/test_fingerprint.py` 两处 `exposures.csv.gz` 改成 `mtime=0`，与 `engine/report.py:78,100` 的生产写法一致。夹具里 `order_events.jsonl.gz` 仍用当前 mtime，但 `engine/compare.py:46` 对它不算整文件哈希，不受影响 | 不进索引，理由同 -27。本机 `tests.engine.test_fingerprint` 7 个测试通过 |

## 既有行

| id | main 索引原状态 | 原记录的更新 | 现在 |
|---|---|---|---|
| M1 | open，末见 10-20 | 12 币 13 个月 coverage 输出 379,418 字节，去掉资金费时间戳后 23,462 字节；同一查询重跑一次；readiness.md 当时有 jq 投影指导但没被采用 | main 无更新状态，按原记录改为 recurred、末见 10-21。`market/coverage.py` 仍输出完整 `funding.event_times_ms`；#1640 之后 readiness.md 不再写 jq 投影，改由 `market coverage --help` 说明该字段占大部分输出 |
| 20261021-03 | open（仅余 video 页），末见 10-22 | 再读公开页 404 | main 的末见（10-22）比原记录新，原记录的更新不再适用。另查：#1647（9fd3adce8，10-23）已加 `design-skill-video-evidence` 与 `design-code-video-evidence` 中英文页，公开页 `zh/docs/design-skill-video-evidence/`、`en/docs/design-skill-video-evidence/` 返回 200，站内导航有链接。改为 fixed 9fd3adce8 |
| 20261021-20 | open：发布图仍含旧信号处方与自动消融标题 | 公开策略正文与归因图文字已无旧处方，hover/视觉未测 | main 无更新状态。修复就是 #1628（95672ebd3）：它在记录该发现的同一 PR 里改了 `docs/rd/map.json`，P.3.1.1、P.4.1.1、P.4.1.3 的旧标题均已替换；本次再读公开 `zh/docs/attribution/`，旧标题不在页内，“消融”只出现在“才称条件消融，不为归因另跑回放”的新说法里。改为 fixed 95672ebd3；hover 与视觉仍未测 |

原记录里的 20261021-24 在 main 已于 10-22 结为 none，本 PR 不动它。

## 裁定

无需用户裁定。-28 若要支持两处改动共改说明头的交互，属于改认证检查，需另行授权。
