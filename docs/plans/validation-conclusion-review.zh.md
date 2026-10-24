# 样本外结论：一次独立复读，原始结果立即披露

2026-10-25。用户逐项确认：样本外结论定稿前增加一次独立复读，作为 Agent 报告流程要求；原始结果仍立即交给用户，不增加产品资格或审计门槛。

## 已定边界

- 复读者未参与本次策略及结论编写，收到登记、账本提交、正式样本外报告及结论引用到的开发报告；先读证据形成判断，再检查草稿。不给完整研发讨论或作者解释，按实际提供的材料说明输入范围，不以新开会话宣称已证明完全隔离。
- 检查遗漏的不利结果、未知项、模型限制，以及对 p、区间、窗口或泛化程度的过度解释。复读不构成第二份独立市场证据，不重算产品指标；自算补充统计仍依原有规则独立复算。
- 原始结果立即披露；复读未完成或暂不可用时，说明结论待复读，不虚构独立确认。分歧保留并修正解释，不换窗口、不重跑或反复找人直到同意。
- 不新增字段、评分、资格状态、自动裁决或拒绝／审计检查。不更改既有登记、未来窗口、重试、经济证据资格或研究目标。

## 实现范围

- Runtime 规则只补在 `.agents/skills/research-round/references/validation.md`，沿用现有入口路由，不新增工作流工具。
- 验证章节 `X.2.1.4` 和 skill 设计页说明流程，更新既有悬浮定义；章节及总清单移除旧待定，保留能力编号及待验证标记，明确评测不替代真实样本外交付的完整演练。
- 新增 `evals/research-round/validation-conclusion-review/`，使用固定教学报告与过度解释草稿，检查不能调用第二个 Agent 时仍披露原始结果、说明待复读状态、限定交接材料且不换窗重跑。评测只读，不触及活动研究。

## 前向检查发现及修正

首次 Codex 只读前向检查（`validation_skill_forward`）正确披露结果、说明复读不可用、不将复读作为资格，但受 reference 既有文案影响，把 K 线路径的限价及成交量假设带入教学夹具的推断报价场景。修正该旧段落为按正式报告的实际执行环境读取局限，不推定订单方式或统一偏差方向；验证章节 `X.2.2.1` 同步引用已有 `W.4.2.1`、`W.5.1.2` 模型说明，不另写一套撮合规则。

第二次使用未接收第一次答复、修改原因或 grader 的新 Agent（`validation_skill_forward_recheck`），只读取 skill 入口、验证 reference 和同一教学 prompt。答复披露正负两次验证、区间跨零和校正 p，保留待复读状态，提出先证据后草稿的限定材料交接；没有虚构独立确认、资格门槛、换窗或重跑，也没有再套用 K 线路径和成交量规则。报价推断的未知偏差方向、缺少真实深度、未提供订单方式及可检出效应均保留其范围。该结果为一次修正后的 Codex 行为前向检查，不是完整 Claude 套件通过或真实样本外复读。

没有修改产品执行代码、原生依赖或数据库结构，没有写活动账本、市场库或 canonical Catalog，没有运行策略研究或登记验证。

## 评测运行限制

`claude plugin eval . --case '*validation-conclusion-review*' --runs 1 --ablation none --no-publish --no-scaffold --trust-plugin --output-dir /tmp/trade-validation-review-eval --json /tmp/trade-validation-review-eval.json`：未进入评分，子进程报告配置的 API 所属组织停用，退出 1。JSON 中的 0 分是 API 错误占位，不是规则行为失败或评分结果。日志 `/tmp/trade-validation-review-eval.log`，原始结果 `/tmp/trade-validation-review-eval.json`；没有修改凭据或重新选择账户。首次运行发生在前向检查修正旧局限文案之前；修正后未重复这条已确认受认证阻断的调用。

## 其他验证

- `uv run --no-project --with pyyaml python -B /Users/vx/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/research-round`：通过。最初在 frozen 项目环境执行时缺少 PyYAML，随后用隔离工具环境完成检查，没有修改项目依赖或锁文件。
- 新评测 prompt 与两份 grader 的 YAML frontmatter 解析通过，插件路径正确，工具仅限 `Read`、`Glob`、`Grep`、`Skill`。这是结构检查，不是 Claude 行为评分。
- `npm run check:i18n --prefix docs-site`：47 组双语章节通过；验证、总待定清单和 skill 设计页的英文待翻译镜像与中文正文一致。
- `npm run build --prefix docs-site`：最终静态构建通过，日志 `/tmp/trade-validation-review-docs-build.log`。
- `npm run check:routes --prefix docs-site`：98 条期望路由与导出路由通过，94 个本地化页面有导航父级。
- 解析中英文六个导出页面：复读要求、立即披露、不改变产品资格、实际执行环境局限及新评测关联均已输出；旧待定条目移除，下一项数据／环境变更仍保留。既有能力锚点、跨章引用、生成索引及图谱关联与源文件一致。
- `git diff --check`：通过。

没有运行产品全量单测或真实样本外报告交付；继续保留该完整演练待验证，不把 Codex 教学夹具前向检查称作真实独立验证。
