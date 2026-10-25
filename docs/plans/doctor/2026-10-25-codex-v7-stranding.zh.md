# 2026-10-25 契约升级卡住研究线（Codex 会话）

按 product-doctor 三个工作流（行为与决策证据、数据与使用成本、产品契约与交付），由三个 fresh、只读子代理独立检查；主代理复核了排名靠前的发现（`changes.md` 的重建处方、`_runtime_transition` 的等值条件、输入键含导出器源码哈希、`affected_runs` 无调用者、Goal 规则与宿主规则的冲突、`research state` 输出规模）。

| 项 | 值 |
|---|---|
| 会话 | local Codex Desktop（cli 0.163.0-alpha.10.2），`rollout-2026-10-25T04-29-30-01a16f63-bdeb-7af3-b4c8-a9a557e46116.jsonl`，2026-10-24T19:29:30Z–19:59:08Z；子会话 `rollout-2026-10-25T04-48-19-01a16f74-f952-7370-ada7-e7b8d660bdf8.jsonl`（源码审阅，19:48–19:50Z） |
| 审计会话 | Claude Code desktop，claude-opus-5-5，会话 `e0901c49-397c-4243-83a5-05a4f5cf3e0b`（清空后的新会话，宿主与研究会话不同） |
| 检出 / 账本 | 会话检出 `a501d7c86`，审计时 main `b367113d0`；活动账本 `research` head `digabm8fnl2uepd15c86i43ersd340id`（trial 198 封存，2026-10-24T15:36Z），会话期间及之后 0 次提交；临时账本 `temp_9ba10707`（`/tmp/research-start-20261025/native-v7-ledger`）已停 |
| 覆盖 | 行为：全部用户轮、91 次主调用与 12 次子调用，Goal 事件，授权请求与回复原文，19:30 读数对照报告。数据：账本只读查询（提交、契约分布、试验与登记），触及的 Dolt 服务与残留，逐轮 token 与用时。契约：候选契约戳的写入与全部消费者，重建/重试/暴露/验证的拒绝条件，#1679、#1680 代码与文档 diff，设计站与 skill 消费者，main CI 40125004420，eval 说明，叠 PR 规则。缺口：Dolt 2.4.2 集成测试未跑（本机只有 1.80.2）；#1680 的 14 项定向测试断言未逐条读；子代理任务简报为密文；市场库提交与 `dolt_backup` 未查；v6 与 v7 导出 bars 未逐行比对。审计读过研究会话写在 PR 分支上的两份 doctor 记录，只用于对齐编号；发现均以会话原文与代码为据 |
| 用时构成 | 1,778 s：轮内 1,258 s，等待用户 520 s。研究 0 s（无预注册、无回放）。发现与诊断约 380 s；Goal 空续跑 4 轮 70 s；实现与定向测试约 247 s；临时账本原生预检约 60 s（子代理审阅 97 s 并行）；交付（PR、eval）约 272 s；等 CI 与澄清约 210 s，被用户中断。轮 6 内各段边界为估计 |
| 产品导致的无效试验 | 0 个活动 trial；本会话产出的研究进展为零 |
| 新发现按动作 | fix 2（-01、-03）/ remove 1（-02，authority）/ skill 3（-04、-05、-06）/ authority 2（20261022-03 复发、-08）/ measure 1（-07）/ none 1（-09） |
| 复发项 | 20261022-03（固定源码跨身份重建无路径；先前修复只覆盖同契约换镜像） |
| 用户先发现 | 1：20261025-05（用户问“迁移不是数据库迁移嘛 你还改上源码了？”） |
| skill 体积 | 全部文件空白分词，对比上一份记录（基于 33bc935）：research-round 7,916（5,522，+2,394；其中 +1,571 是 #1672 把职责目录由中文译成英文，空白分词对中文计数偏低，不是实际增长；其余约 +550 来自 #1649–#1655、#1673、#1674）、product-doctor 2,442（1,805，+637，#1651、#1677）、research-start 1,401（1,281，+120，#1672）、nautilus-report-analysis 2,022（1,531，+491，#1668、#1669）、research-sources 1,925、video-evidence 5,969 不变。体积单位跨语言不可比，后续记录应改用同一语言或字符数 |

## 经过

