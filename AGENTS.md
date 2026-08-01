# Repository Instructions

## Authority and scope

- 以用户要求的可观察结果决定修改代码还是文档；用户指定文件时直接以该文件为目标。
- 产品与跨模块语义放在 `docs/`，单模块输入输出留在模块 `CONTRACT.md`；文档用于解释和导航，不作为源码排版、目录或命名的机器裁判。
- 项目质量只公开两个稳定接口：根 `bun run check` 与每个 package 的 `scripts.check`。中央检查不得复制 package 内部命令、测试文件名、源码文本或当前目录拓扑。
- `.agents/skills/` 是可选 Codex 工作流，不是项目质量 authority；只有用户或 skill 自身触发规则明确要求时才使用，不因仓库内非平凡修改自动启用。

## Implementation

- 采用能闭合当前结果的最简单实现；优先复用现有 owner、入口和合同，不为单次逻辑新增抽象层。
- 每个 repository-visible 非根 `package.json` 必须提供唯一 `name` 和可执行的 `scripts.check`；package 自己决定 compiler、tests 和内部布局。
- 测试验证公开输入输出、状态转换、失败语义和真实 consumer，不把私有调用顺序、逐字文本、固定文件路径或当前数量当作行为合同。
- 跨 owner 或 shared contract 改动验证 producer 与直接 consumer；未知影响面运行完整 package contracts，不维护中央路径白名单。
- 新 required gate 必须有真实风险消费者、稳定接口、失败处置和删除条件；selector、workflow 和文档不得创造领域 policy。
- 只修改当前结果需要的范围，不顺带预建 tool、记录模型、策略流程或通用质量平台。

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
