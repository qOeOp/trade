# 2026-10-25 v7 重启研究会话完整审计（Codex 会话，事后独立复审）

按 product-doctor 全部步骤加 Convergence，对已结束的 Codex 研究会话 01a171e2 做一次完整、独立的审计。审计会话在不同宿主与模型族上运行，未读此前对同一会话的跟读记录与其结论；三个工作流各派一个 fresh 只读子代理，只给原始证据路径、检出与问题。另做账本保真测试（第二个 fresh 子代理只读 transcript 抽会话图）。只诊断，不改产品；需授权的项只列出。

| 项 | 值 |
|---|---|
| 会话 | local Codex Desktop（cli 0.164.0-alpha.11.1，gpt-6.1-sol），`rollout-2026-10-25T16-06-41-01a171e2-0813-70f0-b1eb-5c8e8095c13c.jsonl`，2026-10-25T07:06:41Z–10:08:22Z；7 个子会话（`01a171ff`、`01a17211`、`01a1721e`、`01a1722a`、`01a1723e`、`01a1725b` 为预检 199/202/204/206/208/210 的源码审查，`01a17204` 关旧线），工作目录 `~/.codex/worktrees/b6c8/trade` |
| 审计会话 | Claude Code desktop，claude-opus-5-5，会话 id 宿主未显示（worktree `doctor-full-audit-01a171e2-b1c613`）；四个 fresh 子代理（行为、数据与成本、产品契约、会话图抽取），均为同一模型 |
| 检出 / 账本 | 会话检出 `8c5cd561f`（未合入的 `fix/graph-scatter-selection-replay-align` 分支提交，远端分支已删；当时 main `5d1ebea4e`）；当前产品 `origin/main` `41f9cea2d`。活动账本 `research` 自 `27j95akjrt0ge9dm70ek52la248tnk1a` 至 `odeo1h7mc6e429dohb6qrjt6vd89eusi`（68 个提交，现仍为 head）；市场固定 `l1kfbo4b2of54ijpjnpn02ijdm175aqd` |
| 覆盖 | 行为与决策：主会话全部用户轮、关键调用与输出、子会话开头与结论、六个候选的源码与登记、五次 `hypothesis compare` 只读复算、`research state` 在建线提交与 head 的对照。数据与成本：68 个账本提交逐个对到命令与行变化、证据大小、指纹、备份与 DoltHub head、`server.log`、进程采样与 trade-ide 事件日志、八个 rollout 的 token 与输出量、阶段耗时；发布单测 6/6（Dolt 2.4.2 一次性服务）。产品契约：全部 43 个 CLI 子命令 `--help`、拒绝与闸门分类、7 个 skill 对照 Anthropic 规范、ruff/mypy/548 项单测、main 最新 quality/docs-pages/镜像 CI 日志、wheel 内容、已发布设计站 CLI 页、方法文献（Ledoit-Wolf 2008、Nosek 2018 全文；DSR、PBO、White、Hansen 仅摘要）。保真测试：账本图与会话图均过 `ide.py check`，差异逐条分类。**未查**：子会话派发简报为密文；审查者推理全过程；trial 203–211 的登记细节只读了变更、父与对照；eval 未运行；180 个拒绝码中未引用的部分、`engine/audit.py`/`paper.py`/报价执行路径、`report/measures.py`/`attribution.py`、IDE 前端；会话期间数据库物理增长（无基线）；`server.log` 08:54Z、09:53Z 的市场错误未归因；修复后 IDE 轮询期间的发布竞争未现场重测 |
| 用时构成 | 主研究轮 07:31:25–09:45:16（2 h 14 min）：六轮迭代各 12–32 min，其中回放计算合计约 5 min，独立源码审查每次 4.4–6.4 min 为最大机器阶段；用户思考 07:08–07:31（23 min）；09:01:44–09:16:50 单个推理项 15 min（归因未知）；发布被拒的排查与重试约 13 min；换线后的只读核验与讨论 09:46–10:08 约 20 min，所给方案最终不可登记。研究、发现、等待的完整细分未逐段计 |
| 产品导致的无效试验 | 0（trial 199–211 全部 passed）；但整条线以一个没有对照的替代规则为基准（-23） |
| 新发现按动作 | fix 5（-25 的标注部分、-26、-27、-29、-30）/ skill 3（-23、-24、-28）/ authority 3（-25 的口径部分、-31、-34）/ measure 3（-32、-33、-35）/ none 0；另更新既有项 -16（残留，fix）、-17（改为 skill）、20261020-21（复发）、20261020-38（复发） |
| 复发项 | 20261020-21（`metrics_revision` 指向未合入分支提交）、20261020-38（审查子代理读宿主记忆） |
| 用户先发现 | 0 |
| skill 体积 | 各 skill 目录 `.md` 空白分词（与上份记录同口径）：research-round 8,530（+137，#1728 执行环境选择）、research-start 2,556（+147，#1705 Goal 暂停、#1727 readiness、#1729 换线列线、#1734 重启为根）、product-doctor 2,555、nautilus-report-analysis 2,125、research-sources 1,925、video-evidence 4,830、research-graph 315（上份未计） |

