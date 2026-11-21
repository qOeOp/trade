# 第三轮瘦身计划（2026-11-21）

前两轮见 [瘦身审计](https://github.com/qOeOp/trade/blob/4f02ebc1a/docs/plans/doctor/2026-11-13-whole-product-slimming-audit.zh.md) 与 [第二轮](doctor/2026-11-14-slimming-round-2.zh.md)。本轮的材料是 2026-11-20 Gemini（Google Antigravity）会话的审计意见；Claude 评审 [#3201](https://github.com/qOeOp/trade/pull/3201)、[#3202](https://github.com/qOeOp/trade/pull/3202) 时删掉了其中大部分。本文逐条写明：Gemini 说了什么，Claude 核实后是多少，做还是不做、为什么。仍开着的问题记在诊断记录 [2026-11-21 Gemini 审计发现复核](doctor/2026-11-21-gemini-findings-recheck.zh.md) 和 [doctor 索引](doctor/index.zh.md) 里。

## 用户的目标

2026-11-20 至 21，会话 `3faf0faf`：

- 「全部记录 再换个维度 找找优化点 项目里我一直担心的过度设计 兼容代码遗留 职责混淆大模块 未清理脏代码 低ROI代码 等等 会随着项目和时间推进积累的赘肉 比如一个项目10w行 如果极致清理和高阶设计我认为是能在不影响功能的情况甚至还修复了一些bu g 有更优秀的架构设计和更简洁易读的代码 同时总代码量变成5行了 我想做的就是这种级别的设计和清理工作」（原文如此；“5行”按上下文应指 5 万行，即减半）
- 「关于项目瘦身和架构优化 去除冗余和兼容还有历史债 继续深入扫一遍」
- 「还有一些零碎敏捷开发加的功能之类的 实际上有更模块更好的设计的之类 也思考下」
- 「文档这块也是 不够易读 且随着多轮重构和新功能 一直跟不上同步且很多赘肉 详细分析怎么精简和改造」，随后「要的」

记录的要求：「我觉得可以先都记着 然后提交pr 之后Claude 上线后会看到这些内容然后来改进」「记录 并 提交」「需要的」「需要」；工程治理调研（会话 `929022ea`）「不用设计 现在只做发现和记录并同步到GitHub」。2026-11-21 用户要求保留真问题，不因 Gemini 的方法不对而丢掉。

## 来源与核实

- Gemini 原文：#3201 在提交 `1eac78df3`（`docs/plans/doctor/2026-11-20-close-line-and-live-gates.zh.md`，条目 `20261120-01..25`），#3202 在提交 `a96f862d6`（条目 `20261120-01..05`）。下文用 “G-” 加 Gemini 原编号指它们，以免与索引里现在的 `20261120-*` 混淆（索引里的同号条目是评审后重写的，含义不同）。
- Claude 的核实：三份核实报告（研究流程、架构减半、目录式关节），以及本轮在 `origin/main` `bf669bfd2` 上读代码、探针与计量。报告的数字直接采用，没有重做。
- 判定只有三种：**做**（已有 PR 或在做）、**不做**（写明理由）、**计量**（数字不够，先量）。

## 研究流程与目录（#3201）

| Gemini | Gemini 的说法 | Claude 核实 | 判定 |
|---|---|---|---|
| G-04 | `Line-close history` 页单薄：格子不联动 `Details`、`history` 与 `validation` 运行画不出来 | `validation` 运行已由 [#3216](https://github.com/qOeOp/trade/pull/3216) 放开；`history` 运行在 [#3224](https://github.com/qOeOp/trade/pull/3224) | 做 |
| G-11 | 76 次 `USAGE_ERROR`，`--line` 措辞诱导误传 7 次 | 误传 `--line` 只有 3–4 次；技能原句“每个接受 `--line` 的命令都写上”准确 | 不做：措辞无误，误传是 Agent 自己的错 |
| G-13 | 27 项职责有 9 项没有归因切面，`_check_prediction` 不校验职责与切面的对应 | 按设计：切面映射不约束假设；211 个预测里只有 7 个没写切面 | 不做：设计如此，实测影响小 |
| G-14 | 源码审查与预检缺复杂度审查，`us_per_bar` 外推告警 | 一例真实超线性：Line 1 根 `2c9002e7` 窗口 ×3.3、耗时 ×37（9479 秒）；线性外推会低估约 19 倍，提议的告警抓不到 | 不做产品改动；观察，见 `20261121-02` |
| G-15 ① | `Change of approach.` 没有瓶颈分类 | 成立 | 做：[#3229](https://github.com/qOeOp/trade/pull/3229) 已合入（换思路前先指出瓶颈） |
| G-15 ② | 开线视野单一，同一原型反复 | 待量 | 计量：[#3230](https://github.com/qOeOp/trade/pull/3230) 已合入开线机制多样性评测，实测在做 |
| G-15 ③ | 关线证伪没有死因与处置目录，IDE 无法按死因筛选 | 死因可从已存读数派生，不需存储字段 | 做：派生死因筛选在实施 |
| G-15 ④ | `interpretation` 判断缺结构化对账头（`outcome_class` 等） | 结构化头要么是新的存储字段，要么是对判断正文的新拒绝 | 不做（本轮 Claude 判断）：两者都要用户授权，且没有会话证据表明现有正文与预测检验对账出错 |
| G-15 ⑤ | 开线选币缺五项适用性核查表 | `research-start` 已有覆盖缺口与低活跃度推断报价适用性的检查；其余几项（容量与费用倍数、集中度）是研究方法，没核实到缺口 | 不做（本轮 Claude 判断）：与现有检查重复 |
| G-16 | 报告缺分合约、分出场明细与去第一大币净利；`dev_years` 只认 3 年 | 去最佳年与最差年的读数只在开发期恰为三个整年时给出（`report/measures.py:661-695`，其余窗口为 None）；分合约集中度的派生标量在实施；分出场明细仍开着 | 做（集中度标量）；分出场计量，见 `20261121-01`；非三年开发期没有逐年读数，见 `20261121-14` |
| G-17 | S3 平台中心从未触发；2×2 `prediction.interaction` 使用 0 次 | S3 说法不成立：40 个推荐里 28 个用了邻点或平台；`interaction` 81 次预注册用 0 次 | 做：删去无人用的 `interaction` |
| G-08 | `/goal` 下轮询风暴 | `manage_task` 等是 Antigravity 宿主工具 | 不做：宿主行为，不是产品 |
| G-09 | 源码审查从零读父本；`LEDGER_UNAVAILABLE` 无重试 | 重试原因未证实；复用父本审查结论会削弱独立审查这个信任边界 | 不做 |
| G-12 | 关线逐候选重复导出；`BACKUP_VERIFY_MISMATCH` | 导出已计量，占一段回放 2–13%，关闭（`20261120-09`）；`BACKUP_VERIFY_MISMATCH` 与 `backup_active_ledger` 在代码里不存在 | 不做 |
| G-18 | 留出期跨线泄漏、手写基准脚本、`candidate publish` 预筛、差异日区间 | 留出期跨线次数已由 `holdout_prior_trials` 显示；其余是方法建议，没有核实 | 不做 |

## 架构减半（#3201 G-19..G-24）

Gemini 说 Paper 与 Live 合计 12,811 行生产代码加约 8,000 行测试可并成一套，“122 处跨包调私有函数”“4 套 Binance REST 客户端”“手写 WebSocket”“裸线程”等都可去掉，代码可减半。核实后：

- 真实重复合计约 100–160 行：Paper 与 Live 之间约 60–90 行；跨包调私有函数 5 处，不是 122 处。
- Binance REST 客户端是三件不同的事，不是一份代码的四个副本。
- 手写 WebSocket 必须留：Nautilus rc7 到 develop 都丢掉 K 线的 `E`（发布时间）字段，晚到 bar 的检测靠它。
- `--metrics` 的线程没有 Nautilus 原生替代。
- 升级 Nautilus 推到 2.0.0：rc9 去掉了 Python 的 `RedisCacheDatabase`（`engine/paper_redis.py:23,82` 在用），rc8 的 `MARK_PRICE` 触发在 Sandbox 里从不触发。

判定：**做**几次小的去重 PR（在做）；**不做**并核重写，理由是没有可去掉的那一半；Nautilus 升级等 2.0.0。

G-20（HTTP 服务起 CLI 子进程、`ide/overview` 独立 Node 服务）、G-21（`deploy/` 编排）、G-22（测试与评测样板、`.claude/worktrees`）：**不做**。CLI 子进程是“账本只经命令行写”的边界；Overview 留在 Node 是用户的决定（「不迁移Golang」）；发布编排是用户 2026-11-16 授权的机制；评测体量被高估（跟踪的约 8,643 行，Gemini 算进了本机未跟踪文件），`.claude/worktrees` 不在仓库里。

## 工程治理（#3202 G-05）

| 部分 | 判定 |
|---|---|
| 宿主钩子做治理 | 问用户：前提变了，见下节与 `20261121-05` |
| 按 diff 选评测用例 | 计量，见 `20261121-03` |
| 20 个零命中高曝光段落 | 计量，见 `20261121-04` |
| 新增工程验收技能 | 不做：配对回放验收写在 `engine/README.md`，隔离账本在 `AGENTS.md`，没有会话证据说 Agent 找不到 |

### 三家 Agent 的钩子支持（2026-11-21 读官方文档）

用户 11-20 问：「短板A 当时考量是跨agent可用 hook这个是主流三个agent都支持嘛」。

| | Claude Code | OpenAI Codex CLI | Gemini CLI | Antigravity |
|---|---|---|---|---|
| 有无钩子 | 有 | 有，默认开启 | 有 | 有 |
| 配置 | `.claude/settings.json` 等 | `.codex/hooks.json`、`config.toml` | `.gemini/settings.json` | `.agents/hooks.json` |
| 能拦截工具调用的事件 | `PreToolUse` | `PreToolUse` | `BeforeTool` | `PreToolUse` |
| 怎么拦 | 退出码 2，或 JSON `permissionDecision: "deny"` | 退出码 2，或 JSON deny | 退出码 2，或 JSON `decision: "deny"` | 只认 stdout JSON 的 `decision` |
| 输入 | stdin JSON | stdin JSON | stdin JSON | stdin JSON（驼峰字段） |

文档：[Claude Code](https://code.claude.com/docs/en/hooks)、[Codex](https://developers.openai.com/codex/hooks)、[Gemini CLI](https://geminicli.com/docs/hooks/)、[Antigravity](https://antigravity.google/docs/hooks)。Codex 文档自己说工具钩子是护栏，不是完整的执行边界，也不覆盖托管工具。结论：10-31 时“Codex 那边没法用”的前提已不成立；但四家事件名、配置位置与拦截写法都不同，一条规则要写三到四份配置，且仍不是边界。是否改变“规则进产品代码、宿主配置只给个人便利”的做法由用户定。

## IDE 审计第一、第三优先级（会话 `ce2fc2c8`）

第一优先级（F-03 Live 安全、F-05 渲染缺陷）与第三优先级（F-04 表格与图联动）逐项核对当前代码：

| 项 | 核实 | 判定 |
|---|---|---|
| F-03 ① 桌面停止无确认 | 成立；手机端是确认单加按住 1.5 秒 | 问用户，`20261121-06` |
| F-03 ② 桌面无持仓与工作止损 | 成立；桌面不推持仓是写明的做法 | 问用户，`20261121-07` |
| F-03 ③ 选中运行后无新建入口 | 成立，只有 ⌘K；注释自相矛盾 | 做，`20261121-08` |
| F-03 ④ `unresolved` 时 Recovery 折叠 | 不成立，已自动展开 | 不做 |
| F-05 ① `LineHeader` 长名压字 | 已修 | 不做 |
| F-05 ② `uv` 警告让拒绝码丢失 | 成立，探针复现 | 做，`20261121-09` |
| F-05 ③ `marketImport` 空值 | 已修 | 不做 |
| F-04 ① 表格点行不动图 | 成立 | 做，`20261121-10` |
| F-04 ② 周期不能固定 | 成立，但是写明的做法 | 问用户，`20261121-11` |
| F-04 ③ SourceTree 单击不打开 | 单击选中、双击打开是 IDE 惯例 | 不做 |
| F-04 ④ ⌘K 每版本一条 `Run paper` | 成立 | 问用户，`20261121-12` |
| F-04 ⑤ 页面与侧栏状态耦合 | 没核实 | 不记 |

用户 2026-11-12 对 Live 启动定的是内联三栏、不弹窗；上面要改页面外观的几项都先给浅色、深色截图，不自动合并。

## 文档精简

现状（`git ls-files` 计）：`docs/plans/` 不含 doctor 100 个文件 15,809 行；`docs/plans/doctor/` 45 个文件 7,457 行；`docs/rd/` 34 个 `.mdx` 9,090 行；8 个 `README.md` 2,913 行；技能 36 个文件 2,573 行。`engine/README.md` 1,110 行，`deploy/remote/README.md` 623 行，`docs/rd/ledger-runtime.zh.mdx` 1,052 行。`docs/rd` 的 260 个层级徽章有 179 个是“待验证”。

各层只放一类内容，同一事实只写一处：

1. **设计站 `docs/rd/`**：自足的规格，讲清输入、输出与行为，可据以重建实现；不写现有代码的路径与状态（用户 2026-10-17 的规则）。
2. **技能 `.agents/skills/`**：Agent 运行时要用的步骤与规则。
3. **包级 `README.md` 与 `docs/operator/`**：模块导航与操作步骤。
4. **`docs/plans/`**：决定与经过，不当规格书引用。

分批做，每批一个只改文档的 PR，先量再删：

1. **量重复**：`engine/README.md` 与 `research-round/references/strategy-authoring.md` 的重叠（Gemini 说约 450 行，未复核），`docs/rd` 与技能、README 之间的复述。量出来的每处留一个归属，其余改成链接或删掉。
2. **长 README 改结构**：`engine/README.md`、`deploy/remote/README.md` 按标题重排；修缺陷时续写的历史段落移到对应计划文档，README 只留现行做法。
3. **`docs/rd` 逐章改写**：去掉只为凑层级的嵌套；179 个“待验证”徽章先查它对读者有没有信息，没有就去掉；英文页缺失回退中文的情况一并记下。
4. **`docs/plans/` 分现行与历史**：列出被后稿取代的计划，在前稿开头写明由哪份取代；无引用的历史稿删不删由用户定。
5. **诊断记录**：record.md 允许在记录没有未结行后由用户决定删除；列出可删的记录给用户。

不采用：从代码自动生成文档（含从 `schema.sql` 生成数据库设计页）。设计站是可据以重建实现的规格，不锚定当前代码（用户 2026-10-17）；生成会把这个关系反过来。

每批的检查：设计站构建与链接检查、`skill-names.py`（改到技能时）。
