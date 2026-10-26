# Doctor 未结项

按 `.agents/skills/product-doctor` 维护，每份诊断记录写完后更新本表。状态词按 record.md，自 2026-10-25 起适用：`fixed <commit>` 只表示已合入；下一次研究会话的诊断把每个已修项改为 `verified <记录>`（路径触发且未复发）、`recurred` 或 `unobserved`（路径未触发，不算验证），`verified` 或 `rejected` 才移到已结。此前已结的行按当时的规矩关闭。

本次状态校准只回读已合入的修复、既有工程测试与技能评测记录；没有重跑这些历史验收或取得新的研究会话证据。下表的通过读数均限定于所引记录，不把文档回读记为 `verified`。

## 未结

| id | 发现 | 动作 | 状态 | 首见 | 末见 |
|---|---|---|---|---|---|
| 20261026-01 | 回补导入不查月份边缘的缺口：回补月份前一分钟未入库，`resumed` 为假，缺口从首个已有分钟算起（`market/series.py:184-189`、`market/store.py:649-651`）；已停止交易的合约 `trading` 取当下状态，月末缺口同样跳过（`market/store.py:659`）。缺口既不向日档与 REST 补取，也不报。`tgppcog4…` 上 9 个合约 MARK 2021-07-01 各 1,440 分钟、6 个合约 LAST 2022-04-01..03 各 2,880 分钟、MKR LAST 2022-02-26..28 约 4,320 分钟可补而未补；`universe_month` 2022-05 因此只有 11 个成员（前后月 17），2022-03 缺 MKR。研究会话据此把产品缺陷当作来源缺口，要授权新增补缺入口（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | fix（边缘也向日档与 REST 补取，补测试；修复既有缺陷不需授权）+ authority 已定（用户 2026-10-26：导入修复合入后，用修好的导入器把市场历史重导进新库，再切换活动市场库；不原地追加，`MONTH_EXISTS`/`UNIVERSE_CHANGED` 不放宽） | fixed b272d41c9（[#1767](https://github.com/qOeOp/trade/pull/1767)：回补月份的边缘也向日档与 REST 补取；已存历史待按用户决定重导新库并切换） | attach 01a173b3 | 2026-10-26 |
| 20261026-03 | readiness 分不清哪些覆盖异常真挡住回放：零成交量是原样经过的输入事实（`market/coverage.py:23-25`），MARK 洞 60 分钟内沿用最新价、更长且有持仓即 `CAPITAL_VALUATION_GAP`（`engine/run.py:371-374`、`engine/README.md:171-175`），skill 与 coverage 都不转述；却要求窗口内每个异常都称成因与经济影响未证明并提问（`readiness.md:15-18,30-34`）。会话为 369 个零成交量分钟导出 386 MB、下载 8 个月档逐条比对，369/369 一致后仍报未知（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | skill + authority（用户 2026-10-26 已预授权：与官方一致的零成交量是观测、不触发提问；写明回放怎样处理缺口，只对会让运行失败的缺口与策略读取的输入提问）+ measure（coverage 是否需列零成交量区间，先量复发） | in PR [#1774](https://github.com/qOeOp/trade/pull/1774)（skill：readiness 写明四类输入事实在回放中的处理，零成交量是官方观测、不复核不提问，只对超过 60 分钟且在交易期内的 MARK 洞、交易期内缺资金费、缺月或回执不可读、策略读取的值提问；评测 `zero-volume-observation-asks-only-blocking-gap`；measure 未做，待复发） | attach 01a173b3 | 2026-10-26 |
| 20261026-04 | 最后一问把数据/范围选择换成单纯的授权问题：丢了可立即运行的 `[2021-07-02, 2026-10-01)`（缺口落在预热期）与方案 2，把缺陷修复说成新增入口；readiness 让用户选“保持选择、取得缺失来源”，却不说已存月份只能经产品修复与授权补入（`readiness.md:32-38`、`market/store.py:597-598`）（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | skill | open | 2026-10-26 | 2026-10-26 |
| 20261026-05 | 会话检出（与主检出）有未跟踪、未忽略的 `docs-site/bun.lock`，readiness 的干净检出检查（`readiness.md:53-57`）会让每次回放都停下；Agent 只记在 /tmp 草稿，未告诉用户（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | fix（`.gitignore` 加 `docs-site/bun.lock`，或用户删掉该文件） | in PR [#1776](https://github.com/qOeOp/trade/pull/1776)（`docs-site` 用 npm：CI `npm ci`、跟踪 `package-lock.json`；`docs-site/.gitignore` 忽略 `bun.lock`、`bun.lockb`、`pnpm-lock.yaml`、`yarn.lock`；用户本地文件不删，合入后不再出现在 `git status`；干净检出检查不改） | 2026-10-26 | 2026-10-26 |
| 20261026-06 | `research state --help` 把 `trials_on_line` 写得像列表，代码返回计数（`report/status.py:503`）；`research state` 用 `at`、`research status`/`candidate list` 用 `ledger_commit` 标账本提交；会话因此两次读空（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | fix | open | 2026-10-26 | 2026-10-26 |
| 20261026-07 | CI 质量检查漏项：`PYTHONWARNINGS: always::ResourceWarning` 使 unittest 不再启用默认警告过滤，DeprecationWarning 不可见；CI 的 mypy 与 compileall 不含 `paper`（`.github/workflows/quality.yml:26,34,40`、`pyproject.toml:51`）（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | fix | in PR [#1779](https://github.com/qOeOp/trade/pull/1779)（测试步改为 `default,always::ResourceWarning`；mypy 不带参数读 pyproject，compileall 加 `paper`；由此暴露的 `paper/` 7 个 mypy 错误同 PR 修；本地 591 项测试无任何警告） | 2026-10-26 | 2026-10-26 |
| 20261026-08 | research-sources `SKILL.md:29` 称缺 key 即“未检索”，`references/papers.md:10` 称无 key 调用可用（预算十分之一）（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | skill | in PR [#1777](https://github.com/qOeOp/trade/pull/1777)（skill：无 key 时能免 key 调用的来源照常调用并记“no key”，有应答即算已检索，只有被拒或限流（要求 key、401/403、额度耗尽、退避后仍 429）才是未检索；references 按公开文档写明各源免 key 行为：OpenAlex `page=` 可翻页、`cursor=` 过首页需 key，Semantic Scholar 共用公共池，FRED 无 key 一律 400；评测 `keyless-answer-counts-as-searched`） | 2026-10-26 | 2026-10-26 |
| 20261020-21 | 封存运行的 `metrics_revision` 记宿主检出 HEAD；本线六个正式运行都记未合入、远端分支已删的 `8c5cd561f`（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)） | skill（readiness 确认检出在 `origin/main` 且干净）+ measure（`research status` 报其是否在 main）；加检出拒绝需授权，补推归档标签需用户同意 | recurred（上次以归档标签 `archive/metrics-revision-12849814c` 处理）；skill 部分 fixed 69f3508d5（#1748）；[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：检出检查已执行、merge-base 通过，无封存运行，unobserved；未跟踪 `bun.lock` 见 20261026-05 | 2026-10-20 | 2026-10-26 |
| 20261025-23 | 选以旧契约候选重启时，不告诉用户该规则不能原样再测、重启是新规则且首报无对照；“选B”执行成了另一条规则（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)） | skill | fixed 2deeca435（#1745）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-25 | 2026-10-25 |
| 20261025-24 | 换线时给出并推荐产品必拒的方案（冻结源码换窗口、市场库没有的多年历史）；`line select` 不查起点能否登记（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)） | skill（列线前查可登记与覆盖；线都已暴露、需新范围时一次给出若干完整的候选线并标明哪些需产品改动；冻结规则换窗口只走样本外） | fixed e5390d0f3（[#1750](https://github.com/qOeOp/trade/pull/1750)）后 recurred（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：线都已暴露时首问选项 A 不是一条线、B/C 未说明需未来数据；推荐方案 1 时自己的草稿已写需授权导入，消息未说明；并入 20261026-02） | 2026-10-25 | 2026-10-26 |
| 20261025-29 | 评测 `validation-input-runtime-change` 留在顶层 `evals/`，不在插件根下不运行，设计站仍引为证据（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)） | fix（单独 PR） | fixed 74eb13a5c（[#1743](https://github.com/qOeOp/trade/pull/1743)）；首次真实运行即失败，见 20261025-36/-37；-36/-37 已由 #1756/#1757 修；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-25 | 2026-10-25 |
| 20261025-36 | research-round 的 validation.md 没写 X.1.3.2 交给 skill 的分工：代码只核构建、源码、设计、成员、窗口、覆盖与账户，镜像兼容与修正影响由 Agent 判断；拒绝的绑定不消耗登记；停止记录引用的身份；账户基准是哪次运行。评测 with 臂因此常把兼容判断归给代码（[聚焦诊断](2026-10-25-validation-input-eval.zh.md)） | skill | fixed 94929b3dd（#1756）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-25 | 2026-10-25 |
| 20261025-37 | 评测 `validation-input-runtime-change` 的 `skill-fired` 用 llm 看回答而不看调用，无插件臂无工具调用也判 PASS 并计分（[聚焦诊断](2026-10-25-validation-input-eval.zh.md)） | fix（grader 单独 PR） | fixed f7dd25870（#1757）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-25 | 2026-10-25 |
| 20261025-30 | README 称市场自 2020-01、R1 回放 37 个合约；research-start 设计页未随 #1729/#1734 更新（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)） | fix | fixed 4ae1f0a12（#1741）后 recurred（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：`README.md:93` 仍称活动库自 2025-01 起，`tgppcog4` 已回补到 2020-01） | 2026-10-25 | 2026-10-26 |
| 20261025-32 | 每次写入同步发布，连续写间隔 15–17 s（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)） | measure | open | 2026-10-25 | 2026-10-25 |
| 20261025-33 | 逐 UTC 日指纹每运行约 96 KB，产品只比较整体相等（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)） | measure | open | 2026-10-25 | 2026-10-25 |
| 20261025-34 | research-round 另设宿主进程授权、research-sources 从交易所凭据同处的 `.env` 读 key，不在 AGENTS.md 一处（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)） | authority 已批（用户 2026-10-25：授权与凭据规则统一到 AGENTS.md 一处，移出 research-round 的宿主进程与配置授权、research-sources 的 `.env` 读 key、product-doctor 的凭据规则）；待实施 | fixed a864b50a8（#1752）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）（会话只用无 key 文献调用）；契约审查注：`key()` 辅助函数能读 `.env` 中任一名字的值，限制只在文字 | 2026-10-25 | 2026-10-25 |
| 20261025-35 | DSR 读法的试验数与夏普方差取自不同总体（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)） | measure | open | 2026-10-25 | 2026-10-25 |
| 20261025-12 | 两次发布同时推同一 head 时，输的一方被报成 `PUBLISH_REJECTED`“公开副本被别处改过、覆盖需授权”，实际远端已是本地 head；发布不加锁、被拒不 fetch（[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)） | fix（用户 2026-10-25 批准：发布持服务命名锁串行；被拒先 fetch，远端 head 等于本地即已发布；拒绝本身不放宽） | fixed 6f26b4362（[#1726](https://github.com/qOeOp/trade/pull/1726)）；[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：`server.log` 会话内约 25 次非快进被拒，两次到达 Agent；修复后 IDE 轮询下的发布未现场重测；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-25 | 2026-10-25 |
| 20261025-22 | 带账本的读命令在本地领先时都会发布，本地模式 IDE 每 5–11 s 轮询 `ledger sql` 因而成为第二个发布者（[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)） | fix（IDE 取 head 不走会发布的命令，或读命令不发布；与 -12 分开交付） | fixed 41f9cea2d（[#1732](https://github.com/qOeOp/trade/pull/1732)）；[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：会话时 trade-ide 从旧检出 `ide-agent-chat`（`4f57d811e`）轮询，长期服务须随新代码重启才生效，待下次会话量被拒次数；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-25 | 2026-10-25 |
| 20261025-14 | 派生登记只要 `rationale.local` 非空就可空对照，schema 所说的故障或零活动条件未检查；v7 重启登记成 v6 候选的派生、对照为空，首报预测不可检（[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)） | skill（新契约重启以根开始）+ authority（检查只在父运行故障或无活动时允许空对照） | fixed f6686f663（[#1734](https://github.com/qOeOp/trade/pull/1734)：检查与“重启为根”规则）；向用户告知重启是新规则另立 20261025-23；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-25 | 2026-10-25 |
| 20261025-15 | 研究 skill 不说明 `--execution bars\|quotes` 怎么选（[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)） | skill | fixed 3385e025a（[#1728](https://github.com/qOeOp/trade/pull/1728)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-25 | 2026-10-25 |
| 20261025-16 | `replay report --exposures` 无复现时返回 null 不给原因（[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)） | fix | fixed 4607cc3bc（#1746）；此前：9938b8ece（[#1730](https://github.com/qOeOp/trade/pull/1730)）已给原因，但 v6 运行（trial 67）仍提示必被 `RUNTIME_UNSUPPORTED` 拒的 `replay reproduce`（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-25 | 2026-10-25 |
| 20261025-18 | 每调用上下文 24.5 万涨到 37.5 万 token，会话累计 45.2M，09:59Z 首次压缩（[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)） | measure | open；[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：主会话 43,624→441,724 token、09:59:43Z 压缩；全部线程 57.8M 输入，缓存 98.3%；[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：35 次请求，输入 4.85M（缓存 4.68M），输出 26.3K，最大上下文 197K，无压缩 | 2026-10-25 | 2026-10-25 |
| 20261025-06 | research-start 要求自行暂停 Goal，Codex 宿主禁止，每次提问空转两轮（[v7 卡线](2026-10-25-codex-v7-stranding.zh.md)） | skill | fixed d3f0d8fdd（#1705，会话前已合 main，但会话检出 `8c5cd561f` 不含它；完整审计 unobserved）；用户已确认宿主权限边界，skill 与文档已本地修订，新增离线评测 with 3/3、原用例回归 with 1/1，均实际触发，见[实施记录](../goal-host-pause-boundary.zh.md)；仍待合入后的真实宿主场景验证；本次有 Goal 时提问未空转（修复未合入，不算验证，[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-25 | 2026-10-25 |
| 20261025-01 | 固定在 quote 表诞生前的市场提交无法导出 bars（[聚焦诊断](2026-10-25-historical-quote-export.zh.md)，[v7 卡线](2026-10-25-codex-v7-stranding.zh.md)） | fix | fixed 7e5118a4e（[#1679](https://github.com/qOeOp/trade/pull/1679)）；隔离历史快照导出并经原生 read_market 读取的回归通过，全量 514 项无跳过；仍待合入后真实旧市场提交研究路径观察；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-25 | 2026-10-25 |
| 20261025-10 | 试验计数按市场提交加窗口统计，不按线；新线换用更新的市场提交时计数清零，同一段行情已被反复研究的事实不进多重检验修正（[v7 卡线](2026-10-25-codex-v7-stranding.zh.md)，用户 2026-10-25 定新开后提出） | measure（先量新开线换提交时的计数与 `line_trials`） | open | 2026-10-25 | 2026-10-25 |
| 20261025-11 | 输入键含导出器源码哈希（`market/` 8 个模块加 `uv.lock`），导出字节不变的导出器改动也让此后运行与此前不可比，同契约换镜像重建、`bind` 与复现被拒；2026-10-19 至 10-24 有 13 次提交改过这些文件，#1679 合并即触发（[v7 卡线](2026-10-25-codex-v7-stranding.zh.md) 20261022-03 与删除清单） | fix（authority：用户 2026-10-25 批准不再比对 `exporter_source_sha256`，只比导出内容哈希与选择；字段照常记录） | fixed 9ea3d12a9（[#1685](https://github.com/qOeOp/trade/pull/1685)：只比导出内容与选择，源码哈希继续记录）；全量 512 项无跳过，导出器源码单独变化可比／重建及内容变化仍拒绝的回归通过；仍待真实跨导出器变更研究观察；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-25 | 2026-10-25 |
| 20261025-08 | 仓库无“不叠 PR”规则，叠 PR 拿不到质量 CI（[v7 卡线](2026-10-25-codex-v7-stranding.zh.md)） | authority（AGENTS.md 一句） | fixed 324bc82bb（[#1682](https://github.com/qOeOp/trade/pull/1682)：AGENTS.md 写明 PR 基于 main、不叠 PR）；未另做行为评测或研究会话验证；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-25 | 2026-10-25 |
| 20261022-11 | 每版本 8–17 分钟；本轮升至平均 12.1M token，43/43 运行无条件复现（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） | skill + measure | skill 部分已随 #1639 合入；fresh 复算代理随 #1646 / 9a517d545；审阅命中率与无条件复现的价值仍待测 | 2026-10-22 | 2026-10-23 |
| 20261023-02 | 已向用户展示、后被遮罩的读数未撤回；`research status` 只给遮罩计数；`replay report --at` 旧提交读出未遮罩数字不提示（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） | fix + skill | fixed 10bd4bfa5（#1644：status 列 without_economic_evidence、`--at` 报告标注 head 已无资格、skill 点名撤回；eval 3/3）；待真实会话验证；unobserved（[v7 卡线](2026-10-25-codex-v7-stranding.zh.md)）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-23 | 2026-10-23 |
| 20261023-06 | 设计站仍把移入 AGENTS.md 的规则记为 skill 规则；#1641 新问法无 eval（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） | fix | fixed 9a517d545（#1646：两条规则改标 AGENTS.md、补 #1641 eval）；#1644 新规则的设计站条目见本 PR；unobserved（[v7 卡线](2026-10-25-codex-v7-stranding.zh.md)）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-23 | 2026-10-23 |
| 20261023-07 | 压缩后反复重读 skill 与 help（估算约 41M） | measure | open；[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)一次压缩后重读 research-start 四个文件与宿主记忆一次；[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：无压缩；第三轮开头重读 research-start SKILL 与 readiness 约 20 KB | 2026-10-23 | 2026-10-25 |
| 20261020-38 | 审查子代理过早派出、继承作者提示或修复后复用（[第二次诊断](2026-10-20-doctor-run-2.zh.md)） | skill | recurred（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：六个审查者都读宿主记忆 `~/.codex/memories/MEMORY.md`，带入以往审查结论；动作改 skill：审查者不读宿主记忆）；fixed ab7a0f4fa（#1744：审查者不读宿主记忆）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）（本会话无子代理） | 2026-10-20 | 2026-10-25 |
| 20261020-39 | 拉镜像卡在凭据助手时仍要等满 300 秒 | measure | open | 2026-10-20 | 2026-10-20 |
| 20261020-40 | 日线策略的一周预检碰不到退出逻辑；豁免只看窗口长度，不看位置 | measure | open；2026-10-22 会话未复发（预检在月界、≤7 天） | 2026-10-20 | 2026-10-22 |
| M1 | `market coverage` 打印全部资金费时间戳，skill 要用 jq 删掉；先量一年、200 个合约的输出大小，再定 CLI 默认 | measure | recurred（[EMA12 审计](2026-10-21-ema12-autonomous-audit.zh.md)：12 币 13 个月输出 379,418 字节，去掉资金费时间戳后 23,462 字节，同一查询重跑一次；200 合约仍未量；输出未变，现由 `--help` 说明该字段占大部分输出，[回读](2026-10-25-ema12-audit-recheck.zh.md)）；[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：c16 仍以 jq 删 `funding.event_times_ms` | 2026-10-20 | 2026-10-21 |
| M2 | research-start 让用户手动输入 `/loop`，但在 Claude Code 里 Agent 可以自己调用 loop；先量自己调用是否可靠 | measure | open | 2026-10-20 | 2026-10-20 |
| 20261021-03 | video-evidence 仍缺设计页（源码缺失、公开页 404）；评测错误引用及 #1621/#1622 的设计页更新已由 #1623 / 18cd160cd 修复，83 个当前命名评测引用均存在 | fix | fixed 9fd3adce8（#1647：video-evidence 两个设计页中英文上线，公开页 200、导航有链接；[回读](2026-10-25-ema12-audit-recheck.zh.md)）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-21 | 2026-10-25 |
| 20261021-07 | 技术审阅原件混有经济结果和大输出；先测现有 capture/tables 的技术投影能否满足四项审阅 | measure | open；未证明经济暴露影响审阅结论 | 2026-10-21 | 2026-10-21 |
| 20261021-13 | PA timing 被误读为规模无关能力（[复审](2026-10-21-economics-duties-pa.zh.md)） | fix | fixed 271e8bcc9（#1625；未逐项复核）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-21 | 2026-10-22 |
| 20261021-14 | 时期裁剪文字与负总和算法、单侧差/配对差口径不符（[复审](2026-10-21-economics-duties-pa.zh.md)） | fix | fixed 271e8bcc9（#1625；未逐项复核）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-21 | 2026-10-22 |
| 20261021-15 | 预测同号、单规则与各职责独立效应混淆（[复审](2026-10-21-economics-duties-pa.zh.md)） | skill | fixed 271e8bcc9（#1625；未逐项复核）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-21 | 2026-10-22 |
| 20261021-16 | 跨 trial supersedes 让默认读取隐藏既有解释（[复审](2026-10-21-economics-duties-pa.zh.md)） | fix | fixed 271e8bcc9（#1625；未逐项复核）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-21 | 2026-10-22 |
| 20261021-19 | 27 职责立场混淆，F2/F4 重复计全退出（[复审](2026-10-21-economics-duties-pa.zh.md)） | skill | fixed 271e8bcc9（#1625；未逐项复核）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-21 | 2026-10-22 |
| 20261021-20 | 设计站认证范围与归因语义未在所有消费者一致交付 | fix | fixed 95672ebd3（#1628 改了 `docs/rd/map.json` 的旧标题；[EMA12 审计](2026-10-21-ema12-autonomous-audit.zh.md)与[回读](2026-10-25-ema12-audit-recheck.zh.md)实读公开归因页已无旧处方与自动消融标题；hover 与视觉未测）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-21 | 2026-10-25 |
| 20261021-22 | 五轮复盘与每轮全推荐的信息价值边界不清（[复审](2026-10-21-economics-duties-pa.zh.md)） | skill | fixed 271e8bcc9（#1625；未逐项复核）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-21 | 2026-10-22 |
| 20261021-23 | correction/source反向发现与联读仍需审计 | measure | open；[三任务复审](2026-10-21-three-workstream-validation.zh.md)确认历史分页可读旧判断，但普通report/state未展开自由文本更正；先测新读者能否经现有关系发现，不改检查/权限/schema | 2026-10-21 | 2026-10-21 |
| 20261021-25 | 九职责无 PA 直接映射；先辨明代理/约束/不可观测（[复审](2026-10-21-economics-duties-pa.zh.md)） | measure | open；未改变检查、权限或存储结构 | 2026-10-21 | 2026-10-21 |
| 20261025-1686 | 报价环境复现遗漏执行方式与保证金率，被有效配置检查拒绝（原诊断草稿编号 20261025-01，交付统一为 20261025-1686，避免与并行诊断撞号；[定点诊断](2026-10-25-quote-reproduction.zh.md)） | fix（恢复封存环境，保留身份与指纹检查） | fixed a4e635461（[#1686](https://github.com/qOeOp/trade/pull/1686)）；定向 14 项无跳过、最终 PR CI 514 项无跳过，隔离单机合成报价 OCI 验收的有效配置及七类报告指纹一致，见[实施记录](../replay-determinism-boundary.zh.md)；仍待真实研究会话验证，不代表真实全年行情、跨主机或全部订单机制通过；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)） | 2026-10-25 | 2026-10-25 |
| 20261021-26 | 新会话被宿主预载历史记忆，严格盲测不可认证（[EMA12 审计](2026-10-21-ema12-autonomous-audit.zh.md)） | measure（再做盲测前先证明初始上下文没有注入历史，不加不可执行的承诺） | open；[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：研究会话读账本前读 `~/.codex/memories/MEMORY.md` 三次并在两次回答中引用；结论另有账本支持 | 2026-10-21 | 2026-10-21 |
| 20261021-28 | 四角组成认证要求全文三方合并无冲突，职责说明头一职责一行，两处改动共改说明头时交互问题走不通（[EMA12 审计](2026-10-21-ema12-autonomous-audit.zh.md)） | measure（先在规划时说明可达性；改认证需授权） | open | 2026-10-21 | 2026-10-21 |
| 20261021-29 | 用户暂停 Goal 后，运行中的研究会话约 4 分 59 秒才观测到（[EMA12 审计](2026-10-21-ema12-autonomous-audit.zh.md)） | measure（先验证宿主 pause 的语义，不在仓库建调度器） | open | 2026-10-21 | 2026-10-21 |

本轮新会话已见正式预检、独立审阅、登记绑定、报告与重放顺利经过，也未证明已结缺陷复发；不能把未触发路径统称为已验证。04–20、26–37 的其余路径继续按新会话回读。上述新项及保留措施见 [2026-10-21 EMA 会话诊断](2026-10-21-codex-ema-year.zh.md)；-10、-11 是既有指导已覆盖的方法错误或旧版本问题，动作 none，不列为待修产品项。

## 用户先发现（doctor 漏报）

用户在诊断之前指出的问题。每份记录的表头报告其数目，应降到零。

| id | 问题 | 用户指出 | 应发现的镜头 | 状态 |
|---|---|---|---|---|
| 20261026-02 | 用户指出研究会话三轮、三次等回复，始终没有 Goal、研究没开始 | 2026-10-26（跟读时） | 行为与决策（未核对面向用户的选项能否立即执行） | 并入 20261025-24，open |
| 20261026-03 | 用户指出零成交量没处理：核实与官方一致后仍报成因与经济影响未知 | 2026-10-26（跟读时） | 产品契约（未检查 skill 规则能否了结、与产品自身的输入说明是否一致） | in PR [#1774](https://github.com/qOeOp/trade/pull/1774) |
| 20261025-05 | 用户问“迁移不是数据库迁移嘛 你还改上源码了？”：授权请求没说清改动类别 | 2026-10-25 | 行为与决策（未核对授权请求的措辞与随后动作是否一致） | fixed 324bc82bb（#1682；未运行行为评测，仍待后续需授权场景观察） |
| 20261023-05 | 用户问 “#253 是 lane 吗”：面向用户的对象命名 | 2026-10-23 | 行为与决策（未检查面向用户的报告） | fixed 9a517d545（#1646） |
| 20261023-02 | 用户引用 12 小时前已被遮罩的数字追问 | 2026-10-23 | 行为与决策（未沿用户已见读数追踪资格变化） | fixed 10bd4bfa5（#1644） |
| 20261022-04 | 用户指出结果无需独立 run_id | 2026-10-22 | 数据与产品契约 | 已修 #1636 |
| 20261022-06 | 用户指出应补完整收益与拆分，不能仅改审计不报错 | 2026-10-22 | 消费者与存储 | 修复及验收见 #1637 |
| 20261022-08 | 用户指出原会话未创建 Goal，并要求宿主授权兼容 | 2026-10-22 | 行为与技能 | 修复见 #1637，实际宿主创建未代办 |
| 20261022-05 | 用户指出预检持久化价值与全量报告归档的必要性不能混为一谈 | 2026-10-22 | 数据与使用成本 | 已修 #1636 |
| 20261020-24 | skill 文件夹不合 skill 编写规范：评测在 skill 目录内、规则带设计编号、个案规则与历史说明 | 2026-10-20 | 产品现状 | 已修 #1613；剩余项 -32、-33、-34 已修 #1615 |
| 20261020-25 | CI 测试日志里满是错误与警告行 | 2026-10-20 | 产品现状 | 已修：#1604、#1605；uv 构建后端版本警告已由 #1613 修 |
| 20261021-01 | `ledger init` 中途失败会留下建了一半的账本（库、账号、branch 写权），同名再初始化被拒 | 2026-10-21（Agent 在用户要求的重建中发现，不是诊断发现） | 产品现状（没有检查重建路径） | 已修 #1622 |
| 20261021-02 | 删库后同名重建撞上服务级 `dolt_branch_control` 里残留的旧写权行（和旧账号） | 2026-10-21（同上） | 产品现状（没有检查重建路径） | 已修 #1622 |
| 20261021-18 | 用户先指出 skill/code 耦合；此前未检查安装包是否包含命令资源 | 2026-10-21 | 产品现状（缺少分发产物复核） | 已修 #1625 |

## 已结

| id | 发现 | 处理 |
|---|---|---|
| 20261025-25 | 比较表、`non_dominated`、推荐必列对象与未复核清单不按执行身份分开，v7 线混入 45 个 v6 候选（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)） | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed 88dd33b78（#1749）；`research status` 每行带执行身份，v7 非支配只有 200/207，Agent 只按 v7 向用户比较 |
| 20261025-26 | 研究图把推荐的每个 `about` 对象标为 kept_reference，75 个版本 50 个显示为保留参考（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)，保真测试） | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed 50e17d7a2（#1742）；保真测试中账本图已无 kept_reference |
| 20261025-27 | 43 个 CLI 子命令中 30 个 `--help` 无描述，未交付所称契约；会话读产品源码 89 次（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)） | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed 592987df1（#1753）；49 个子命令都有 reads/writes/returns 块；残余 help 漂移另立 20261026-06 |
| 20261025-28 | 无受支持的市场行情读取命令，源码审查者写脚本导入 `market.store`（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)） | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed 999fc4566（#1755）；会话用 `market bars` 导出，未写脚本导入内部模块 |
| 20261025-17 | `candidate list` 一次 24,205 token，入口每次读，首轮读三次（[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)） | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed e573724db（#1747）；三类大输出都重定向到文件、只取键 |
| 20261025-19 | 换线触发后只给同方向两项，没走 research-start 列线（未读 selection/recommendation、未跑 `candidate list`）（[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)） | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed ca82c599b（#1729）；换线时读了 selection、跑了 `candidate list`；选项问题归 20261025-24 |
| 20261025-13 | readiness 要求凡覆盖异常都提问，与 Goal 规则“只问阻塞”冲突；问了 37 个窗口外零成交分钟后未等回答就继续（[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)） | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed db9dafd89（#1727）；只就窗口内的异常提问；规则本身另见 20261026-03 |
| 20261025-20 | 市场库只能按月向后追加，更早历史补不进现有库（[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)） | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed 020bbe3a3（#1736）；回补历史在用，未复发；回补路径带出 20261026-01 |
| 20261026-02 | 用户指出：研究会话 17 分钟、三轮、三次等用户回复，始终没有 Goal，研究没开始。research-start 只在 `line select` 之后建 Goal（SKILL.md「Before continuing into research-round」），而换线、补数在 `line select` 之前；宿主有 Goal 工具（会话内 goal 查询返回 null）；首轮选项 A 不是一条线，而是「先研究再提线」，多出一轮 | 并入 20261025-24（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：同一根因，选项不是可登记的线；Goal 在 `line select` 前不建符合 research-start，不是成因） |
| 20261025-31 | 公开账本存 19 篇论文全文 PDF（28.97 MB）并随 DoltHub 再分发，权利未核（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)） | rejected：用户 2026-10-25 定继续在公开账本保存来源论文全文，不改 |
| 20261022-03 | 运行身份一变（契约升级或导出器改动），固定源码就没有续线路径：重建要求契约、配置键、含导出器哈希的输入键全等；v6→v7 卡住账本唯一一条线（[v7 卡线](2026-10-25-codex-v7-stranding.zh.md)；同契约换镜像的修复 #1635 保留） | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：fixed d560896a7；真实旧契约入口关旧线、在 v7 新开，未跨契约重建 |
| 20261025-03 | `research state`/readiness 不提示线已不能在当前镜像上跑；`report.affected_runs` 无调用者（[v7 卡线](2026-10-25-codex-v7-stranding.zh.md)） | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：fixed 0784c9d8a；`research state` 给 `RUNTIME_UNSUPPORTED`，Agent 明说不能续跑并关线 |
| 20261025-04 | `changes.md` 与设计站的跨契约重建处方必被产品拒绝（[v7 卡线](2026-10-25-codex-v7-stranding.zh.md)） | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：fixed d560896a7；新线按 changes.md 从有实质改动的版本开始，未改无关字节 |
| 20261025-05 | 授权请求没说清要改产品代码，用户以为是数据迁移（[v7 卡线](2026-10-25-codex-v7-stranding.zh.md)） | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：fixed 324bc82bb；10:03Z 授权说明写明是产品登记规则的拒绝检查及现拒什么 |
| 20261022-13 | 因果规则只管决策 K 线，定量与最小名义价等订单输入不受约束；20 次 causal 失败继承自根，首轮审阅漏 19 次（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：fixed ebc4772af；六次源码审查逐项追溯订单输入时间，全部 passed，无前视 |
| 20261022-16 | help 未说明写入效果：`replay reproduce`/`replay explore` 写 trial、`source review` 失败会遮罩旧运行；设计站称每个 help 都写明（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：fixed 9a517d545；先读 `replay reproduce --help`，把 201 记为复现的 explore trial |
| 20261025-21 | 冻结源码不能换窗口或资产再登记（`SOURCE_ALREADY_EXPOSED` 全局判断）；`validation registration` 只收见证之后的窗口，`replay explore` 不算证据（[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)） | rejected：用户 2026-10-25 先授权后撤回，暴露检查不变；市场有完整历史后线一次声明长窗口，后续检验进样本外 |
| 20261022-10 | 换线规则触发条件（“线内无改动能超过可检出差”）不可观测，从未触发；推荐冻结后又跑 41 版、11.6 h（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） | verified [v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)：fixed 10bd4bfa5（#1644）；本次第五次比较不变后触发，停止登记并回问；回问只给同方向两项，另立 20261025-19 |
| 20261023-04 | 原生核查代理跨 52 版复用，93.7M token（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） | verified [v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)：fixed 9a517d545（#1646）；六次预检各派新的审查子代理，未跨版本复用 |
| 20261023-03 | 推荐正文逐版重抄全表（54,387 字节，TEXT 上限 65,535），16/23 条紧跟单次运行（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） | verified [v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)：fixed a42866e9f（#1645）；推荐只在首报后与 REVIEW_DUE 时写（judgment 270），每次运行只写解读与优先级 |
| 20261025-02 | 候选 `runtime_contract` 是发布时常量，三处检查无独立保护，只在升级时卡住全部候选（[v7 卡线](2026-10-25-codex-v7-stranding.zh.md)） | rejected：用户 2026-10-25 定：契约升级即关闭旧线、在新契约上新开，不改代码、不删检查；新发布的候选自动带 v7，此检查不挡新开路线，暂不动 |
| 20261025-07 | #1680 的原生预检没走迁移路径，导出内容哈希变化未解释，引用的审阅只在临时账本（[v7 卡线](2026-10-25-codex-v7-stranding.zh.md)） | none：#1680 已关闭（用户 2026-10-25），其连续性主张不再需要证明 |
| 20261023-01 | 活动 Goal 下向用户的提问 15 ms 后被续跑吞掉，Agent 自行撤回并独跑 12 h；暂停后仍称“授权已收到”（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） | fixed 10bd4bfa5（#1644）；verified [v7 卡线](2026-10-25-codex-v7-stranding.zh.md) |
| 20261023-05 | 向用户用裸 “#253” 指称 judgment，用户误为 lane（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） | fixed 9a517d545（#1646）；verified [v7 卡线](2026-10-25-codex-v7-stranding.zh.md) |
| M3 | `research state` 输出随路线变长 | fixed a42866e9f（#1645）；verified [v7 卡线](2026-10-25-codex-v7-stranding.zh.md) |
| 20261022-09 | 比较输出不给回撤峰谷与区间持仓，Agent 预测落空区间 | #1639 / c20890092；hypothesis.md 消费者核对通过（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） |
| 20261022-12 | price_pnl 舍入差未说明 | #1639 / c20890092；消费者核对通过（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） |
| 20261022-15 | 测试 stderr 泄漏、mypy 跳过未注解函数体 | #1639 / c20890092；main CI 39801200436 测试日志无泄漏，mypy 无 note（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） |
| 20261022-17 | research-round 与 AGENTS 重复授权句 | #1639 / c20890092；消费者核对通过（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） |
| 20261022-14 | 整轮未同步备份；ledger review 只查历史改写，过期备份仍 ok（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） | rejected：用户 2026-10-22 暂不加；research-round 中“账本及其备份是研究记录”一句作为 AGENTS.md 重复删去 |
| 20261021-24 | doctor stored-field 授权文字与根规则不一致（[复审](2026-10-21-economics-duties-pa.zh.md)） | none：用户 2026-10-22 定问题在于是否重复记录；该句不重复 AGENTS.md，保留（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） |
| 20261022-04 | 严格一对零或一的 trial/run 使用两套编号，消费者需反复翻译身份 | #1636 / 8d3afd2ed；后续会话统一 trial 编号与预检缓存运行正常（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） |
| 20261022-05 | 成功预检的可再生原生表永久存储；缓存再生须接通技术审查及严格暴露豁免 | #1636 / 8d3afd2ed；后续会话统一 trial 编号与预检缓存运行正常（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） |
| 20261021-04 | 过长预检技术 passed，却到登记才说明超出暴露豁免；拒绝还给出没有消耗登记时不适用的 retry_of 建议 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） |
| 20261021-05 | candidate export 帮助只说新文件，未说明同目录候选说明文件也必须不存在 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） |
| 20261021-06 | ledger sql EXPLAIN 因 Dolt/PyMySQL 的 NULL 数值转换抛出未捕获 ValueError，破坏 JSON 错误契约 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） |
| 20261021-08 | research-round 禁止在 text 复制数值的范围不明，与报告模板的数值要求冲突 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） |
| 20261021-09 | doctor 把本库 evals 外置政策归为 Anthropic 通则；lenses.md 长引用缺目录 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） |
| 20261021-12 | research-round 重复 AGENTS 的通用授权清单及仓位变量所有权，可用精确引用去重并保留专属解释 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） |
| 20261021-17 | 每轮重复 HTML/overview 被当作报告义务（[复审](2026-10-21-economics-duties-pa.zh.md)） | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） |
| 20261021-18 | CLI 从 skill 路径取模板，wheel 缺失资源（[复审](2026-10-21-economics-duties-pa.zh.md)） | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） |
| 20261021-21 | REVIEW_DUE missing 误列 priority（[复审](2026-10-21-economics-duties-pa.zh.md)） | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） |
| 20261022-06 | 开放周期 realized 丢失，利润桥与配对归因不完整（[诊断与授权](2026-10-22-complete-realized-profit.zh.md)） | 随 [#1637](https://github.com/qOeOp/trade/pull/1637) 交付；[独立复审及验收](2026-10-22-complete-profit-acceptance.zh.md)通过，活动历史未改 |
| 20261022-07 | 回撤合约贡献遗漏峰值与区间已实现变化（[诊断与授权](2026-10-22-complete-realized-profit.zh.md)） | 随 [#1637](https://github.com/qOeOp/trade/pull/1637) 交付；[独立复审及验收](2026-10-22-complete-profit-acceptance.zh.md)通过，活动历史未改 |
| 20261022-08 | Goal 自动创建指导与宿主许可冲突，Agent 静默跳过（[诊断与授权](2026-10-22-complete-realized-profit.zh.md)） | 随 [#1637](https://github.com/qOeOp/trade/pull/1637) 交付；[独立复审及验收](2026-10-22-complete-profit-acceptance.zh.md)通过，活动历史未改 |
| 20261022-01 | 原生审计、指纹及工程配对 CSV 读取器拒读合法长字段（[诊断与授权](2026-10-22-native-report-readers.zh.md)） | [#1633](https://github.com/qOeOp/trade/pull/1633) / d0564c949；437 tests、PR CI、六组原生配对及主线镜像年度长持仓回放通过；历史无效运行保留 |
| 20261022-02 | 工程配对漏检空表列差异，缺非业务键列可能崩溃（[诊断与授权](2026-10-22-native-report-readers.zh.md)） | [#1633](https://github.com/qOeOp/trade/pull/1633) / d0564c949；结构回归与原生配对通过，稀疏零交易报告保持支持 |
| 20261020-01 | 工作树不干净时，只读命令也被拒绝 | #1594 |
| 20261020-02 | 绑定字段名错配 | #1593 |
| 20261020-03 | 跑完基线就停；优先级没有报告依据 | #1594 |
| 20261020-04 | 预检不走正式回放的加载路径 | #1598 |
| 20261020-05 | 封存报告丢掉运行器的局限 | #1601 |
| 20261020-06 | 失败原因里看不到加载阶段的拒绝码 | #1598、#1601 |
| 20261020-07 | 同一运行期失败逐条记录 | #1598、#1601；阶段日志截断 #1604 |
| 20261020-08 | 拉镜像无超时 | #1598；git 调用超时 #1604 |
| 20261020-09 | `candidate new` 骨架用旧构造参数 | #1601 |
| 20261020-10 | `ledger sql` 报错丢掉服务器原文 | #1601 |
| 20261020-11 | 空账本 `research state` 拒绝 | #1601 |
| 20261020-12 | 源码审查查询扫全部提交历史 | #1601 |
| 20261020-13 | strategy-authoring 漏写 equity 返回字典、make_qty 抛错 | #1599；#1613 删说明后复发，随 -27 由 #1615、#1616 修 |
| 20261020-14 | skill 中的命令写法与 CLI 不一致 | #1599 |
| 20261020-15 | 根首报前的修复被迫按派生登记 | #1599 |
| 20261020-16 | 单次运行报告不读信号表 | #1599 |
| 20261020-17 | 审查子代理继承作者的上下文 | #1599 |
| 20261020-18 | 仓位上限丢掉超额部分 | #1599 |
| 20261020-19 | 缺完整命令序列、登记模板、参与率读法、典型耗时 | #1599 |
| 20261020-20 | 自写脚本算的视图未记 search_exposure | #1599 |
| U1–U5 | 删 binding、试验计数、无对照免比较设计、删 metric 与 NOT_A_CHECKOUT、删 sql 黑名单 | #1598、#1601 |
| 20261020-22 | 测试输出的 ResourceWarning、fork 警告、引擎日志噪音；pymysql 失败连接漏 socket | #1604、#1605；CI 遇 ResourceWarning 即失败 |
| 20261020-23 | 静态检查未进 CI；S3 列举缺键、截断空页崩溃 | #1606、#1607 |
| 20261020-26 | nautilus-report-analysis 用已改名的周期字段 | #1615 |
| 20261020-27 | 定仓的两个坑不在 skill 与骨架里 | #1615；骨架的定仓辅助 #1616 |
| 20261020-28 | CLI 选项大多没有说明 | #1616 |
| 20261020-29 | `research state` 只给研究线名称；目标没写进备注 | #1616（输出整条记录）、#1615（目标写入 `--note`） |
| 20261020-30 | `line select` 接受未审查的起点 | #1618（START_REVIEW_REQUIRED） |
| 20261020-31 | 归因表与报告模板缺 `by_regime` 切片 | #1615 |
| 20261020-32 | duty-directory 的设计语料编号与残句 | #1615 |
| 20261020-33 | restore.md 重复 `ledger export` 的回读比对 | #1615 |
| 20261020-34 | 会过期或重复的句子与通用做法 | #1615 |
| 20261020-35 | 复审节奏要 Agent 自己写数 | #1615；改为产品固定停点 #1618；review_cadence 种类与 REVIEW_CADENCE_FIXED 删除 #1621 |
| 20261020-36 | 覆盖回执三个不变的占位字段 | #1618 |
| 20261020-37 | 设计站页面与代码、skill 不一致 | #1617、#1620；剩余见 20261021-03 |
| U6 | 捕获中的重复存储（源码 3 份、覆盖回执 2 份、指纹 2 份；stdout 与 summary 相同；资金费时间戳） | #1619（用户 2026-10-21 批准） |