## 经过

07:06Z research-start 读出唯一一条线停在 v6（`RUNTIME_UNSUPPORTED`），给出 A（固定量基线）/B（条件数量 `ema-entryvar@2`）两项，都说“需先完成实质性适配”。用户 07:31Z 选 B，建 Goal。B 的字节在 v7 不能原样重跑（`SOURCE_EXISTS`、暴露检查），Agent 自拟新假设 `ema-entryvar-rollingref@1`（滚动 200 日方差参考），按 v6 父派生登记、对照为空，E1 预测注明不可检。07:35:52Z 就 37 个预热零成交分钟提问，未等回答已加证据、跑预检 199。trial 200 成为工作参考，此后五个变体（203 逆波动、205 固定 0.4 BTC、207 入场名义预算、209 持有只减、211 不利半方差）各对 200 比较，差值都小于可检出差，回撤除 207 外都是 8.47%（同一段回撤期都顶在 0.4 BTC 上限）。两次 `PUBLISH_REJECTED` 后普通重试成功。09:41Z 换线条件到期，Goal 完成；Agent 推荐“冻结策略换更长窗口”，用户同意并选 BTC 2022–2024，随后先后发现暴露检查与市场只能向后追加两道阻塞。10:07Z 用户结束研究，先修产品。

## 发现（按会话代价与影响面排序）

