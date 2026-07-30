当前阶段主要围绕 `docs/` 下的项目文档持续迭代，以下四份仍是当前核心文档：

- `docs/product/vision.md`
- `docs/product/prd.md`
- `docs/product/user-story.md`
- `docs/product/chat-history.md`

## Canonical Starting Point

- 文档分层、authority 与新文档归位先看 `docs/README.md`
- `docs/` 下面的文档默认都可编辑，不必先把范围收窄到四份核心文档
- 如果用户明确指定要修改某个文档，应直接以该文档为当前编辑目标
- 若用户未指定文档，直接根据当前意图选择最相关的 `docs/` 文档落笔，必要时再交叉参考其他文档
- `docs/product/vision.md`、`docs/product/prd.md`、`docs/product/user-story.md`、`docs/product/chat-history.md` 仍是当前阶段并行迭代的核心项目资产，可优先参考，但不排斥编辑其他 `docs/` 文档
- 若修改 `docs/product/prd.md` 或 `docs/product/user-story.md`，可用 `docs/product/vision.md` 做方向对齐参考，但不替代当前目标文件
- 若修改 `docs/product/chat-history.md`，应把它视为高价值项目资产与上游素材来源，而不是临时日志
- `README.md` 只作为仓库入口与摘要，不作为当前阶段的 vision 主文档
- 产品、架构、runtime 大功能、research、engineering 文档分别进入 `docs/product/`、`docs/architecture/`、`docs/runtime/`、`docs/research/`、`docs/engineering/`
- 已完成施工计划和一次性审查进入 `docs/history/`；不得在 `docs/` 根目录新增散文件，也不得让 history 覆盖当前合同
- 当前手写文档统一声明 `title / role / status / owner / last_verified`，并登记到 `docs/engineering/doc-contract-index.json`；`bun scripts/check-doc-contracts.ts` 是文档级最低检查
- 单模块合同留在模块 `CONTRACT.md`；只有跨模块或大功能语义才上提到 `docs/`
- `.agents/skills/` 只允许保存 Codex 工作流说明、可选 UI metadata 与 `scripts/` 下无项目依赖的确定性工作流 helper；helper 只能编排既有 MCP / toolset / host owner surface，不得承载领域源码、schema、数据库、第二套领域 CLI 或独立 authority
- 文档写作保持高承重和克制，不提供大段文字，优先追求极致压缩的信息密度
- 如果新的写法和现有核心文档还没对齐，不要提前把临时想法写成固定制度

## Current Rule

- 不预先设计我们还没决定的结构
- 不预先固定 tool 数量、tool 职责、记录模型、策略流程
- 不把临时想法写成长期 memory

## Path Convention

- 路径和文件名使用 ASCII、小写、短横线
- 正文内容优先中文
- 时间默认使用 `Asia/Shanghai`

## Automation Guardrails

- 涉及 automation memory 时，不要直接拼接 `$CODEX_HOME/...`
- 一律通过 `scripts/automation-memory-path.sh <automation-id>` 解析 memory 路径；当 `CODEX_HOME` 为空时，它会自动回退到仓库内 `.codex`
- 需要 Python 命令时，不要假设 `python` 存在；优先用 `python3`，或先通过 `scripts/resolve-python.sh` 解析可用命令

## R&D Strategy Development Runbook

当用户要求“运行一次 RD 开发策略 / 跑一次策略研发 / J04 R&D”时，不要从 `package.json`、`toolset.json` 重新摸入口；直接按本节执行。

- 标准入口是 `research.rd-supervisor`：
  `bun modules/research-strategy-development/research-control-plane/program-supervisor/src/scripts/main.ts --supervisor-job --db ./data/rd_state.db --program-id rd-program --catalog-db ./data/data_catalog.db --json '<payload>'`
- 若 `rd_program_state` 不存在，使用 `--supervisor-job` 让 supervisor 自行初始化；不要先手写 DB。
- 若 supervisor 返回空队列或无 ready hypothesis，这不是一次有效策略开发。按 `docs/research/strategy/rd-strategy-universe-design.md` 与 `modules/research-strategy-development/agent-roles/planner/strategy-hypothesis-designer/CONTRACT.md` 的边界生成结构化 hypothesis contract，执行：
  - `research.strategy-hypothesis-designer --action validate`
  - `research.strategy-hypothesis-designer --action queue_item`
  - `research.rd-program-state --json '{"action":"update", ...}'` 写入 `next_hypothesis_queue` 并恢复 `status=active`
