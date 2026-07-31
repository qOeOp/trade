# Repository Instructions

## Authority and scope

- 以用户要求的可观察结果决定修改代码还是文档；用户指定文件时直接以该文件为目标，不因请求未指定路径而默认改文档。
- 文档分层、authority、状态和归档规则以 `docs/README.md` 为准。产品、架构、runtime、research、engineering 内容进入对应目录；单模块合同留在模块 `CONTRACT.md`。
- 当前手写文档按 `docs/README.md` 声明元数据并登记到 `docs/engineering/doc-contract-index.json`；最低检查是 `bun scripts/check-doc-contracts.ts`。
- `.agents/skills/` 只承载 Codex 工作流说明和无项目依赖的确定性 helper，不承载领域实现、schema、数据库、第二套 CLI 或独立 authority。

## Implementation

- 采用能闭合当前结果的最简单实现；优先复用现有 owner、入口和合同，不为单次逻辑新增抽象层。
- 仓库内非平凡实现或交付工作必须使用 `$run-bounded-mission`；未点名的普通非平凡实现因此自动触发。answer-only / explain / audit、diagnose-only、mechanical edit、routine status、新 task 管理和内部子问题不因本规则自动触发。用户显式点名 skill 或明确要求 mission workflow 时，以显式调用为准。
- skill 自动触发不授权创建独立 Codex task；只有用户明确要求新 task 时才可创建，内部子问题留在当前 task。
- 只修改当前结果需要的范围，不顺带重构、扩展职责或预先设计尚未决定的 tool、记录模型和策略流程。
- 只有宣称新增或完成用户功能时，才要求通过既有 runtime、CLI 或 server consumer 展示行为；文档修正、局部缺陷和内部维护按实际影响面验证，不强制制造跨 owner 改动。
- 受影响边界必须进入修改面或验收面，但无证据表明受影响的边界不扩张。
- 工程检查入口以 `docs/engineering/check-contract.md` 为准；质量、架构和数据规则由各自 owner 文档定义，`AGENTS.md` 不复制其细节。

## Safety and conventions

- Binance 下单、撤单、调仓及其他真实写接口必须由用户明确授权；默认使用单测、dry-run 或 preview。
- 保留用户已有改动，不把无关 staged、unstaged 或 untracked 内容纳入当前候选。
- 不把 secret、本机绝对路径或运行数据库写入 docs、code、helper 输出合同。
- 新增文档路径使用 ASCII、小写和短横线；`README.md`、`CONTRACT.md`、`SKILL.md` 等仓库约定名称除外。文档正文优先中文，时间默认 `Asia/Shanghai`。
- automation memory 通过 `scripts/automation-memory-path.sh <automation-id>` 解析；需要 Python 时优先用 `python3` 或 `scripts/resolve-python.sh`。

## R&D strategy requests

当用户明确要求运行一次 R&D 策略开发时：

- 直接使用 `research.rd-supervisor` 的 production CLI；不存在 state 时由 `--supervisor-job` 初始化，不手写数据库。
- 空队列或没有 ready hypothesis 不算有效开发；按 strategy universe 与 hypothesis designer 合同补齐、校验并入队。
- 需要 discovery、validation 或 locked holdout 时先生成 repo-relative split manifest；locked holdout 仅在 hypothesis 与 candidate 已冻结且用户明确要求最终验证时打开，也不得为跑通流程降低样本要求。
- 有 validation manifest 的 hypothesis 优先跑 campaign；`mode=loop` 只消费 discovery。
- 结束后检查 artifact、RD state 和 gate；`no_promote` 可以是完成结果，但不能表述为找到策略。过程复盘写入 `docs/research/reliability/rd-audit.md`，临时数据留在 ignored 的 `tmp/` 或 `data/`。