| id | 发现 | 证据（会话；当前产品；消费者与决策） | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261025-23 | 用户选“以旧契约候选 B 重启”时，research-start 不告诉用户 B 的规则本身不能在新契约上原样再测；重启只能是一个新规则，且首报没有可比对照 | 会话：07:08Z 选项只说“实质性适配”；07:33:52Z Agent 自拟滚动参考并注明 E1 不可检；登记 `registration-ema-entryvar-rollingref-v7-20261025` 父为 v6、对照为空。当前：`ledger/strategies.py:92-95` `SOURCE_EXISTS`，`registration/register.py:435-488` 暴露检查按源码全局；research-start `SKILL.md:24-32`（#1734 后）规定重启为根、无对照，但选项一节不要求向用户说明。消费者：用户的“选B”实际执行成另一条规则；trial 200–211 都以未经比较的 200 为基准 | skill（列出旧契约候选作为重启方向时，写明重启是新规则、首报无对照、旧规则的结果不能再测；暴露检查用户 2026-10-25 已定不改） | 实测：整条线 2 h 的比较都以替代规则为锚；用户的选择未按其理解执行（推断） | open |
| 20261025-24 | 换线时给出、并推荐了产品必拒的方案：冻结源码换窗口（暴露检查）与市场库没有的多年历史 | 会话：约 09:45Z 给 A（冻结 trial 200 换范围），09:56Z 才查到 `SOURCE_ALREADY_EXPOSED`，10:03Z 仍推荐并另列授权；10:06Z 查到不能补更早月份；10:07Z 用户结束。当前：`ledger/lines.py:85-140` `select_line` 只查审阅、不查起点能否登记；`register.py:448-487` 随后必拒；`market/store.py:598-603` 只收下一个月；#1729 让 research-start 列出“其他候选可开的线”，范围更宽。外部规范：Nosek et al. 2018（PNAS，10.1073/pnas.1708274114）把在既有数据上的检验视为需计入的再用；产品选择禁止而非计数，但这一选择在用户选范围前看不到 | skill（列线前确认起点在所选窗口可登记、市场覆盖所需月份；冻结规则换窗口只能走样本外验证，按用户 2026-10-25 的决定：长窗口一次声明，后续检验进样本外）。`line select` 增加同一检查是收紧拒绝，需授权，非必需 | 实测：约 20 min 与两次用户决定花在不可登记的方案上，会话无新线收场 | open |
| 20261025-25 | 一条线的比较表、`non_dominated`、推荐必列对象与 `research state` 的未复核清单不按执行身份分开：v7 新线混入 45 个不能再跑的 v6 候选 | 会话：推荐 259/270 按 `RECOMMENDATION_INCOMPLETE` 各列 45 个 v6 对象（97 行中 90 行），正文不得不声明“不是跨不兼容执行身份的排名”；07:43:56Z 新线 `research state` 列 64 个 v6 trial 为未复核，Agent 读 review.md 与 `REVIEW_DUE` 代码后才绕开。当前：`report/status.py:245-277` 只按窗口与 universe_rule 取行，不看契约、执行环境、输入键；`research status` 现 51 行、`non_dominated` 为 v6 的 61/64/118/121/127/137/162/196 与 v7 的 200/207，v7 的 209 被 v6 的 76/121/162/196 支配，行内无契约字段；`ledger/judgments.py:100-105` 必列全表；`ledger/lines.py:177-198` `line_trials` 按市场提交加窗口取，`research state --at acir1u71…` 给 64 个未复核。与 research-start `SKILL.md:30-31`“旧契约运行不能重放也不能比较”冲突 | fix（每行标注契约与执行环境，`non_dominated` 只在同一身份内算；派生，不加存储字段）+ authority（必列对象与未复核清单只含可比运行，改的是 `RECOMMENDATION_INCOMPLETE` 的口径）；试验计数仍按同一段数据全计（与 20261025-10 分开） | 实测：两条推荐各 45 个无关对象、`research status` 比较部分 36 KB 被读 8 次；一次约 1 min 的绕行。估计：每次契约、镜像或执行环境变化后复现（#1722、#1731 已产生新镜像） | open |
| 20261025-26 | 研究图把最新推荐的每个 `about` 对象都标成“保留参考”（kept_reference），而 skill 要求推荐列出全表，于是 75 个版本里 50 个显示为保留参考 | 保真测试：账本图把 v7 四个子版本与 `ema-entryvar@2` 标 kept_reference，会话图据推荐 270 正文只保留 207；`judgment_subject` 中 270 只有 `about` 50 / `recommended` 1。当前：`report/graph.py:228,268` 把非推荐对象一律映射为 kept_reference；`services/ide/web/src/model/semantics.ts:8` 提示语“被最新推荐列为要保留的参考”；`.agents/skills/research-round/references/review.md:15` 要求对象覆盖全表。消费者：trade-ide 图与保真比较 | fix（去掉 kept_reference，或按对象角色如实命名为“被推荐提及”；不加存储字段） | 未见影响决策；图读者会把几乎所有旧版本当作保留备选 | open |
| 20261020-21 | 封存运行的 `metrics_revision` 记的是宿主检出 HEAD；本线六个正式运行都记 `8c5cd561f`，一个未合入、远端分支已删的提交 | 会话：工作目录检出 `8c5cd561f`（比当时 main 少 #1705 等提交）。账本：`run_sealed` 中 200/203/205/207/209/211 均为 `8c5cd561f…`，此前运行为 main 上的提交；`git ls-remote origin refs/heads/fix/graph-scatter-selection-replay-align` 为空，仅剩 `refs/pull/1707/head`。当前：`qualification/availability.py:57-61` 与 `ledger/metrics.py:698-704` 取 HEAD、不看工作树；运行镜像只带 `engine/`，读数在宿主算；`STALE_CHECKOUT`（`registration/validation.py:55-66`）只护样本外登记。上次以推送 `archive/metrics-revision-12849814c` 标签处理（已结项），本次复发。另：skill 由插件从主检出提供（07:20:53Z 由 `8c5cd561f` 快进到 `5d1ebea4e`），代码在 worktree；本次所有 skill 文本均为旧版，未见错配 | skill（readiness 确认检出是 `origin/main` 上的提交且工作树干净）+ measure（`research status` 报 `metrics_revision` 是否在 main 上）；对研究登记与封存加检出检查是新拒绝，需授权；为保住该提交补推归档标签需用户同意 | 未测到读数错误（两提交间读数相关代码只差 `ledger/refusals.py` 文案与 `report/graph.py`）；风险是信任边界依赖宿主检出诚实 | recurred |
| 20261025-27 | `--help` 不交付 CLI 与 skill 所承诺的契约：43 个子命令中 30 个无描述也无 epilog | 会话：主会话与审查者读产品 `.py` 89 次、调 `--help` 68 次；如 10:06Z 读 `market/store.py` 才知只收下一个月，07:31Z grep `register.py` 并试了不存在的 `research/state.py`。当前：`python -m cli.main --help` 称“each command's --help states its contract”，research-round `SKILL.md:16-17` 称 help 写明参数、写入与返回；`market import --help` 不提月份顺序，`research status --help` 不说 DSR 依赖的 `by_development_window`、`distinct_sources` | fix（help 写明各命令写什么、返回什么与主要拒绝条件） | 读源码的量已测；其中多少由 help 缺失引起未证 | open |
| 20261025-28 | 没有受支持的市场行情读取命令；源码审查要追溯每个价格输入的时间，审查者只好写脚本导入内部模块 | 会话：审查者 199 07:40Z 用 `ledger sql --ledger market` 被 `LEDGER_KIND` 拒（拒得对）；审查者 204 08:14Z、206 08:26Z `market export` 报 `USAGE_ERROR`；四个审查者改用 `PYTHONPATH=.` 脚本连 `market.store` reader 账号（10 个脚本，`market/export.py` 读 16 次）。当前：`market --help` 只有 init/backup/review/import/import-quotes/upgrade/publish/lifecycle/coverage；README 称 `cli/` 是 Agent 唯一入口 | skill（research-round 审查要求里写明取日线的受支持做法）或 measure（只读 `market sql` 是否符合 AGENTS.md“Code or Agent”） | 每次审查数分钟与数个脚本；未量化 | open |
| 20261025-29 | 评测用例 `validation-input-runtime-change` 留在仓库顶层 `evals/`，`claude plugin eval .agents` 看不到，却被设计站当作该验证规则的证据 | 当前：`evals/research-round/validation-input-runtime-change/` 存在，`.agents/evals/research-round/` 下没有；`docs/rd/design-skill-research-round.mdx:152`、`.zh.mdx:149` 引用。成因：#1674 新增后 #1676 从更早分支合入、只搬了已有用例 | fix（搬到 `.agents/evals/research-round/`；按 AGENTS.md 单独成 PR） | 无会话代价；该规则实际没有在跑的评测 | open |
| 20261025-30 | README 与设计站落后于产品：README 称市场“自 2020-01”且“R1 回放 37 个合约”；#1729、#1734 改了 research-start，设计页未更新 | 当前：`README.md:6`、`README.md:89-90`；`market coverage --symbols BTCUSDT` 显示 2025-01 之前缺失；`docs/rd/design-skill-research-start.*` 最后改动为 #1727；136 个评测中 50 个未被任何设计规则引用，含 `contract-restart-registers-root`、`old-contract-line-closes-not-continued`、`goal-host-pause-permission`。已发布站点与 `41f9cea2d` 一致（docs-pages 40187564433） | fix | 无会话代价；10:05Z Agent 曾对用户说补的数据“会进 dolt”，10:06Z 读代码后更正 | open |
| 20261025-31 | 公开账本收存 19 篇论文全文 PDF（共 28.97 MB，如 `moskowitz-ooi-pedersen-2012.pdf`、`moreira-muir-2017.pdf`），随 DoltHub 公开再分发；再分发权利未核 | 账本：`evidence ⋈ evidence_content` 中 `.pdf` 19 个，最大 `lim2019-arxiv.pdf` 6.27 MB。规则：AGENTS.md 要求账本存“来源原件”且全部公开；`research-sources/SKILL.md:64-78` 只要求读作者或权利人公开的副本，并把原件放进来源包。读取合法副本不等于有权公开再发布。本会话未新增 PDF（新增原件为 Binance 公开月档 3.79 MB） | authority（用户定：受版权保护的全文只存标识、获取回执、哈希与引用位置，还是继续全文公开） | 法律风险，未发生事件 | open |
| 20261025-32 | 每次写入都同步发布到 DoltHub，连续写之间 15–17 s | 账本 `created_at`：judgment 259→260 16.1 s、261→262 15.5 s、263→264 16.5 s、265→266 17.3 s、267→268 16.3 s；`ledger/publish.py` 注释“一次 DoltHub 推送约 10 s”。归因为推断，未分解 | measure（隔离账本有无远端各计一次写入耗时，再议多写脚本是否末尾发布一次；发布语义写在 AGENTS.md，改动需授权） | 估计：68 次写入约 15 min 阻塞 | open |
| 20261025-33 | 运行指纹含逐 UTC 日哈希，每个运行约 96 KB，产品只比较整体相等 | 账本：trial 200 `run.fingerprints` 95,320 B，全库 70 个运行 7.19 MB，本会话 0.58 MB（占逻辑增长 12%）。当前：`replay/reproduce.py:93`、`report/runs.py:324` 只比较整个字典；`by_utc_day` 只由 `engine/compare.py:98-128` 产出，无读者。移除测试：所护风险是定位复现失败的首个不同日；每表 `sha256` 已决定相等；本会话未触发 | measure（先确认首个不同日的定位价值；删字段需新镜像、子代理评审与用户授权） | 存储；低 | open |
| 20261025-34 | 若干授权与凭据规则不在 AGENTS.md 一处：research-round 另加“宿主进程终止或配置变更需授权”；research-sources 从主检出 `.env` 读 API key，该文件与交易所凭据同处 | 当前：`research-round/SKILL.md:10-11`；`research-sources/SKILL.md:14-20`；AGENTS.md 授权清单无前者；product-doctor 规定不读凭据，lenses.md 又要求经 research-sources 读文献（本次审计只用无 key 的 OpenAlex）。product-doctor 的存储字段逐项授权已由用户 2026-10-22 定保留（20261021-24），不再列 | authority（用户定这些规则放在哪里；不由诊断改） | 无会话代价 | open |
| 20261025-35 | DSR 读法里试验数 N 取全部计数试验，夏普方差 V 只取有经济证据的运行，两者不是同一总体 | 当前：`.agents/skills/nautilus-report-analysis/references/ratios.md`；`report/status.py:102-150` 计数口径。文献：Bailey & López de Prado 2014（JPM，10.3905/jpm.2014.40.5.094，仅摘要）。本会话未用 DSR | measure（先看两种口径下 DSR 是否改变任何结论） | 未知 | open |

