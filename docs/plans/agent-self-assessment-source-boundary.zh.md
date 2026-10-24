# Agent 自评来源：不采用身份缺失的三篇预印本

2026-10-25。用户逐项确认：不把身份未列明的“三篇 Agent 自评预印本”补成依据；账本计数规则保留本产品的工程实现与演练依据，删除模糊待定。不改代码、skill、复盘次数或检查。

## 已定边界

- `F.3.1.1` 的工程边界是由账本读口提供计数及其版本，Agent 解释各状态，不靠会话记忆计数或自评进度；审计通过数不能冒充经济可用候选数。
- 不为身份缺失的三篇来源补造标题或链接，不声称已经逐篇评审。引用需要可核查来源及与具体主张的对应；预印本身份本身不是一概排除文献的理由。
- 当前依据支持本产品计数读取与解释的工程选择，不声称论文证明本流程提高策略收益、提升研发效果或校准了每五次复盘的常数。
- 当前计数、资格、复盘停点、skill 和评测规则保持现状。不新增文献资格检查、存储字段或依赖。

## 核查记录与文档落点

- 当前反馈章节和总待定清单均未列三篇标题、作者或链接。追溯首次引入该条目的 `03714da14`（PR #1539）及当时参考表，也未恢复三篇的身份；结论是来源身份缺失，不是已证明三篇质量不合格。
- 历史参考表另有 Huang 等人的 *Large Language Models Cannot Self-Correct Reasoning Yet*（arXiv:2310.01798），[正式发表记录为 ICLR 2024](https://proceedings.iclr.cc/paper_files/paper/2024/hash/8b4add8b0aa8749d80a34ca5d941c355-Abstract-Conference.html)。仅核对身份、发表状态与摘要支持范围，未作全文评审，也未确认它属于上述三篇；本轮不将它补入该规则依据。
- `report/status.py::research_status` 与现有 `research-round/references/review.md` 提供计数和解释边界，`evals/research-round/counts-read-not-self-assessed/prompt.md` 已有对应评测用例。本轮不运行评测，不以用例存在声称评测通过。
- 反馈章节 `F.3.1.1` 补充依据范围，章节末记录用户决定；章节与总待定清单移除旧条目。保留能力编号和既有证据层级，英文入口仍为待翻译的中文镜像。

本轮仅修改文档，没有写账本、市场库或 canonical Catalog，没有运行策略研究或原生回放。

## 验证

- `npm run check:i18n --prefix docs-site`：47 组双语章节通过；反馈与总待定清单的英文待翻译镜像和中文正文一致。
- `npm run build --prefix docs-site`：静态构建通过，日志 `/tmp/trade-agent-source-boundary-docs-build.log`。
- `npm run check:routes --prefix docs-site`：98 条期望路由与导出路由通过，94 个本地化页面有导航父级。
- 解析中英文四个导出页面：来源依据范围、工程选择和既有诊断读法均已输出；“三篇是否够格”及“用户认可后再补”的旧待定措辞移除，既有 `F-3-1-1` 锚点与引用有效。保留能力定义与证据层级，下一项回溯窗口待定仍在总清单。
- `git diff --check`：通过。

纯文档变更，未新增或运行产品测试及 skill 评测，不以构建结果声称 Agent 自评能力或研发效果得到验证。
