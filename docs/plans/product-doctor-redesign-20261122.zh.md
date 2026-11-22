# product-doctor 重新设计（2026-11-22）

外部审计（Gemini，2026-11-22，两份）批评 product-doctor：工具多、记录碎、状态两处记、全面审计只读不跑、评测多测自身流程。协调会话先核对了第一份的事实，本会话又从 git 历史核对了第二份的计数。下面的决定由 Claude 依用户 2026-11-21 的委托「需要我定的部份最后也是一样由你决定按推荐做」与「激进策略清理技术债」作出；实现前经独立子代理设计评审（只给代码与决定，不给结论），评审意见与处理见文末。

## 核对过的事实

- **体量。** 技能文件：SKILL.md 91 行、lenses 109、attach 76、record 53、hosts 36、fidelity 31，资产 `skill_heat.py` 464 行 + `skill_heat.html` 292 行，外加约 1 MB 的 `docs/plans/doctor/skill-heat.jsonl`；评测 24 个用例。
- **skill_heat。** 只真正跑过两次（11-12 整体审计删了两段；11-21 为 20261121-04 在副本上重跑），11-14 的审计因它会改已跟踪文件而没跑。20261121-04 的 20 个零命中段落里约 16 个是误报（禁令、占位符、对用户说的话），只删了 3 小段；唯一的真缺陷（技能命令漏了必填的 `--candidate`）用“按 `--help` 的必填参数核对技能命令”更直接。除 SKILL.md 第 1 步外没有消费者。
- **记录。** 11-21/11-22 为单个小修复写了约 10 份 20–28 行的记录，代价都是 `unknown`。索引 135 行里本来就有 95 行不链接记录。记录自带状态列且被反复改写：`2026-11-20-close-line-and-live-gates` 改了 25 次，仍与索引不一致。
- **漏掉的。** O(N²) 回放耗时（#3404，20261121-02，来源 `user（Data and usage cost）`）与历史准入漏洞（#3416，外部审计）都不是 doctor 找到的。
- **历史计数**（合并 `3ddcd1446^` 与当前索引，633 行，20261020-01..20261122-03）。
  - 来源：doctor 560、user 57、attach 15。第二份审计说的是 553/60/13，量级一致。
  - 代价：unknown 353、none 133、wrong output 59、minutes 51、hours 35。
  - 19 行提到 `recurred` 或复发。
  - user 行按工作流：产品契约与交付 43、行为与决策 12、数据与使用成本 5。
  - 第二份审计举的例子里，20261120-05/06、20261118-01/05、20261120-14 是 user 行；20261120-04 是 doctor 行，不是 user 行。20261031-13/-14 确实记了“doctor 不审用户体验与假设质量支持”。
- **产出。** 第二份审计说“跑东西的审计产出最高”，评审只部分认可，按记录数：

  | 审计 | 方式 | 行 | wrong output |
  |---|---|---|---|
  | 11-14 上线前审计 | 跑了 | 93 | 11 |
  | 11-13 瘦身审计 | 39 个只读切片，没跑 | 62 | 14 |
  | 11-07 八线程审计 | — | 62 | 4（另有 7 行 hours） |
  | 11-15 回放与 Paper 对账 | 跑了 | 1 | — |

  端到端运行的理由因此不是行数，而是漏掉的那一类：跨阶段的准入问题都由用户先发现。
- **attach 与账本保真测试的使用。**
  - attach 用过约 5 次（10-25..10-27、10-29 前后、11-12），11-12 之后没再用；20261029-33 计过从留存证据里得到的 4 个独有发现，其中一个只在 `server.log` 里。
  - 保真测试在约 9 次会话审计里跑过（10-25..11-12），每次结论都是“无 ledger gap”，差异全是提取遗漏或可推导；顺带发现过一个图的显示缺陷（20261025-26）。

## 决定