### 既有项本次更新

| id | 本次证据 | 新状态 |
|---|---|---|
| 20261025-12 | `server.log` 07:46:58Z–09:25:49Z 约 25 次非快进推送被拒，只有 trial 200、207 两次到达 Agent；重试返回 `previous_head == head`。#1726 已合，发布单测 6/6 | fixed 6f26b4362；修复后 IDE 轮询下的发布未现场重测 |
| 20261025-22 | 进程采样：trade-ide 从 worktree `ide-agent-chat`（`4f57d811e`，无 READS）每 5–16 s 跑 `ledger sql SELECT 1`。#1732 已合 | fixed 41f9cea2d；长期服务若仍从旧检出运行，修复不生效，待下次会话量 `server.log` 被拒次数 |
| 20261025-14 | 检查与“重启为根”的 skill 规则随 #1734 合入；选项一节的告知另立 -23 | fixed f6686f663 |
| 20261025-13 | 触发条件已按 #1727 收窄；本会话问后未等回答就做了依赖答案的工作（07:37:26Z 加证据、07:37:49Z 预检 199），这部分行为的修复无法从本会话验证 | fixed db9dafd89 |
| 20261025-15 | #1728 已合 | fixed 3385e025a |
| 20261025-16 | #1730 给出原因，但对 v6 运行（如 trial 67）仍提示 `replay reproduce --trial-id 67`，而 `runtime/image.py:58-61` 对 v6 必拒 `RUNTIME_UNSUPPORTED`（`report/runs.py:256-262`） | open（fix：退役契约的运行说明该表在新产品下不可得） |
| 20261025-19 | #1729 已合；其列线范围更宽，带出 -24 | fixed ca82c599b |
| 20261025-20 | 用户 2026-10-25 改为先量全量历史体积，量后选回补（授权改月份顺序拒绝）；量的 PR #1733 未合 | in PR #1733 |
| 20261025-21 | 用户 2026-10-25 先授权后撤回，暴露检查不变：市场有完整历史后，线一次声明长窗口，后续检验进样本外 | rejected |
| 20261025-17 | 现测 `candidate list` 106,960 B（37,430 token）、`research state` 70,769 B、`research status` 63,992 B；07:06:52、07:07:15、07:07:36 三次读，约 28K token 留在上下文直到 09:59:43 压缩；07:36Z 起 Agent 改为重定向到文件取字段 | open（改为 skill：入口三读重定向到文件、只取所需键；估计省约 5M 缓存输入） |
| 20261025-18 | 主会话上下文 43,624→441,724 token，09:59:43Z 压缩至 62,042；主会话输入 45.0M、七个子会话 12.9M，总计 57.8M，缓存 98.3%；压缩前输出构成：skill 20%、产品源码 18%、`replay report` 12.5% | open（measure） |
| 20261020-38 | 六个审查者都读并引用宿主记忆 `~/.codex/memories/MEMORY.md`（全部线程 21 次、112K 字符，grep 词含 `causal|source review|precheck|EMA`），即带入以往会话的审查结论；派发简报仍为密文 | recurred（skill：审查者不读宿主记忆；记忆内容是否左右审查结论未证） |
| 20261025-06 | 修复 #1705（d3f0d8fdd）在会话前已合 main，但会话检出 `8c5cd561f` 不含它，所读 skill 为旧文本 | fixed d3f0d8fdd；本次 unobserved |
| 20261022-03、20261025-03、20261025-04 | 真实旧契约入口：`research state` 给 `RUNTIME_UNSUPPORTED`，Agent 07:08Z 明说不能续跑、关旧线（标签 `line/20261022-ema-cross-btc-daily`）、在 v7 新开线，未尝试跨契约重建或改无关字节 | verified 本记录 |
| 20261025-05 | 10:03Z 授权说明写明是“产品登记规则”的拒绝检查、现拒什么，并声明本次选择不授权改规则 | verified 本记录 |
| 20261022-13 | 六次源码审查逐项追溯订单输入时间（最小名义价用已完成日收盘），全部 passed；行为工作流复核源码无前视 | verified 本记录 |
| 20261022-16 | 07:47Z 前读 `replay reproduce --help`，解读 258 把 201 记为复现的 explore trial | verified 本记录 |
| 其余 fixed 行（20261023-02、20261023-06、20261025-01、-08、-11、-1686、20261021-03/-13/-14/-15/-16/-19/-20/-22） | 本会话未触及其路径（无遮罩、未开 PR、未用旧于报价表的市场提交与报价执行、未改导出器） | unobserved |

