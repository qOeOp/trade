当前阶段主要围绕 `docs/` 下的项目文档持续迭代，以下四份仍是当前核心文档：

- `docs/vision.md`
- `docs/prd.md`
- `docs/user-story.md`
- `docs/chat-history.md`

## Canonical Starting Point

- `docs/` 下面的文档默认都可编辑，不必先把范围收窄到四份核心文档
- 如果用户明确指定要修改某个文档，应直接以该文档为当前编辑目标
- 若用户未指定文档，直接根据当前意图选择最相关的 `docs/` 文档落笔，必要时再交叉参考其他文档
- `docs/vision.md`、`docs/prd.md`、`docs/user-story.md`、`docs/chat-history.md` 仍是当前阶段并行迭代的核心项目资产，可优先参考，但不排斥编辑其他 `docs/` 文档
- 若修改 `docs/prd.md` 或 `docs/user-story.md`，可用 `docs/vision.md` 做方向对齐参考，但不替代当前目标文件
- 若修改 `docs/chat-history.md`，应把它视为高价值项目资产与上游素材来源，而不是临时日志
- `README.md` 只作为仓库入口与摘要，不作为当前阶段的 vision 主文档
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
  `bun modules/research-strategy-development/rd-supervisor/src/scripts/main.ts --supervisor-job --db ./data/rd_state.db --program-id rd-program --catalog-db ./data/data_catalog.db --json '<payload>'`
- 若 `rd_program_state` 不存在，使用 `--supervisor-job` 让 supervisor 自行初始化；不要先手写 DB。
- 若 supervisor 返回空队列或无 ready hypothesis，这不是一次有效策略开发。按 `docs/rd-strategy-designer.md` 生成一条结构化 hypothesis contract，执行：
  - `research.strategy-hypothesis-designer --action validate`
  - `research.strategy-hypothesis-designer --action queue_item`
  - `research.rd-program-state --json '{"action":"update", ...}'` 写入 `next_hypothesis_queue` 并恢复 `status=active`
- 若 hypothesis 需要 discovery / validation / locked_holdout，先用 `research.data-split` 生成 repo-relative manifest；locked holdout 不得打开，除非用户明确要求冻结后验证。
- K 线不是稀缺资源。若现有 manifest 不够默认 `min_segment_rows` 或样本量明显不足，先用 `modules/market-data-products/ohlcv-fetch` 补足 OHLCV，或让 `research.data-split` 直接从 `data/ohlcv.db.canonical_candle` 切分；不要为了跑通流程降低 `min_segment_rows`。
- `ohlcv-fetch` 常用形态：`bun modules/market-data-products/ohlcv-fetch/src/scripts/main.ts --symbol BTCUSDT --timeframes 4h --limit 1500 --ohlcv-db data/ohlcv.db --market-data-db data/market_data.db --export-files --output-dir tmp/panels/<run-id>/source/btcusdt`。
- 带 `validation_manifest_path` 的 ready hypothesis 应优先作为 campaign 跑；如果显式用 `mode=loop`，必须说明它只跑 discovery，不会消费 validation。
- 运行结束后必须回看 artifact、RD state 和 gate，判断策略质量；`no_promote` 也算完成一次开发，但不能表述成“找到策略”。
- 过程问题、优化点、策略质量复盘记录到 `docs/rd-audit.md`；临时 hypothesis、split、artifact、DB 默认留在 ignored 的 `tmp/` / `data/`，不要写进长期 memory 或正式 strategy policy。

## Quality Guardrails

- 准备提交、跨语言改动或新增脚本后，跑 `scripts/quality-check.sh`
- 不把 compiler / typecheck / test / vet warning 当成可忽略噪音；能修则修，不能修必须在交付说明里标明原因
- 不把本机绝对路径写进 docs / code / helper 输出契约