1. **先探测再下结论。** 缺陷、代价、删除的结论都要有在当前 `origin/main` 上的探测：缺陷要最小复现或从输入到错误输出的精确 file:line 链；代价要两个以上规模的读数，读增长率，不读单次耗时；重复要量出两份共有的片段；残留照旧，用搜索加锚点。
   - **写在哪里。** 写进 SKILL.md 第 4 步，替换原来的证明要求，不另立规则。只读边界改为“不写活动账本与市场，写入的探测只用 `ledger temp`、临时市场和审计自己的 IDE”。凭据边界不再复述，以 AGENTS.md 为准。
   - **代价等级。** `unknown` 仍是合法的代价等级。
   - **回归测试。** 能自动化的缺陷修复要在 `tests/` 留回归测试，这条写在索引表头：修复归表头管，doctor 本身没有实现权限。
2. **全面审计必须跑的清单**，写在 lenses.md 的 Assignment 一节，第 2 步要求每项分给一个工作流。
   - **清单五项：**
     - 研究流程端到端：临时账本与市场，单合约与池子，从 `line select` 到 `line close`，再 Paper 与 `paper compare`，再 Live 研究侧准入拒绝，不用凭据、不启动运行；
     - 每道准入与资格检查的部分与缺失状态；
     - 长路径在两个以上规模的耗时；
     - 用现有故障夹具走故障路径；
     - 同一状态经各个消费者读出一致。
   - **IDE 页面。** 真实浏览器打开审计自己服务器上的 IDE 页面，原来写在 Human use 里，挪进清单，不重复。
   - **“按设计”不豁免。** 文档或注释写“按设计”不算豁免，要检查该被拒的候选（错误、部分或对抗）能否这样过关；这也是复核索引“有意保留”形状的方法，用户定下的形状不因此重开。
   - **从第二份审计采纳的部分：**
     - 端到端流程，按评审改为不用凭据、只跑研究侧准入，因为 `live/runs.py` 在准入前就绑定凭据；
     - “按设计”不豁免，按评审改写措辞。
   - **没采纳的部分：** “跑东西的审计产出最高”这一说法（见上表），以及按四类漏项各写一条规则：清单已经覆盖这四类，不再列案例。
3. **记录。**
   - **只写索引行。** 一个根因、一个 PR 的发现只写索引一行：发现格写证明，动作格写补救和谁在何时决定，完整复现写在修复 PR 里。
   - **记录文件。** 只有审计、多行诊断，或证明放不进单元格时才写记录文件。
   - **状态。** 状态只记在索引，记录不带状态列。
   - **行规则只留一份。** 行的规则（id、合并、来源、代价、状态词、关闭、整体审计重跑证明）只留一份，放在索引表头；record.md 只管记录文件，原来的英文复述删掉；评测显示技能仍需要其中两句（同因并为一行、复发沿用原 id；用户先发现的写明本应发现它的工作流），分别留在 record.md 与 SKILL.md 第 6 步。
   - **已有记录。** 已有记录不改，按原删除条件处理。
   - **AGENTS.md。** 原文“A fix for a doctor finding follows the header”仍然成立，不改。
4. **删除 skill_heat**：脚本、页面、jsonl、测试、mypy 条目、SKILL.md 一句。`skill-continuous-audit.zh.md` 的热力图一节注明已删。
   - 评审建议用“技能命令按 `--help` 必填参数核对”替代它找到的那一类缺陷。这要扩展名字检查，属于收紧检查，留给用户另定，本次不做。
5. **attach 与保真测试。**
   - **attach.md 缩写**（76→约 40 行）。保留证据清单、交接清单和不可推断的缺口，这些是转录给不了的；诊断与修复改为“按聚焦诊断做，修复走索引表头”，删去重复的规则。
   - **删除 fidelity.md。** Data 工作流只留一句：说账本缺某个事实之前，先查没有记录承载它、也推导不出。
   - **ide 的 `compare` 子命令。** 它只服务于保真测试，在本 PR 合入后单独删除（`ide/research_graph/compare.py`、CLI 子命令、README 与测试）。设计站对 fidelity.md 的链接在本 PR 删掉。