### 保真测试

账本图：`research graph --line research-line-20261025-ema-entryvar-rollingref-v7 --at odeo1h7m… --since 27j95akj…`（7.7 s）；会话图：fresh 子代理只读八个 rollout 抽取。两图 `ide.py check` 通过，`ide.py compare --until 2026-10-25T10:08:22.719Z` 的差异分类如下。

| 差异 | 类别 | 依据 |
|---|---|---|
| 账本多 68 个候选（旧线 v6 树）、trial 196、`ema-entryvar@2` 的父与审阅 | 可派生 / 抽取范围 | 账本图按起点谱系取成员；抽取者按约定只取本线 |
| rollingref@1 两条预测：账本 outcome 为空，会话为“不可检” | 可派生 | 登记无对照；解读 258 已写明不可检 |
| 4 个 v7 子版本与 `ema-entryvar@2` 的状态：账本 kept_reference，会话为空 | 读路径缺陷 | 见 -26 |
| 账本 22 个 eligibility_change | 可派生 / 范围 | 全为 2026-10-22 旧线审阅，在 `--since` 之前 |
| 会话多一个 line_change（关旧线） | 可派生 | 关线是 Dolt 标签，`ended_by` 指向新线；图只画本线选线 |
| 会话 6 个 other 事件（发布被拒与重试、readiness 原件包、末尾 review/publish） | 不是记录 | 宿主与发布状态；相应证据包已在账本 |
| 读数、资格、源码、比较、推荐 | 一致 | — |