- 若 hypothesis 需要 discovery / validation / locked_holdout，先用 `research.data-split` 生成 repo-relative manifest；locked holdout 不得打开，除非用户明确要求冻结后验证。
- K 线不是稀缺资源。若现有 manifest 不够默认 `min_segment_rows` 或样本量明显不足，先用 `modules/market-data-products/ohlcv-fetch` 补足 OHLCV，或让 `research.data-split` 直接从 `data/ohlcv.db.canonical_candle` 切分；不要为了跑通流程降低 `min_segment_rows`。
- `ohlcv-fetch` 常用形态：`bun modules/market-data-products/ohlcv-fetch/src/scripts/main.ts --symbol BTCUSDT --timeframes 4h --limit 1500 --ohlcv-db data/ohlcv.db --market-data-db data/market_data.db --export-files --output-dir tmp/panels/<run-id>/source/btcusdt`。
- 带 `validation_manifest_path` 的 ready hypothesis 应优先作为 campaign 跑；如果显式用 `mode=loop`，必须说明它只跑 discovery，不会消费 validation。
- 运行结束后必须回看 artifact、RD state 和 gate，判断策略质量；`no_promote` 也算完成一次开发，但不能表述成“找到策略”。
- 过程问题、优化点、策略质量复盘记录到 `docs/research/reliability/rd-audit.md`；临时 hypothesis、split、artifact、DB 默认留在 ignored 的 `tmp/` / `data/`，不要写进长期 memory 或正式 strategy policy。

## Development Convergence Guardrails

- 当前处于恢复期，先修复红灯并打通已有链路，不继续扩张责任面
- 开工前先确定复用的 owner 与 production consumer；找不到 consumer 的实现优先接入、合并或删除
- `module owner / registered tool / domain / store / job / rail` 不得超过 `docs/engineering/convergence-baseline.json`
- Agent 不得自行提高 convergence baseline；只有用户明确批准后才能修改上限
- package、schema、文档或单元测试本身不算功能完成；必须提供现有 runtime / CLI / server 入口的消费证据和跨 owner 链路证据
- 不按文件或步骤制造微提交；一个可验证行为闭环完成定向验收后，才形成一个有意图的提交
- `main` 的 required `quality` / CodeQL 为红时只修复红灯，不推进新增功能；PR 候选在合并前由远端 required checks 收口
- 交付按 `docs/engineering/development-convergence.md` 报告用户行为、production consumer、运行证据和表面积变化

## Quality Guardrails

- 当前单 owner、黑灯工厂式 PR 对普通开发候选默认不引入人工 reviewer、required approval、CODEOWNER / last-push approval、manual exact-SHA、repository variable 管理员确认或其他人在环 authority gate；Codex、Dependabot、CI、CodeQL 与自动 review / fix / retry / merge 可以参与
- 经 PR 交付时，本地只跑受影响 owner 的定向 test / typecheck / doc-or-architecture check、真实 production consumer journey、完整 diff inspection 与必要 workspace safety；不默认运行 `quality-check-changed.ts`，也不把本地 `scripts/quality-check.sh` 当作 commit / push 前总闸
- GitHub required `quality` aggregate 与 JavaScript/TypeScript、Python、Rust、Go 四个 CodeQL context 承担未触及其信任面的普通候选的全仓 merge closure；某个 CI leaf 失败后只本地复现并修复对应 owner / leaf，不自动重跑本地全仓门
- 不经 PR 的交付保留与风险相称的本地检查；CI 不能替代 live / runtime / production consumer 验收
- 普通开发候选不得包含合并 workflow、quality judge、裁判 policy 或结果签发面的改动。确需升级该信任面时，先拆成独立 governance candidate，由候选不可控的 owner surface 验收；验收完成后再生成新的开发候选。缺少该 authority 时必须阻塞，也不默认恢复 manual exact-SHA quality-authority
- 依赖更新与普通代码 PR 走同一自动收口链路；无法收口时保持阻断，不转交人工审批
- 不把 compiler / typecheck / test / vet warning 当成可忽略噪音；能修则修，不能修必须在交付说明里标明原因
- 不把本机绝对路径写进 docs / code / helper 输出契约