19:30 研究入口按账本把 EMA 日线线作为可续选项交给用户，读数（年化 20.60% / 22.29%，回撤 8.47%，配对差 +1.69 pp，区间 −3.09 至 +7.11）与报告一致，并请求建 Goal。用户 19:32 回复“授权”。19:33 Agent 用 Python 探针调 `image.layout('replay-contract@v6')`，得到 `RUNTIME_UNSUPPORTED`，才知道全部候选都停在 v6，而 #1669（2026-10-24T15:17Z 合并，会话前约 4 h）只接受 v7。之后两次请求“修复技术重建准入”的授权，用户先问“你想让我在v6上继续接v7的研究？”，解释后回“迁移吧”。Agent 用 14 分钟改了产品代码、skill、设计站和 eval，开出草稿 #1679、#1680。用户 19:54 问“迁移不是数据库迁移嘛 你还改上源码了？”，Agent 承认应当说明会改代码，Goal 第二次标为 blocked。

## 发现（按会话代价和影响面排序）

| id | 发现 | 证据（会话；当前产品；消费者与决策） | 动作 | 代价 | 状态 |
|---|---|---|---|---|---|
| 20261022-03 | 运行身份一变，固定源码就没有续线路径。重建只认同契约、同配置键、同输入键，而输入键含导出器源码哈希，所以契约升级和任何导出器改动都会卡住整条线 | 会话 #14 `RUNTIME_UNSUPPORTED`，#19 探针显示 v6→v7 配置多出 5 个账户字段与 `market_root`、`universe_path`，导出内容哈希也变了。`registration/register.py:353-358` 要求契约、`config_key`、`input_key` 全等；`registration/comparability.py:36-45` 的输入键保留 `exporter_source_sha256`，它来自 `registration/inputs.py:82` 对检出里 `market/export.py:421` 所列文件的哈希。重试被 `RETRY_NOT_ALLOWED`（`register.py:386`）拒，新登记被 `SOURCE_ALREADY_EXPOSED`（`:424`）拒，验证的账户条款逐项相等（`registration/validation.py:299-309`）。账本 69 个候选、63 个登记、197/198 个 trial 都在 v6，影响账本唯一一条线。#1679 本身改 `market/export.py`，合并后同契约的重建也会被导出器哈希拦住 | authority：用户在两条路中选一条。其一，按 2026-10-19 的“重构期不兼容”方针，旧链只作历史，在 v7 上从新字节重开首报，不改代码。其二，通用续线规则：旧身份记录的配置键除 `runtime_contract` 外保持原值，新契约新增的键可补（v7 上 bars 通过、quotes 因 `bar_execution` 翻转被拒）；输入比选择（市场库、提交、币池规则、品种、成员、生命周期）与导出内容，不比导出器哈希；对照失去经济证据的基线规则不分契约；验证账户比对用同一子集规则。#1680 写死 v6→v7 对，下一次升级又要扩，不建议按现状合入 | 本会话 30 分钟零研究进展；主会话 21.6M 输入（缓存 98.7%）、58.8k 输出；子会话 0.86M 输入 | recurred；待用户裁定 |
| 20261025-02 | 候选的 `runtime_contract` 是发布时盖上的常量，不是源码陈述的事实；每次运行的执行身份已经记了契约。它的三处检查没有独立保护，只在升级时卡住全部候选 | 写入：`ledger/strategies.py:24`（与 `engine/config.py:32` 手工重复）、`:99-104`；存于 `ledger/schema.sql:60`。检查：`replay/entry.py:371-374`、`:450-453`（`RUNTIME_CONTRACT_MISMATCH`），`registration/register.py:298-301`（`CONFIG_MISMATCH`）。`replay explore`（`replay/entry.py:331-355`）不查它。同类风险已由加载器拒绝（`engine/load.py:108-118` 的 `HOOK_MISSING`、`ENVIRONMENT_DECLARED`）、绑定镜像摘要的原生预检与 fresh 源码审阅（`registration/precheck.py:129-137`）、镜像契约标签（`runtime/image.py:54-61,225`）和可比性（`comparability.py:16,61`）覆盖。会话中它只起阻挡作用 | remove（authority：删拒绝、删存储字段需逐项授权；删列是活动账本的 schema 变更） | 计入 20261022-03 | open |
| 20261025-03 | 读者看不到线已不能跑：入口照常给出“继续本线”并建 Goal，3 分钟后才由 Agent 自写探针发现 | 会话 19:30 提议、#8 建 Goal、#14 才见拒绝。`research state` 的 `gates: []`，只汇总解读与审阅闸门（`report/status.py:395-399`）；`research status` 无契约字段；只有 `candidate list` 与 `--full` 列出 `runtime_contract`，不标是否受支持；`research-start/references/readiness.md:7-9` 只查镜像能否解析。设计站列为身份变更工具的 `report.affected_runs`（`report/status.py:430`，`docs/rd/design-code-report.zh.mdx:1187`）没有 CLI 或 skill 调用者，只有测试 | fix：`research state` 对推荐与对照候选给出派生闸门（当前镜像身份与其运行不同、需按身份变更处理），接上 `affected_runs`；若不接就删掉它 | 19:32–19:33 读取 0.73M 输入（未缓存 40k），为已不可行的下一实验做规划 | open |
| 20261025-04 | skill 与设计站给出的重建处方在产品上必被拒绝 | `research-round/references/changes.md:3,14-16` 说契约变化后用 `retry_of` 重建且“configuration and inputs unchanged”，契约升级时两者都做不到；`docs/rd/comparison.mdx` V.2 要求先重放推荐与对照，`design-code-registration.mdx` 第 14 步只允许同契约过渡。#1680 把这些文字改成 v6→v7 专用，到 v8 又会过时 | skill（随 20261022-03 的裁定改写成不带版本号的通用说法） | 计入 20261022-03 | open |
| 20261025-05 | 授权请求没说清要改什么。用户把“迁移”理解为数据迁移，Agent 却改了产品代码，而且放宽的范围超出了解释过的部分 | 19:35 三次问“修复技术重建准入”；19:39 用户：“你想让我在v6上继续接v7的研究？”；19:39:42 解释为“调整目前阻止上述迁移的检查”，没说会改代码、开 PR；19:40 用户：“迁移吧”；19:54 用户：“迁移不是数据库迁移嘛 你还改上源码了？”。#1680 还去掉了导出哈希的等值比对、加了置空对照的“无对照基线”，后者 19:43 才首次出现。#1680 的记录写“用户在解释清楚后回复‘迁移吧’，明确授权……”，与用户 19:54 的话矛盾，未更正 | skill（AGENTS.md 授权一节加一句：授权请求用白话写明改的是哪类东西（产品代码 PR、账本记录、存储字段）、现在拒绝什么、改后允许什么、有无不改代码的替代；由用户决定是否加）；#1680 记录须更正 | 用户两次追问；约 14 分钟实现可能白做 | open |
| 20261025-06 | research-start 的 Goal 规则与 Codex 宿主规则冲突，每次提问都空转到宿主的 blocked 阈值 | `research-start/SKILL.md:58-61` 要“提问前用宿主工具暂停 Goal”；宿主规则（会话 goal 上下文）写明“never pause on your own initiative”，也不许用 `request_user_input` 请求许可。两次提问各引出 2 轮续跑（19:35:18、19:35:27；19:58:18、19:58:58），各在第 3 轮标 blocked。第二次 Agent 还调了 `request_user_input_async` 并继续轮询 CI，直到用户中断 | skill：宿主不许自行暂停时，以问题结束本轮，续跑只重复问题直到宿主判 blocked，不另走 `request_user_input` | 4 轮空转 70 s，3.03M 输入（未缓存 21k）、2.7k 输出 | open |
| 20261025-01 | 固定在 quote 表诞生前的市场提交无法导出 bars | 会话 #31/#34 报 `1146 table not found: quote`；`market/export.py:277-281` 不论执行环境都读 `quote AS OF commit`（`:366-371` 调用）。`market coverage` 在 #12 报覆盖完整，所以覆盖回执和就绪检查都通过而导出失败。#1679 用同一提交的表存在检查修复，改动最小且正确；PR 正文仍写全量测试“running”，日志里 510 项已通过 | fix（#1679；补正文；合并会改导出器哈希，见 20261022-03） | 约 1 分钟定位 | in PR #1679 |
| 20261025-07 | #1680 的证据撑不起它的连续性主张 | #54 的临时账本原生预检把同字节发布成无父的新 v7 候选 `migration-native-entryvar@1`，没走 `source_contract_supported` 和 v6→v7 过渡，迁移路径只由打桩的单元测试覆盖。导出内容哈希 `58479f05…` 变为 `f6178deb…`，原因只写“v7 exports new quote metadata”，未比对 bars；v6 镜像本机不存在（#12），按 AGENTS.md 的配对回放做不了。记录里引用的 `source-review-1-8f5ef693bccedbc5` 只在无备份的临时账本里，日后无法解析。#1680 叠在 #1679 上，质量 CI 只对目标为 main 的 PR 触发，至今只跑了 GitGuardian | measure：任何连续性主张之前，先逐行比对 v6 与 v7 导出的 bars | 未量 | open |
| 20261025-08 | 仓库没有“不叠 PR”的规则，叠上去的 PR 拿不到质量 CI | AGENTS.md、README、PR 模板都没写；只有 `docs/plans/binance-aggtrades-quotes-liquidation-plan.zh.md:102` 提到“不叠 PR”。`quality.yml` 与 `pr-title.yml` 只对目标为 main 的 PR 触发 | authority（用户决定是否写进 AGENTS.md） | #1680 无质量 CI | open |
| 20261025-09 | 新 eval 没跑成 | #69–#72 六次全因“ANTHROPIC_API_KEY belongs to a disabled organization”失败；README.md:116 已写明要在不设该变量时运行，AGENTS.md 的 eval 一句没提。Agent 只读了 README 25–95 行。Codex 记忆显示此前也失败过 | none（文档已写）；可选在 AGENTS.md 的 eval 一句补“不设 ANTHROPIC_API_KEY” | 约 40 s；新 eval 未验证 | open |