未发现账本缺口：账本单独即可复原本次研究的版本、运行、读数、预测与判断。

## 移除清单

| 机制 | 所护风险 | 由谁覆盖 | 会话所见 | 提议 |
|---|---|---|---|---|
| `RECOMMENDATION_INCOMPLETE` 必列全表 | 推荐时悄悄漏掉可比候选 | 无 | 被遵守，但 90 个对象不可比，正文须逐条否认（部分仪式） | 保留，口径改为只列同一执行身份（-25，需授权） |
| 研究图 kept_reference 状态 | 标出推荐保留的备选 | 推荐正文 | 50/75 被误标 | 移除或如实改名（-26） |
| 逐日指纹 `by_utc_day` | 定位复现失败的首个不同日 | 每表 `sha256` 决定相等 | 未触发 | 先量（-33） |
| `SOURCE_ALREADY_EXPOSED` | 换窗口挑结果 | 试验计数只披露不阻止 | 未触发，但挡住用户所选方案 | 保留（用户 2026-10-25 定） |
| `MONTH_INVALID`（只收下一个月） | 已有月份被改 | 固定的 Dolt 提交本身不可变 | 未触发，但挡住多年历史 | 用户已授权回补（-20），保护价值对更早月份未证 |
| `LEDGER_KIND` | 市场库被当账本读 | 无 | 拒得对 | 保留；缺口在 -28 |
| `PUBLISH_REJECTED` | 覆盖别处改过的公开副本 | 无 | 两次由产品内部竞争触发，未强推 | 保留；成因已修（-12、-22） |
| 独立源码审查 / `SOURCE_REVIEW_FAILED` | 前视与输入时间错误 | 无 | 本次 6 次全过；账本 97 次中 22 次失败（20 次 causal） | 保留 |

## Convergence

- 本记录与上一份同一会话的跟读记录口径不同（本次为事后全量、四个 fresh 子代理），新发现数不说明收敛与否。
- 已合修复（-12、-13、-14、-15、-16、-19、-22）全部在会话之后合入，本会话不能验证它们；需下一次研究会话按同一消费者路径回读。
- 本次可验证的五项（20261022-03、-13、-16，20261025-03、-04、-05）路径触发且未复发。两项已结问题复发（20261020-21、20261020-38）。
- 产品导致的无效试验为 0，但 -23、-24 显示产品允许一条线在没有对照、或在不可登记的方案上推进；这类代价不进无效试验计数，需按时间计。
- 未测：修复后的发布竞争、数据库物理增长、各项估算节省是否兑现。

## 决定

本记录无新的用户决定。引用的既有决定：用户 2026-10-25 定 -21 撤回（暴露检查不变）、-20 先量后回补、-14 收紧空对照并重启为根。
