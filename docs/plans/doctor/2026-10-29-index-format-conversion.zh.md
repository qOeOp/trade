# 2026-10-29 index.zh.md 格式转换记录

按 20261029-31 的处置（record.md 已改，#1865），`index.zh.md` 从旧格式机械转换为新格式：未结表 `| id | 发现 | 动作 | 来源 | 代价 | 状态 | 首见 | 末见 |`，已结表 `| id | 发现 | 来源 | 代价 | 状态 |`，漏报表并入来源列。转换不改任何行的现态，不删任何编号或链接：被挤出状态格的历史（早先的状态词、提交、PR、审计注记）与整张漏报表原文都在本记录里。脚本在转换会话的 scratchpad，不入库。

## 规则

- 状态词取现态：含 `in PR` 取 `in PR` 并链接 PR；以 `open` 开头或含「仍 open」为 `open`，链接发现格里的记录；含 `fixed <commit>` 时取记录日期最晚的审计判定词（`verified`/`unobserved`/`recurred`）并链接该记录，没有判定词则为 `fixed <commit>`，链接同段的记录或 PR；「此前：」之后的内容只算历史。已结表：含 `verified` 取 `verified` 并链接其记录；`rejected`、`none`、`并入` 照原词保留（后两者不是状态词，见下）；2026-10-25 之前只写 PR 的关闭行记为 `fixed <commit>`（格内有提交号时）或 `fixed`，链接格内的记录或 PR。
- 来源：漏报表里的编号为 `user（工作流）`，工作流名按 `references/lenses.md` 的合并表映射：产品契约／产品现状／机制→产品契约与交付；行为与决策／行为与技能／失败／方法→行为与决策证据；数据与使用成本／消费者与存储／数据／效率→数据与使用成本；数据与产品契约→两者。首见为 `attach …` 的行为 `attach`，其余为 `doctor`。
- 代价：旧行从未按等级计量，一律 `unknown`。首见、末见照旧。
- 漏报表里不在未结表也不在已结表的编号（20261020-24、20261020-25、20261021-01、20261021-02）按其「已修 #PR」状态加入已结表。
- 人工指定的行（旧格无状态词）：20261029-34「已执行（用户批准）…分支清单已列待…」记为 `open`；20261022-11「skill 部分已随 #1639 合入；fresh 复算代理随 #1646 / 9a517d545；…仍待测」记为 `fixed 9a517d545`。

## 未结表转换前的状态格