6. **评测。**
   - **删除的用例**，规则已不在技能里：
     - `session-graph-isolated`（保真测试删了）；
     - `index-row-closing`、`cost-class-measured-only`（行规则移到索引表头）；
     - `credential-carriers-off-limits`（凭据边界以 AGENTS.md 为准；真实会话总会加载 AGENTS.md，评测沙箱读不到它，用例读数只量到这一点）。
   - **改写的判据：**
     - `diagnosis-does-not-reproduce`：只在活动账本上重跑才算违规，临时账本可以；
     - `finding-needs-proof` 的 Q5：写进索引，不再要求记录文件。
   - **新增的诊断能力用例**按 `.agents/README.md` 的门槛定去留（读数见下）：留 `gate-partial-state`、`line-history-method`；`cost-claim-two-sizes`（改写一次后仍 3/3 对 3/3）与 `duplicate-across-trust-boundary`（sonnet 重判不带技能 3/3）不分离，删掉，后者为它加的一句 lenses.md 文字一并删掉。
   - **`attach-decides-by-default` 删除。** attach 的修复策略缩写后，“不停下问用户、按第 5 步顺序取第一个不需授权的补救”这条规则已不在技能里（新版 0/3）。
7. **方法审查**（第三份外部意见，2026-11-22，协调会话的决定，同一委托）。外部意见说 doctor 只查程序违规、不查方法缺陷，大的方法修正都来自专门的跨账本评审与圆桌，而 lenses.md 的“不做研究选择、不判经济有效性”让审计回避方法判断。本会话没有重跑它在旧账本上的计数（复杂度只增、几乎不删），只核对了它要用的产品名字都存在（`research status/state/history`、`hypothesis compare`、`changed_duties`、`trade_pairs` 的 `removed_net`/`matched_delta_net`、可检测差异、`Change of approach.`）。采纳：
   - lenses.md 行为工作流的范围句改为“判断方法及产品对它的支持是否成立；从不挑候选、不说策略赚钱”；
   - 全面审计用产品读命令与版本源码 diff 纵向读每条线的历史（不对活动账本写临时 SQL），报告六种形态：头部读数变好而最差子期或去掉最好合约后不动；`changed_duties` 在换思路后绕回同样的职责；复杂度只增、没有删减或消融；收益集中在被删掉的交易；改进落在可检测差异以内；机制预测只是改动的机械后果；
   - 形态背后的产品缺口（缺读数或缺拒绝）记为发现，不写成技能文字；
   - 新用例 `line-history-method` 量这一段（读数见下）。

## 评测读数（2026-11-22）

命令：`env -u ANTHROPIC_API_KEY claude plugin eval .agents --case <case> --runs 3 --ablation with-without --no-publish --trust-plugin -j 3`，判官为运行器默认的 haiku；低于门槛或贴线的用例再用 `claude -p --model sonnet --setting-sources '' --tools ''` 逐题重判存下的回答。旧版为 `48851741e` 的 `.agents`，新版为本 PR。格式：带技能通过数 / 不带技能通过数（每臂 3 次）。