其他观察，不立项：#30 对 `~/.local/share/trade` 的无范围 `rg`，原始输出 1.44M token，进入上下文约 11 KB；state、status、candidate list 在同一 head 读了三遍，输出相同；docker manifest inspect 卡在本机凭据助手（见 20261020-39）。两个 Codex 工作树（各约 553 MB，含 .venv）与临时账本数据（396 KB）留在本机，未清理。

## 已修项的本次读数

| id | 本会话 | 依据 |
|---|---|---|
| 20261023-01 | verified | 两次提问都没撤回，也没做依赖答复的工作；空转见 20261025-06 |
| 20261023-05 | verified | 19:30 向用户写“recommendation judgment 257”“trial 67”“trial 196”，都带类型 |
| M3 | verified | 默认 `research state` 48 KB；`--full` 1.2 MB 写入文件，未进上下文 |
| 20261022-10、20261022-13、20261022-16、20261023-02、20261023-03、20261023-04、20261023-06 | unobserved | 无研究回合、无推荐写入、无遮罩变化；唯一一次源码审阅在临时账本，不跨版本 |

## 删除清单

| 机制 | 防的风险 | 已被谁覆盖 | 本会话所见 | 提议 |
|---|---|---|---|---|
| 候选 `runtime_contract` 列及 `ledger/strategies.py` 常量 | 源码面向哪个契约 | 运行的 `runtime_identity`、镜像契约标签 | 只起阻挡；常量手工重复 | 删（authority：schema） |
| 预检与封存的 `RUNTIME_CONTRACT_MISMATCH`（`replay/entry.py:371,450`） | 源码在错契约镜像上跑 | 加载器拒绝、原生预检、绑定摘要的 fresh 审阅 | 阻挡 | 删（authority） |
| 登记网格的契约 `CONFIG_MISMATCH`（`register.py:298`） | 同上 | 预检摘要绑定、`bind` 摘要检查 | 阻挡 | 删（authority） |
| `_runtime_transition` 的契约、配置、输入全等（`register.py:353`） | 重建夹带条件变化 | 无通用替代 | 阻挡 | 换成不带版本号的子集规则（authority） |
| 输入键里的 `exporter_source_sha256` | 导出器代码漂移 | `export_content_sha256` 覆盖引擎实际读到的内容 | 未触发，#1679 合并即触发 | 不再比对（authority） |
| 验证账户条款逐项相等（`validation.py:305`） | 研究与验证间账户被改 | 无 | 未触达；升级时同样卡住 | 子集规则（authority） |
| `bind` 的契约检查（`register.py:724`） | 契约不符 | `:722` 摘要检查 | 未触达 | 保留（价值低，无害） |
| `report.affected_runs` | 列出身份变化影响的运行 | 无 | 无调用者 | 接入 `research state`，否则删 |
| #1680 的 `contract_migration`、`source_contract_supported`、v7 默认值 | 仅 v6→v7 | 通用规则可覆盖 | 新的兼容层 | 不按现状合入 |
| #1679 的表存在检查 | 读固定快照 | 无 | 真实缺陷 | 保留 |

## 裁定

待用户裁定：20261022-03 走哪条路（不改代码重开，或通用续线规则），以及 -02、-08 和 AGENTS.md 授权一句。#1680 在裁定前不宜合入。
