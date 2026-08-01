# Repository Instructions

## Working principles

- 以用户要求的可观察结果为准，只修改完成当前任务所需的范围。
- 优先复用现有 owner、入口和合同；采用最简单的直接实现，不为单次逻辑新增抽象或工具。
- 产品与跨模块语义写入 `docs/`，单模块输入输出写入对应的 `CONTRACT.md`。
- 保留用户已有改动，不纳入或重构无关内容。
- `run-bounded-mission` 的 `SKILL.md` 的 frontmatter description 是该 workflow 的唯一触发 owner；仅在用户或 skill 的触发规则明确要求时启用。

## Verification

- 根质量入口是 `bun run check`；每个 repository-visible 非根 `package.json` 必须有唯一 `name` 和可执行的 `scripts.check`。
- 测试面向公开行为和真实 consumer；跨 owner 或 shared contract 的改动同时验证 producer 与直接 consumer。

## Safety and conventions

- Binance 下单、撤单、调仓及其他真实写操作必须由用户明确授权；默认使用测试、dry-run 或 preview。
- 不把 secret、本机绝对路径或运行数据库写入仓库内容。
- 新增文档路径使用 ASCII、小写和短横线，`README.md`、`CONTRACT.md`、`SKILL.md` 等约定名称除外；正文优先中文，时间默认 `Asia/Shanghai`，Python 使用 `python3`。

## R&D strategy requests

- 仅在用户明确要求策略研发时使用 `research.rd-supervisor` production CLI；缺少 state 时通过 `--supervisor-job` 初始化。
- 开始前确保存在已校验并入队的 ready hypothesis；需要 discovery、validation 或 locked holdout 时，先由 `research/data-split` owner 生成 repo-relative split manifest。
- 有 validation manifest 的 hypothesis 优先跑 campaign；`mode=loop` 只消费 discovery。
- locked holdout 只在 hypothesis 与 candidate 已冻结且用户明确要求最终验证时使用，不得降低样本要求。
- 结束后检查 artifact、RD state 和 gate；`no_promote` 是有效结果，但不能表述为找到策略。复盘写入 `docs/research/reliability/rd-audit.md`。