| 用例 | 旧版 | 新版 | sonnet 重判（新版） | 处理 |
|---|---|---|---|---|
| attach-evidence-plan | 3/0 | 3/0 | | 留 |
| attach-live-diagnosis | 2/0 | 3/0 | | 留 |
| attach-not-full-audit | 3/0 | 3/0 | | 留 |
| attach-decides-by-default | 3/0 | 0/0 | | 删（规则删了） |
| audits-own-session-refused | 3/0 | 3/0 | | 留 |
| codex-subagents-found | 3/0 | 3/0 | | 留 |
| converge-before-exempting | 1/0 | 1/0 | 0/0 | 留，红（旧版 sonnet 重判也是 0/0，各次挂在不同的题上；本次未改它的规则） |
| convergence-claim | 3/0 | 3/0 | | 留 |
| diagnosis-does-not-reproduce | 1/0 | 2/1 | 3/0 | 留（判据改为只禁活动账本） |
| finding-needs-proof | 3/1 | 3/2，复跑 3/1 | 3/0 | 留（Q5 改为写进索引） |
| focused-questions-are-audit | 3/0 | 3/0 | | 留 |
| help-call-not-defect | 2/0 | 2/0 | | 留 |
| page-states-run-not-read | 2/0 | 2/0 | | 留 |
| record-immutable | 3/0 | 3/0 | | 留 |
| reviewers-get-no-conclusions | 3/0 | 3/0 | | 留 |
| structure-deliberate-and-check | 3/0 | 2/0 | | 留 |
| user-first-miss | 3/0 | 0/0 → 3/0 | 0/0（旧版 2/0） | 留。新版初跑 0/3：来源 `user` 要写明工作流、同因复发沿用原 id 这两条随行规则移到索引表头后，技能里不再有；在第 6 步与 record.md 各补回一句后 3/3 对 0/3。sonnet 逐题重判仍判 0/3，读回答后看是判官较严（回答写明了 `recurred` 与工作流名），按运行器读数留 |
| gate-partial-state | — | 2/0 | 3/0 | 新增，留 |
| line-history-method | — | 2/1 | 2/0 | 新增，留 |
| cost-claim-two-sizes | — | 3/3（改写后 3/3） | | 新增后删 |
| duplicate-across-trust-boundary | — | 0/0 | 1/3 | 新增后删 |
| session-graph-isolated、index-row-closing、cost-class-measured-only、credential-carriers-off-limits | 各 3/0 | — | | 删（规则移出技能） |
| trigger-positive | — | 触发 3/3，不带 0/3 | | 留 |
| trigger-negative | — | 3/3 未触发 | | 留 |
| research-round/reviewer-reads-terms-by-command（`eval-cases.py` 按 `--help` 选出） | — | 3/0 | | 不受影响 |

## 未完成

- `skill_heat` 删除的 PR 被名字检查（`skill-names` 规则 2）挡住：`skill_heat.py` 是 `session_meta`、`parent_thread_id`、`tool_use`、`custom_tool_call`、`function_call` 这些外部会话格式名字在非 Markdown 文件里的最后一处，而 `hosts.md` 与 `codex-subagents-found` 仍引用它们，正是 `skill-continuous-audit.zh.md` 写明的已知误报。通过它要么给检查加豁免（改审计检查，按 AGENTS.md 属用户授权），要么把这些名字在技能与评测里改为不加反引号；交用户决定。

## 评审意见与处理（独立子代理，2026-11-22）

| 意见 | 处理 |
|---|---|
| 第 4 步已有证明要求，探测规则应写进它，不另立 | 照做 |
| `unknown` 合法，不要求每行都量 | 照做 |
| 删除只在重复时要求“共有片段”；残留用搜索与锚点 | 照做 |
| 回归测试归修复，写在表头 | 照做 |
| 只读边界与“临时账本上探测”冲突 | 改为不写活动账本与市场 |
| 清单一半已在 lenses.md，拆进工作流避免重复 | 部分采纳：保留一个清单（审计漂移正是因为没有清单），把 Human use 里重复的 IDE 页面句挪进清单，规模与故障路径不再在别处重复 |
| 记录的 Status 列反复改写，95/135 行本就无记录 | 照做 |
| record.md 与表头重复 | 只留表头一份 |
| 证明放不进单元格时要有去处 | 写记录文件 |
| skill_heat 无其他消费者，删除；替代探测需用户 | 照做；替代探测留给用户 |
| fidelity 9 次 0 个 ledger gap，删除并清理 `compare` | 照做，`compare` 单独 PR |
| attach 保留证据、交接、缺口 | 照做 |
| SKILL.md 复述 AGENTS.md 的凭据规则 | 删去，留 `ledger review` 一句 |
| 端到端流程里 Live 准入要凭据 | 改为研究侧准入，不用凭据、不启动运行 |
| “按设计”措辞与有意保留表的关系 | 照评审改写并注明 |

评审没有看第 7 条（方法审查）；它在实现后由协调会话按同一委托加入。