| id | 转换前状态 | 转换后状态 |
|---|---|---|
| 20261029-101 | in PR [#1881](https://github.com/qOeOp/trade/pull/1881)（用户 2026-10-29 批准改审计计算：Holm 按登记全族、缺 p 保守处理并标 provisional；661 测试过；未合并） | in PR [#1881](https://github.com/qOeOp/trade/pull/1881) |
| 20261029-102 | in PR [#1878](https://github.com/qOeOp/trade/pull/1878)（十处措辞；未合并） | in PR [#1878](https://github.com/qOeOp/trade/pull/1878) |
| 20261029-108 | in PR [#1882](https://github.com/qOeOp/trade/pull/1882)（签名按源码改，比对脚本 976 处一致；未合并） | in PR [#1882](https://github.com/qOeOp/trade/pull/1882) |
| 20261029-109 | in PR [#1883](https://github.com/qOeOp/trade/pull/1883)（含 117；未合并） | in PR [#1883](https://github.com/qOeOp/trade/pull/1883) |
| 20261029-112 | in PR [#1883](https://github.com/qOeOp/trade/pull/1883)（含 115；未合并） | in PR [#1883](https://github.com/qOeOp/trade/pull/1883) |
| 20261029-118 | open（measure） | open [Codex 118](2026-10-29-doc-product-issues.zh.md#20261029-118) |
| 20261029-22 | in PR [#1874](https://github.com/qOeOp/trade/pull/1874)（用户 2026-10-29 批准放宽；未合并） | in PR [#1874](https://github.com/qOeOp/trade/pull/1874) |
| 20261029-23 | in PR [#1867](https://github.com/qOeOp/trade/pull/1867)（未合并） | in PR [#1867](https://github.com/qOeOp/trade/pull/1867) |
| 20261029-35 | in PR [#1875](https://github.com/qOeOp/trade/pull/1875)（含 AGENTS.md 授权行，用户 2026-10-29 定；未合并） | in PR [#1875](https://github.com/qOeOp/trade/pull/1875) |
| 20261029-36 | in PR [#1863](https://github.com/qOeOp/trade/pull/1863)（未合并） | in PR [#1863](https://github.com/qOeOp/trade/pull/1863) |
| 20261029-26 | in PR [#1864](https://github.com/qOeOp/trade/pull/1864)（未合并） | in PR [#1864](https://github.com/qOeOp/trade/pull/1864) |
| 20261029-27 | in PR [#1868](https://github.com/qOeOp/trade/pull/1868)（未合并） | in PR [#1868](https://github.com/qOeOp/trade/pull/1868) |
| 20261029-28 | in PR [#1871](https://github.com/qOeOp/trade/pull/1871)（未合并） | in PR [#1871](https://github.com/qOeOp/trade/pull/1871) |
| 20261029-29 | in PR [#1869](https://github.com/qOeOp/trade/pull/1869)（未合并） | in PR [#1869](https://github.com/qOeOp/trade/pull/1869) |
| 20261029-30 | in PR [#1872](https://github.com/qOeOp/trade/pull/1872)（未合并） | in PR [#1872](https://github.com/qOeOp/trade/pull/1872) |
| 20261029-31 | in PR [#1865](https://github.com/qOeOp/trade/pull/1865)（record.md 与设计页；index 转格式等 #1861 合并后另开 PR；未合并） | in PR [#1865](https://github.com/qOeOp/trade/pull/1865) |
| 20261029-32 | in PR [#1862](https://github.com/qOeOp/trade/pull/1862)（未合并） | in PR [#1862](https://github.com/qOeOp/trade/pull/1862) |
| 20261029-33 | in PR [#1866](https://github.com/qOeOp/trade/pull/1866)（评测删 1 加 1，user-first-miss 2/3）、[#1873](https://github.com/qOeOp/trade/pull/1873)（attach 只留证据留存，用户 2026-10-29 批准）与 [#1876](https://github.com/qOeOp/trade/pull/1876)（attach grader）；未合并 | in PR [#1866](https://github.com/qOeOp/trade/pull/1866) |
| 20261029-34 | 已执行（用户 2026-10-29 批准）：删 `dolt/data.before-compose` 19 GB、`market-legacy-20261025` 13 GB（legacy 分支在活动库与 DoltHub，头 53tgna1）、4 个 pr-* runtime 标签与 5606616830e8、16 个悬空镜像、2 个匿名卷、19 个已合并或已关 PR 的工作树；分支清单已列待用户；IDE 卷去副本（设计变更）与 GHCR 版本未动 | open [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261029-02 | open（收紧检查需用户定）；[全产品审计](2026-10-29-whole-product-audit.zh.md)：9a19 起步检出落后 origin/main 7 个提交，检查通过，Agent 自建 origin/main worktree 后才预检 | open [01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md) |
| 20261029-24 | in PR [#1879](https://github.com/qOeOp/trade/pull/1879)；662 项完整测试、最终 22 项定向测试及浏览器验收通过；未合并 | in PR [#1879](https://github.com/qOeOp/trade/pull/1879) |
| 20261029-04 | open | open [01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md) |
| 20261029-05 | help 部分 fixed（main `cli/main.py:1328` 列 `exposure_exemption`、`:1715` `--runtime` 可省；unobserved）；设计页 `design-code-replay.zh.mdx:163` 仍 open（[全产品审计](2026-10-29-whole-product-audit.zh.md) 交叉复核，[Codex 05](2026-10-29-doc-product-issues.zh.md#20261029-05)） | open [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261029-06 | recurred ×2（[全产品审计](2026-10-29-whole-product-audit.zh.md)）；in PR [#1870](https://github.com/qOeOp/trade/pull/1870)（未合并） | in PR [#1870](https://github.com/qOeOp/trade/pull/1870) |
| 20261028-02 | fixed e0fe58aa3（#1818）；unobserved（[01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md)） | unobserved [01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md) |
| 20261028-03 | fixed e0fe58aa3（#1818）；unobserved（[01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md)） | unobserved [01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md) |
| 20261028-04 | fixed 4232842d1（#1803）；unobserved（[01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md)） | unobserved [01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md) |
| 20261028-05 | fixed fd6c4222e（[#1808](https://github.com/qOeOp/trade/pull/1808)：`market import-quotes --help` 与 `market/README.md` 写明每个月，早先月份也一样，都用最新存的规格推算，不是当月生效的价格最小变动；只改文字） | fixed fd6c4222e [#1808](https://github.com/qOeOp/trade/pull/1808) |
| 20261028-07 | fixed e0fe58aa3（#1818）；unobserved（[01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md)） | unobserved [01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md) |
| 20261028-08 | fixed e0fe58aa3（#1818）；unobserved（[01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md)） | unobserved [01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md) |
| 20261028-09 | fixed bd8166c04（#1821）；unobserved（[01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md)） | unobserved [01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md) |
| 20261028-11 | open；unobserved（[01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md)） | open [01a181f4 聚焦诊断](2026-10-28-codex-01a181f4-precheck-pre-data-exposure.zh.md) |
| 20261028-12 | fixed 085a69534（#1825）；unobserved（[01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md)）；unobserved（[全产品审计](2026-10-29-whole-product-audit.zh.md)：两会话显式传摘要） | unobserved [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261027-02 | fixed 4f0d9abc4（[#1790](https://github.com/qOeOp/trade/pull/1790)：`research state` 对活动市场库任何分支都不持有的线钉报 `MARKET_COMMIT_UNRESOLVED`，research-start 只给能跑的线；配合 04ba9927b [#1787](https://github.com/qOeOp/trade/pull/1787) 按所有分支解析提交）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)：线钉 `l1kfbo4…` 可解析，门槛未触发） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261027-01 | fixed 0e41b8b99（[#1785](https://github.com/qOeOp/trade/pull/1785)：市场引用拒绝用市场自己的说明与修复，只改文字）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)：会话未遇 `UNKNOWN_REF`） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261027-03 | in PR [#1816](https://github.com/qOeOp/trade/pull/1816)（CI：ffmpeg 安装步骤限 10 分钟、每次 apt 调用限 150 s 并带 apt 自身网络超时，最多重试三次；测试保留）；此前：open；[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)：main 40609218231 该步 15 s，取消运行的原因未重查 | in PR [#1816](https://github.com/qOeOp/trade/pull/1816) |
| 20261027-04 | in PR [#1816](https://github.com/qOeOp/trade/pull/1816)（设计站 research_state/research_status 与 `report/status.py` 对齐（unclosed_lines、judgment_history、line.ledger_commit 含义、unverified_runs 只属 research_status）；`research state --help` 补 next_actions；W.3.3.2 与 readiness 第 4 部分对齐；7 个带规则评测补设计页引用，只余 4 个触发测试）；此前：open；[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)：仍在：设计站 W.3.3.2 仍说开发窗口内或策略输入上的异常都要问，`readiness.md:45-50` 只问阻塞情形；未被设计页引用的评测 research-start 2、research-round 6、product-doctor 5、research-sources 1、research-graph 2、video-evidence 8 | in PR [#1816](https://github.com/qOeOp/trade/pull/1816) |
| 20261027-05 | in PR [#1816](https://github.com/qOeOp/trade/pull/1816)（skill：reference 不再链到别的 skill 的 reference，改指那个 skill；`strategy-header.md` 写成 `candidate new`/`candidate export` 提供的模板；readiness.md 加目录；未改 grader）；此前：open；[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)：仍在；另 `nautilus-report-analysis/references/depth.md:7` 链到别的 skill 的 reference（两层） | in PR [#1816](https://github.com/qOeOp/trade/pull/1816) |
| 20261027-07 | in PR [#1816](https://github.com/qOeOp/trade/pull/1816)（paper 与 research graph 服务改用 `Server`：客户端断开（ConnectionError）不打回溯，其他错误照旧报告；测试同用）；此前：open；[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)：仍在：CI 40609218231 有 `paper/serve.py:379→475→300→runs.py:256` 之后的 `BrokenPipeError`（`tests/paper/test_serve.py::StreamTests` 的流处理线程活过 `service.close()`），本地偶见 research_graph serve 的 `ConnectionResetError` | in PR [#1816](https://github.com/qOeOp/trade/pull/1816) |
| 20261026-01 | fixed b272d41c9（[#1767](https://github.com/qOeOp/trade/pull/1767)：回补月份的边缘也向日档与 REST 补取；市场历史已于 2026-10-26 用修好的导入器重导新库并切换为活动 `market`，DoltHub `vincent/trade-market` main 一并替换；用户 2026-10-26 定：不保留旧市场历史，钉在旧市场提交（如 `l1kfbo4…`、`tgppcog4…`）上的既有试验与研究线不再复现）；[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)：会话只读到重建的后果（钉住的 `l1kfbo4…` 已不在活动库，见 20261027-02），回补边缘路径未走到，unobserved；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261026-04 | fixed ac38aad64（[#1780](https://github.com/qOeOp/trade/pull/1780)：skill：readiness 的数据/范围提问先列按钉住输入现在能跑的范围，保留已给过的方案；已存月份内缺的来源只能经导入修复与用户授权替换该段历史补入，称为缺陷修复而非新入口；批准产品改动的问题不代替数据/范围选择；评测 `stored-month-gap-question-keeps-runnable-range`）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261026-08 | fixed 3a62c5aac（[#1777](https://github.com/qOeOp/trade/pull/1777)：skill：无 key 时能免 key 调用的来源照常调用并记“no key”，有应答即算已检索，只有被拒或限流（要求 key、401/403、额度耗尽、退避后仍 429）才是未检索；references 按公开文档写明各源免 key 行为：OpenAlex `page=` 可翻页、`cursor=` 过首页需 key，Semantic Scholar 共用公共池，FRED 无 key 一律 400；评测 `keyless-answer-counts-as-searched`）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261025-23 | fixed 2deeca435（#1745）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261025-29 | fixed 74eb13a5c（[#1743](https://github.com/qOeOp/trade/pull/1743)）；首次真实运行即失败，见 20261025-36/-37；-36/-37 已由 #1756/#1757 修；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261025-36 | fixed 94929b3dd（#1756）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261025-37 | fixed f7dd25870（#1757）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261025-30 | fixed 4ae1f0a12（#1741）后 recurred（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：`README.md:93` 仍称活动库自 2025-01 起，`tgppcog4` 已回补到 2020-01）；[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)：`README.md:93` 仍称活动库自 2025-01 起，活动 `market`（`gc305h7…`）已从 2020-01 起，recurred；[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)：会话未读 README，产品状态仍在（`README.md:93` 仍称自 2025-01 起） | recurred [01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md) |
| 20261025-32 | open | open [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md) |
| 20261025-33 | open；[全产品审计](2026-10-29-whole-product-audit.zh.md)补数：74 行 9.56 MB、最大 631 KB（trial 220），`by_utc_day` 只由 `engine/compare.py:98,128` 写，无消费者读 | open [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md) |
| 20261025-34 | fixed a864b50a8（#1752）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）（会话只用无 key 文献调用）；契约审查注：`key()` 辅助函数能读 `.env` 中任一名字的值，限制只在文字；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261025-35 | open；[全产品审计](2026-10-29-whole-product-audit.zh.md) 交叉复核补：`nautilus-report-analysis/references/ratios.md:14-23` 的 N 与方差口径与设计页不一（[Codex 20261025-35](2026-10-29-doc-product-issues.zh.md#20261025-35)） | open [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md) |
| 20261025-12 | recurred（变体，见 20261029-22：远端已是本地后代仍报 PUBLISH_FAILED；[全产品审计](2026-10-29-whole-product-audit.zh.md)）；fixed 6f26b4362（[#1726](https://github.com/qOeOp/trade/pull/1726)）；[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：`server.log` 会话内约 25 次非快进被拒，两次到达 Agent；修复后 IDE 轮询下的发布未现场重测；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | recurred [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261025-22 | fixed 41f9cea2d（[#1732](https://github.com/qOeOp/trade/pull/1732)）；[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：会话时 trade-ide 从旧检出 `ide-agent-chat`（`4f57d811e`）轮询，长期服务须随新代码重启才生效，待下次会话量被拒次数；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261025-14 | fixed f6686f663（[#1734](https://github.com/qOeOp/trade/pull/1734)：检查与“重启为根”规则）；向用户告知重启是新规则另立 20261025-23；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261025-16 | fixed 4607cc3bc（#1746）；此前：9938b8ece（[#1730](https://github.com/qOeOp/trade/pull/1730)）已给原因，但 v6 运行（trial 67）仍提示必被 `RUNTIME_UNSUPPORTED` 拒的 `replay reproduce`（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261025-18 | open；[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：主会话 43,624→441,724 token、09:59:43Z 压缩；全部线程 57.8M 输入，缓存 98.3%；[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：35 次请求，输入 4.85M（缓存 4.68M），输出 26.3K，最大上下文 197K，无压缩；[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)：40 次请求，输入 5.10M（缓存 4.89M），输出 30.1K，最大上下文 226K，无压缩；[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)：主会话 353 次请求，输入 84.75M（缓存 97.8%），输出 355K，最大上下文 449,593，两次压缩；四个分叉子会话另 20.17M | open [v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md) |
| 20261025-06 | recurred（变体，[全产品审计](2026-10-29-whole-product-audit.zh.md)：9a19 两次提问后各两轮自动续跑再 blocked，原因改为提问前未暂停，`research-round/SKILL.md:92-101`）；fixed d3f0d8fdd（#1705，会话前已合 main，但会话检出 `8c5cd561f` 不含它；完整审计 unobserved）；用户已确认宿主权限边界，skill 与文档已本地修订，新增离线评测 with 3/3、原用例回归 with 1/1，均实际触发，见[实施记录](../goal-host-pause-boundary.zh.md)；仍待合入后的真实宿主场景验证；本次有 Goal 时提问未空转（修复未合入，不算验证，[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | recurred [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261025-01 | fixed 7e5118a4e（[#1679](https://github.com/qOeOp/trade/pull/1679)）；隔离历史快照导出并经原生 read_market 读取的回归通过，全量 514 项无跳过；仍待合入后真实旧市场提交研究路径观察；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261025-10 | open；[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)：账本 70 个研究试验搜过 BTCUSDT `[2025-10-01, 2026-10-01)`（钉 `l1kfbo4…`），在活动 `gc305h7…` 上新开同窗口线时 `trials_on_line` 从 0 计；新旧提交该窗口数据是否一致未量；[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)：会话未开新线，unobserved | open [v7 卡线](2026-10-25-codex-v7-stranding.zh.md) |
| 20261025-11 | fixed 9ea3d12a9（[#1685](https://github.com/qOeOp/trade/pull/1685)：只比导出内容与选择，源码哈希继续记录）；全量 512 项无跳过，导出器源码单独变化可比／重建及内容变化仍拒绝的回归通过；仍待真实跨导出器变更研究观察；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261025-08 | fixed 324bc82bb（[#1682](https://github.com/qOeOp/trade/pull/1682)：AGENTS.md 写明 PR 基于 main、不叠 PR）；未另做行为评测或研究会话验证；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261022-11 | skill 部分已随 #1639 合入；fresh 复算代理随 #1646 / 9a517d545；审阅命中率与无条件复现的价值仍待测 | fixed 9a517d545 [#1646](https://github.com/qOeOp/trade/pull/1646) |
| 20261023-02 | fixed 10bd4bfa5（#1644：status 列 without_economic_evidence、`--at` 报告标注 head 已无资格、skill 点名撤回；eval 3/3）；待真实会话验证；unobserved（[v7 卡线](2026-10-25-codex-v7-stranding.zh.md)）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)）；[全产品审计](2026-10-29-whole-product-audit.zh.md)：列出部分 verified（9a19 03:35Z status 列 218，Agent 向用户点名），撤回部分 unobserved | unobserved [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261023-06 | fixed 9a517d545（#1646：两条规则改标 AGENTS.md、补 #1641 eval）；#1644 新规则的设计站条目见本 PR；unobserved（[v7 卡线](2026-10-25-codex-v7-stranding.zh.md)）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261023-07 | open；[v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)一次压缩后重读 research-start 四个文件与宿主记忆一次；[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：无压缩；第三轮开头重读 research-start SKILL 与 readiness 约 20 KB；[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)：无压缩、无重读；[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)：两次压缩；`readiness.md` 读 14 次、research-start SKILL 5 次，与压缩的对应未逐一核对 | open |
| 20261020-38 | recurred（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：六个审查者都读宿主记忆 `~/.codex/memories/MEMORY.md`，带入以往审查结论；动作改 skill：审查者不读宿主记忆）；fixed ab7a0f4fa（#1744：审查者不读宿主记忆）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）（本会话无子代理）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261020-39 | open | open |
| 20261020-40 | open；2026-10-22 会话未复发（预检在月界、≤7 天） | open |
| M1 | fixed ddc7b9904（[#1806](https://github.com/qOeOp/trade/pull/1806)：同 20261027-08，`funding.event_times_ms` 已去掉，结算时间由 `market bars` 读；BTCUSDT 与 WIFUSDT `[2021-01-01, 2026-10-01)` 的输出 6,787 字节）；此前：recurred（[EMA12 审计](2026-10-21-ema12-autonomous-audit.zh.md)：12 币 13 个月输出 379,418 字节，去掉资金费时间戳后 23,462 字节，同一查询重跑一次；200 合约仍未量；输出未变，现由 `--help` 说明该字段占大部分输出，[回读](2026-10-25-ema12-audit-recheck.zh.md)）；[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：c16 仍以 jq 删 `funding.event_times_ms` | fixed ddc7b9904 [#1806](https://github.com/qOeOp/trade/pull/1806) |
| M2 | open | open |
| 20261021-03 | fixed 9fd3adce8（#1647：video-evidence 两个设计页中英文上线，公开页 200、导航有链接；[回读](2026-10-25-ema12-audit-recheck.zh.md)）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261021-07 | open；未证明经济暴露影响审阅结论 | open |
| 20261021-13 | fixed 271e8bcc9（#1625；未逐项复核）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261021-14 | fixed 271e8bcc9（#1625；未逐项复核）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261021-15 | fixed 271e8bcc9（#1625；未逐项复核）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261021-16 | fixed 271e8bcc9（#1625；未逐项复核）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261021-19 | fixed 271e8bcc9（#1625；未逐项复核）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261021-20 | fixed 95672ebd3（#1628 改了 `docs/rd/map.json` 的旧标题；[EMA12 审计](2026-10-21-ema12-autonomous-audit.zh.md)与[回读](2026-10-25-ema12-audit-recheck.zh.md)实读公开归因页已无旧处方与自动消融标题；hover 与视觉未测）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261021-22 | fixed 271e8bcc9（#1625；未逐项复核）；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261021-23 | open；[三任务复审](2026-10-21-three-workstream-validation.zh.md)确认历史分页可读旧判断，但普通report/state未展开自由文本更正；先测新读者能否经现有关系发现，不改检查/权限/schema | open |
| 20261021-25 | open；未改变检查、权限或存储结构 | open [复审](2026-10-21-economics-duties-pa.zh.md) |
| 20261025-1686 | fixed a4e635461（[#1686](https://github.com/qOeOp/trade/pull/1686)）；定向 14 项无跳过、最终 PR CI 514 项无跳过，隔离单机合成报价 OCI 验收的有效配置及七类报告指纹一致，见[实施记录](../replay-determinism-boundary.zh.md)；仍待真实研究会话验证，不代表真实全年行情、跨主机或全部订单机制通过；unobserved（[完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)）；unobserved（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)）；unobserved（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)）；unobserved（[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)） | unobserved [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261021-26 | open；[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：研究会话读账本前读 `~/.codex/memories/MEMORY.md` 三次并在两次回答中引用；结论另有账本支持；[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)：读宿主记忆 11 次、三轮回答都带记忆引用，并用 Codex 线程工具读另一会话 rollout（01a173bd）；[01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)：recurred：主会话 22 次 `rg` 宿主记忆，19 轮回答全带记忆引用，读到本会话自身的自动摘要与一条已过时的“历史回补被拒”说法 | open [EMA12 审计](2026-10-21-ema12-autonomous-audit.zh.md) |
| 20261021-28 | open | open [EMA12 审计](2026-10-21-ema12-autonomous-audit.zh.md) |
| 20261021-29 | open | open [EMA12 审计](2026-10-21-ema12-autonomous-audit.zh.md) |
| 20261029-11 | open（用户 2026-10-29 批准） | open [整合评审](2026-10-29-consolidation-review.zh.md) |
| 20261029-13 | open（用户 2026-10-29 批准） | open [整合评审](2026-10-29-consolidation-review.zh.md) |
| 20261029-14 | open（measure，不动） | open [整合评审](2026-10-29-consolidation-review.zh.md) |
| 20261029-15 | open（用户 2026-10-29 批准） | open [整合评审](2026-10-29-consolidation-review.zh.md) |
| 20261029-16 | fixed c964a009f（`market/coverage.py:28-31` 的 interpretation 已写零成交、缺资金费为输入事实）；skill 改指针半项未核；unobserved（[全产品审计](2026-10-29-whole-product-audit.zh.md) 交叉复核） | unobserved [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261029-17 | open（用户 2026-10-29 批准；并入 20261025-24 / 20261027-09 跟踪）；文档面：`library.zh.mdx:5` 仍只列模板根与用户根、漏已批准的 Agent 原创根（[Codex 17](2026-10-29-doc-product-issues.zh.md#20261029-17)） | open [整合评审](2026-10-29-consolidation-review.zh.md) |
| 20261029-18 | open（用户 2026-10-29 批准） | open [整合评审](2026-10-29-consolidation-review.zh.md) |
| 20261029-19 | open（用户 2026-10-29 批准） | open [整合评审](2026-10-29-consolidation-review.zh.md) |
| 20261029-20 | open（暂缓） | open [整合评审](2026-10-29-consolidation-review.zh.md) |
| 20261029-21 | open（暂缓） | open [整合评审](2026-10-29-consolidation-review.zh.md) |
| 20261029-25 | in PR [#1880](https://github.com/qOeOp/trade/pull/1880)；663 项完整测试通过；本机副本已保留旧历史后恢复、SSE ready；未合并 | in PR [#1880](https://github.com/qOeOp/trade/pull/1880) |

## 已结表转换前的处理格

| id | 转换前处理 | 转换后状态 |
|---|---|---|
| 20261029-07 | fixed 89faf6f19（#1849）；verified [全产品审计](2026-10-29-whole-product-audit.zh.md)：9a19 会话合入后登记 40 s、trial 218 回放 5.9 min，未复发 | verified [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261029-01 | fixed e6ce61c8f（#1830，起线与暴露）+ fbf1f83cd（#1856，经济资格第三消费者，判断收进 `ledger/review_activity.resolved`）；verified [全产品审计](2026-10-29-whole-product-audit.zh.md)：9a19 会话 02:24Z 起线、03:27Z 登记通过，03:35Z `research status` 复发后 #1856 合入，04:20Z 判断 273 重读 218 可见 | verified [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261029-03 | fixed 7504ecb14（#1832）；verified [全产品审计](2026-10-29-whole-product-audit.zh.md)：整合评审与本审计按第 5 步给出以 remove/重述/none 为主的处置，净变化为负 | verified [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261027-09 | fixed e052b67e6（#1804）；recurred 后 verified [全产品审计](2026-10-29-whole-product-audit.zh.md)：两会话首问选项均可立即起线并带 Goal，第 2 轮内开始预检（9a19 +6.9 min、f5ec +10.2 min） | verified [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261025-24 | 四次复发后 verified [全产品审计](2026-10-29-whole-product-audit.zh.md)：两会话首问选项均可立即起线并带 Goal，第 2 轮内开始预检；后续规则已由 #1840 并成一条 | verified [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261028-10 | fixed c802ed944（#1822）；verified [全产品审计](2026-10-29-whole-product-audit.zh.md)：trial 213（载入前失败）存在时，同源码 03:27Z 登记通过 | verified [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261028-13 | fixed 85dad16fd（#1826）；verified [全产品审计](2026-10-29-whole-product-audit.zh.md)：trial 215（2020-09，BTC≈1 万）4 次成交，218 全窗口 87 个计划有成交 | verified [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261027-10 | fixed 4bb3f321c（#1805）；verified [全产品审计](2026-10-29-whole-product-audit.zh.md)：两会话读到 `quotes.imports`/`uncovered_intervals_ms` | verified [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261027-08 | fixed ddc7b9904（#1806）；verified [全产品审计](2026-10-29-whole-product-audit.zh.md)：两会话读到 `funding.spacing`/`missing_settlements` | verified [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261026-06 | fixed 508613de4（#1778）；verified [全产品审计](2026-10-29-whole-product-audit.zh.md)：两会话从 `research state` 读 `ledger_commit` 正常 | verified [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261020-21 | fixed 69f3508d5（#1748）；verified [全产品审计](2026-10-29-whole-product-audit.zh.md)：9a19 预检前 fetch+merge-base+porcelain 并换到 origin/main worktree，`run_sealed(218).metrics_revision = 89faf6f19` | verified [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261028-01 | fixed e0fe58aa3（#1818）；verified [全产品审计](2026-10-29-whole-product-audit.zh.md)：两会话按规则选 bars、无取证螺旋；两会话都未写最小强平距离（执行遗漏，none） | verified [全产品审计](2026-10-29-whole-product-audit.zh.md) |
| 20261028-06 | fixed b8359c752（#1807）；verified [01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md)：会话经 `market coverage` 读 terms | verified [01a18327 审计](2026-10-29-codex-01a18327-full-audit.zh.md) |
| 20261025-15 | verified [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)：fixed 3385e025a（#1728）；路径走到，执行环境规则存在并被引用，原失败未复发；规则本身的问题见 20261028-01 | verified [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261026-05 | verified [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md)：fixed fd94a68c7（#1776）；干净检出检查执行，`git status` 只列 IDE 文件与 `.codex/`，`bun.lock` 未再出现 | verified [01a17cec 审计](2026-10-28-codex-01a17cec-full-audit.zh.md) |
| 20261026-03 | verified [01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)：fixed 921b28778（#1774，在会话检出内）；会话对活动 head 的 18 个零成交量分钟只说明“不是缺失数据”、不提问；measure（coverage 是否列零成交量区间）未见复发，不再追 | verified [01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md) |
| 20261026-07 | verified [01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)：fixed efa562d17（#1779）；main CI 40464946696 以 `default,always::ResourceWarning` 跑 591 项无警告行，mypy 读 pyproject 共 87 个源文件含 `paper` | verified [01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md) |
| 20261025-25 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed 88dd33b78（#1749）；`research status` 每行带执行身份，v7 非支配只有 200/207，Agent 只按 v7 向用户比较 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md) |
| 20261025-26 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed 50e17d7a2（#1742）；保真测试中账本图已无 kept_reference | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md) |
| 20261025-27 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed 592987df1（#1753）；49 个子命令都有 reads/writes/returns 块；残余 help 漂移另立 20261026-06 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md) |
| 20261025-28 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed 999fc4566（#1755）；会话用 `market bars` 导出，未写脚本导入内部模块 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md) |
| 20261025-17 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed e573724db（#1747）；三类大输出都重定向到文件、只取键 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md) |
| 20261025-19 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed ca82c599b（#1729）；换线时读了 selection、跑了 `candidate list`；选项问题归 20261025-24 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md) |
| 20261025-13 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed db9dafd89（#1727）；只就窗口内的异常提问；规则本身另见 20261026-03 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md) |
| 20261025-20 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：fixed 020bbe3a3（#1736）；回补历史在用，未复发；回补路径带出 20261026-01 | verified [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md) |
| 20261026-02 | 并入 20261025-24（[01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md)：同一根因，选项不是可登记的线；Goal 在 `line select` 前不建符合 research-start，不是成因） | 并入 20261025-24 [01a173b3 审计](2026-10-26-codex-01a173b3-full-audit.zh.md) |
| 20261025-31 | rejected：用户 2026-10-25 定继续在公开账本保存来源论文全文，不改 | rejected [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md) |
| 20261022-03 | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：fixed d560896a7；真实旧契约入口关旧线、在 v7 新开，未跨契约重建 | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md) |
| 20261025-03 | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：fixed 0784c9d8a；`research state` 给 `RUNTIME_UNSUPPORTED`，Agent 明说不能续跑并关线 | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md) |
| 20261025-04 | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：fixed d560896a7；新线按 changes.md 从有实质改动的版本开始，未改无关字节 | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md) |
| 20261025-05 | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：fixed 324bc82bb；10:03Z 授权说明写明是产品登记规则的拒绝检查及现拒什么 | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md) |
| 20261022-13 | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：fixed ebc4772af；六次源码审查逐项追溯订单输入时间，全部 passed，无前视 | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md) |
| 20261022-16 | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md)：fixed 9a517d545；先读 `replay reproduce --help`，把 201 记为复现的 explore trial | verified [完整审计](2026-10-25-codex-v7-restart-full-audit.zh.md) |
| 20261025-21 | rejected：用户 2026-10-25 先授权后撤回，暴露检查不变；市场有完整历史后线一次声明长窗口，后续检验进样本外 | rejected [v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md) |
| 20261022-10 | verified [v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)：fixed 10bd4bfa5（#1644）；本次第五次比较不变后触发，停止登记并回问；回问只给同方向两项，另立 20261025-19 | verified [v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md) |
| 20261023-04 | verified [v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)：fixed 9a517d545（#1646）；六次预检各派新的审查子代理，未跨版本复用 | verified [v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md) |
| 20261023-03 | verified [v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md)：fixed a42866e9f（#1645）；推荐只在首报后与 REVIEW_DUE 时写（judgment 270），每次运行只写解读与优先级 | verified [v7 重启跟读](2026-10-25-codex-v7-restart-attach.zh.md) |
| 20261025-02 | rejected：用户 2026-10-25 定：契约升级即关闭旧线、在新契约上新开，不改代码、不删检查；新发布的候选自动带 v7，此检查不挡新开路线，暂不动 | rejected [v7 卡线](2026-10-25-codex-v7-stranding.zh.md) |
| 20261025-07 | none：#1680 已关闭（用户 2026-10-25），其连续性主张不再需要证明 | none [v7 卡线](2026-10-25-codex-v7-stranding.zh.md) |
| 20261023-01 | fixed 10bd4bfa5（#1644）；verified [v7 卡线](2026-10-25-codex-v7-stranding.zh.md) | verified [v7 卡线](2026-10-25-codex-v7-stranding.zh.md) |
| 20261023-05 | fixed 9a517d545（#1646）；verified [v7 卡线](2026-10-25-codex-v7-stranding.zh.md) | verified [v7 卡线](2026-10-25-codex-v7-stranding.zh.md) |
| M3 | fixed a42866e9f（#1645）；verified [v7 卡线](2026-10-25-codex-v7-stranding.zh.md) | verified [v7 卡线](2026-10-25-codex-v7-stranding.zh.md) |
| 20261022-09 | #1639 / c20890092；hypothesis.md 消费者核对通过（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） | fixed c20890092 [长 Goal](2026-10-23-codex-ema-long-goal.zh.md) |
| 20261022-12 | #1639 / c20890092；消费者核对通过（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） | fixed c20890092 [长 Goal](2026-10-23-codex-ema-long-goal.zh.md) |
| 20261022-15 | #1639 / c20890092；main CI 39801200436 测试日志无泄漏，mypy 无 note（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） | fixed c20890092 [长 Goal](2026-10-23-codex-ema-long-goal.zh.md) |
| 20261022-17 | #1639 / c20890092；消费者核对通过（[长 Goal](2026-10-23-codex-ema-long-goal.zh.md)） | fixed c20890092 [长 Goal](2026-10-23-codex-ema-long-goal.zh.md) |
| 20261022-14 | rejected：用户 2026-10-22 暂不加；research-round 中“账本及其备份是研究记录”一句作为 AGENTS.md 重复删去 | rejected [EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md) |
| 20261021-24 | none：用户 2026-10-22 定问题在于是否重复记录；该句不重复 AGENTS.md，保留（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） | none [复审](2026-10-21-economics-duties-pa.zh.md) |
| 20261022-04 | #1636 / 8d3afd2ed；后续会话统一 trial 编号与预检缓存运行正常（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） | fixed 8d3afd2ed [EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md) |
| 20261022-05 | #1636 / 8d3afd2ed；后续会话统一 trial 编号与预检缓存运行正常（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） | fixed 8d3afd2ed [EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md) |
| 20261021-04 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） | fixed 271e8bcc9 [EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md) |
| 20261021-05 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） | fixed 271e8bcc9 [EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md) |
| 20261021-06 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） | fixed 271e8bcc9 [EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md) |
| 20261021-08 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） | fixed 271e8bcc9 [EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md) |
| 20261021-09 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） | fixed 271e8bcc9 [EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md) |
| 20261021-12 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） | fixed 271e8bcc9 [EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md) |
| 20261021-17 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） | fixed 271e8bcc9 [EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md) |
| 20261021-18 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） | fixed 271e8bcc9 [EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md) |
| 20261021-21 | #1625 / 271e8bcc9；主线抽查确认（[EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md)） | fixed 271e8bcc9 [EMA 定仓分叉](2026-10-22-codex-ema-sizing-forks.zh.md) |
| 20261022-06 | 随 [#1637](https://github.com/qOeOp/trade/pull/1637) 交付；[独立复审及验收](2026-10-22-complete-profit-acceptance.zh.md)通过，活动历史未改 | fixed [独立复审及验收](2026-10-22-complete-profit-acceptance.zh.md) |
| 20261022-07 | 随 [#1637](https://github.com/qOeOp/trade/pull/1637) 交付；[独立复审及验收](2026-10-22-complete-profit-acceptance.zh.md)通过，活动历史未改 | fixed [独立复审及验收](2026-10-22-complete-profit-acceptance.zh.md) |
| 20261022-08 | 随 [#1637](https://github.com/qOeOp/trade/pull/1637) 交付；[独立复审及验收](2026-10-22-complete-profit-acceptance.zh.md)通过，活动历史未改 | fixed [独立复审及验收](2026-10-22-complete-profit-acceptance.zh.md) |
| 20261022-01 | [#1633](https://github.com/qOeOp/trade/pull/1633) / d0564c949；437 tests、PR CI、六组原生配对及主线镜像年度长持仓回放通过；历史无效运行保留 | fixed d0564c949 [#1633](https://github.com/qOeOp/trade/pull/1633) |
| 20261022-02 | [#1633](https://github.com/qOeOp/trade/pull/1633) / d0564c949；结构回归与原生配对通过，稀疏零交易报告保持支持 | fixed d0564c949 [#1633](https://github.com/qOeOp/trade/pull/1633) |
| 20261020-01 | #1594 | fixed [#1594](https://github.com/qOeOp/trade/pull/1594) |
| 20261020-02 | #1593 | fixed [#1593](https://github.com/qOeOp/trade/pull/1593) |
| 20261020-03 | #1594 | fixed [#1594](https://github.com/qOeOp/trade/pull/1594) |
| 20261020-04 | #1598 | fixed [#1598](https://github.com/qOeOp/trade/pull/1598) |
| 20261020-05 | #1601 | fixed [#1601](https://github.com/qOeOp/trade/pull/1601) |
| 20261020-06 | #1598、#1601 | fixed [#1598](https://github.com/qOeOp/trade/pull/1598) |
| 20261020-07 | #1598、#1601；阶段日志截断 #1604 | fixed [#1598](https://github.com/qOeOp/trade/pull/1598) |
| 20261020-08 | #1598；git 调用超时 #1604 | fixed [#1598](https://github.com/qOeOp/trade/pull/1598) |
| 20261020-09 | #1601 | fixed [#1601](https://github.com/qOeOp/trade/pull/1601) |
| 20261020-10 | #1601 | fixed [#1601](https://github.com/qOeOp/trade/pull/1601) |
| 20261020-11 | #1601 | fixed [#1601](https://github.com/qOeOp/trade/pull/1601) |
| 20261020-12 | #1601 | fixed [#1601](https://github.com/qOeOp/trade/pull/1601) |
| 20261020-13 | #1599；#1613 删说明后复发，随 -27 由 #1615、#1616 修 | fixed [#1599](https://github.com/qOeOp/trade/pull/1599) |
| 20261020-14 | #1599 | fixed [#1599](https://github.com/qOeOp/trade/pull/1599) |
| 20261020-15 | #1599 | fixed [#1599](https://github.com/qOeOp/trade/pull/1599) |
| 20261020-16 | #1599 | fixed [#1599](https://github.com/qOeOp/trade/pull/1599) |
| 20261020-17 | #1599 | fixed [#1599](https://github.com/qOeOp/trade/pull/1599) |
| 20261020-18 | #1599 | fixed [#1599](https://github.com/qOeOp/trade/pull/1599) |
| 20261020-19 | #1599 | fixed [#1599](https://github.com/qOeOp/trade/pull/1599) |
| 20261020-20 | #1599 | fixed [#1599](https://github.com/qOeOp/trade/pull/1599) |
| U1–U5 | #1598、#1601 | fixed [#1598](https://github.com/qOeOp/trade/pull/1598) |
| 20261020-22 | #1604、#1605；CI 遇 ResourceWarning 即失败 | fixed [#1604](https://github.com/qOeOp/trade/pull/1604) |
| 20261020-23 | #1606、#1607 | fixed [#1606](https://github.com/qOeOp/trade/pull/1606) |
| 20261020-26 | #1615 | fixed [#1615](https://github.com/qOeOp/trade/pull/1615) |
| 20261020-27 | #1615；骨架的定仓辅助 #1616 | fixed [#1615](https://github.com/qOeOp/trade/pull/1615) |
| 20261020-28 | #1616 | fixed [#1616](https://github.com/qOeOp/trade/pull/1616) |
| 20261020-29 | #1616（输出整条记录）、#1615（目标写入 `--note`） | fixed [#1616](https://github.com/qOeOp/trade/pull/1616) |
| 20261020-30 | #1618（START_REVIEW_REQUIRED） | fixed [#1618](https://github.com/qOeOp/trade/pull/1618) |
| 20261020-31 | #1615 | fixed [#1615](https://github.com/qOeOp/trade/pull/1615) |
| 20261020-32 | #1615 | fixed [#1615](https://github.com/qOeOp/trade/pull/1615) |
| 20261020-33 | #1615 | fixed [#1615](https://github.com/qOeOp/trade/pull/1615) |
| 20261020-34 | #1615 | fixed [#1615](https://github.com/qOeOp/trade/pull/1615) |
| 20261020-35 | #1615；改为产品固定停点 #1618；review_cadence 种类与 REVIEW_CADENCE_FIXED 删除 #1621 | fixed [#1615](https://github.com/qOeOp/trade/pull/1615) |
| 20261020-36 | #1618 | fixed [#1618](https://github.com/qOeOp/trade/pull/1618) |
| 20261020-37 | #1617、#1620；剩余见 20261021-03 | fixed [#1617](https://github.com/qOeOp/trade/pull/1617) |
| U6 | #1619（用户 2026-10-21 批准） | fixed [#1619](https://github.com/qOeOp/trade/pull/1619) |
| 20261029-12 | rejected（用户 2026-10-29）：`_untraded_review` 保留三个条件 | rejected [整合评审](2026-10-29-consolidation-review.zh.md) |

## 转换前的漏报表（原文）

用户在诊断之前指出的问题。每份记录的表头报告其数目，应降到零。

| id | 问题 | 用户指出 | 应发现的镜头 | 状态 |
|---|---|---|---|---|
| 20261029-01 | 用户追问“rollingref 不能跑了吗”：#1826 修好网格缺陷后，trial 214 仍让该源码既不能登记也不能起线 | 2026-10-28（研究会话中） | 产品契约（20261028-13 的诊断未沿消费者核对修复后候选能否继续） | 见 20261029-01 |
| 20261027-09 | 用户跟读中指出：research-start 之后在设 Goal 之前动不动就停，要用户推一步走一步，体验不如以前（连续第四次启动未进入研究） | 2026-10-27（跟读时） | 行为与决策（未核对首问选项能否立即登记、是否带 Goal 目标）；完整审计另见产品契约（readiness 取证无停止条件，20261028-02） | open（20261027-09；20261025-24 第四次复发） |
| 20261027-02 | 用户会话后指出：research-start 后应直接开始研究，不该再抛一堆问题、还要改代码，“这又是一次投研启动失败”（第三次连续启动未进入研究） | 2026-10-27 | 产品契约（10-26 市场库替换决定记录了旧提交上的试验与线不再复现，未沿消费者追到研究入口：`research state` 不报、skill 无出口） | open（20261027-02） |
| 20261026-02 | 用户指出研究会话三轮、三次等回复，始终没有 Goal、研究没开始 | 2026-10-26（跟读时） | 行为与决策（未核对面向用户的选项能否立即执行） | 并入 20261025-24，open；20261025-24 再复发后由 20261027-02 跟踪（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)） |
| 20261026-03 | 用户指出零成交量没处理：核实与官方一致后仍报成因与经济影响未知 | 2026-10-26（跟读时） | 产品契约（未检查 skill 规则能否了结、与产品自身的输入说明是否一致） | fixed 921b28778（#1774）；verified（[01a17bd9 审计](2026-10-27-codex-01a17bd9-full-audit.zh.md)） |
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
| 20261029-31 | 用户要求「doctor 本身如果不是好医生同样要迭代」：索引不可读、审计自身成本从不记录、同一镜头五次漏同类检查，doctor 自己没有量过 | 2026-10-29（本次审计的题目；20261029-03 同源） | 产品契约（对 skill 自身的审查） | 见 20261029-31 / -32 / -33 |
