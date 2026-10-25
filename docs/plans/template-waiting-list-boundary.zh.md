# 模板候补的提名、名单调整与启用

2026-10-25，用户逐项确认：Agent 负责发现、核实和提名候补；用户决定是否调整首批名单及启用模板，两项可以一次授权。

## 决定与改动

- 保留当前 12 个单品种模板名称。核实不了的模板暂缓并写明原因，允许留下缺位，不自动移出名单或换一个凑满数量；不放宽一手出处、逐项默认参数定位、照出处重写等要求。
- Agent 提名时说明机制、一手出处、参数核实结果、替换理由和未解决的问题。用户明确决定替换及启用后，按既有转写、发布、预检、独立审查、登记和首份正式回放流程推进，不再重复询问同一授权；授权不替代任何技术检查。
- 来源原件和核实说明沿用已有证据包。没有增加候补表、持久化授权字段、队列、调度机制或产品代码，也没有更改实际模板名单。
- 更新 `research-round/references/template.md` 的首批模板指导及双语设计说明，修正文档中“自动换下一个候补”的表述。移除本章和总清单的已决事项及其误指向文件头格式的 `L.1.3.3` 引用，授权复用引用现有 `E.4.1.2`。
- 既有模板参数定位、重写、文件头和首报流程保持原义；第二批名单与启动时点、首报范围等未决事项保持未决，总清单剩 3 项。

## 验证

- `npm run check:i18n --prefix docs-site`：47 组双语章节通过。
- `npm run build --prefix docs-site`：通过，日志 `/tmp/trade-template-authority-docs-build.log`。
- `npm run check:routes --prefix docs-site`：98 条期望／导出路由通过，94 个本地化页面有导航父级。
- `/tmp/trade-check-template-authority-docs.py`：双语导出正文、待定移除及剩余 3 项、授权与 skill 引用目标锚点通过；两种语言本轮修改一致，12 个名称及 runtime reference 的转写／首报要求与本轮修改前一致。
- 悬浮索引仅更新 `L.1.1.2` 正文与其 skill 规则标题；图谱仅新增 `L.1.1.2 → E.4.1.2`，节点和原有关系保持不变。生成索引、图谱与源文件一致。
- 新增两个离线决策评测：未获用户授权只提名，及用户已明确授权替换与启用后不重复询问。它们检查回答和 skill 调用，不操作账本，不证明实际转写、发布或回放成功；本章逐模板执行证据仍标待验证。
- 实际评测命令：`env -u ANTHROPIC_API_KEY claude plugin eval .agents --case 'template-*' --ablation with-without --runs 1 --judge-model haiku --concurrency 2 --no-publish --trust-plugin --json /tmp/trade-template-authority-eval.json`。Claude 2.1.309，7 个用例每臂实际各运行 1 次，耗时 366 秒；结果完整，无运行错误或跳过评分。加载 skill 臂 7/7 通过，未加载臂 3/7 通过；两个新增用例的 skill 调用指标均通过。
- 新增提名用例：加载 skill 的裁判票为 PASS/PASS/PASS；新增已授权用例为 PASS/FAIL/PASS，按 runner 多数判定通过，存在裁判分歧。人工复核已授权回答：明确无需再次授权，依次列出转写、无父发布、预检、独立审查、选线、根登记和首次正式回放，未将尚未执行的检查写成通过；需要新替换时仍由用户决定。
- 未加载 skill 臂的两个新增回答也识别了用户决定权，未达到完整的模板流程／证据要求而被判失败。因此该对照不能单独证明新增文字改善了授权行为，更不能证明真实研究执行可靠。单次回答评测与裁判多数票均不替代独立前向执行。
- 完整本地报告：`.agents/evals/results/2026-10-24T19-36-35-110Z/report.html`（忽略文件），JSON `/tmp/trade-template-authority-eval.json`；没有发布外部评测报告。
- `git diff --check`：通过。没有 Python 产品代码变更，未重跑 Python 全量套件，未操作活动账本或市场库。
