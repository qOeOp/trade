# 2026-11-21 没有恢复协议的源码仍能启动 Paper

| Item | Value |
|---|---|
| Sessions | 远端 Paper 运行 2、3、4（`pa-trend-second-entry@52`、`hf-15m-vwap-reversion@21`）的 runner.log；无研究会话 |
| Audit session | Claude Code（Claude Opus 5.5），0.5.0 清理协调会话分派的修复会话；修复 PR 见索引 |
| Checkout / ledger | `origin/main`；未读写账本或市场 |
| Coverage | `paper/runs.py` `start`、`engine/paper_session.py` `declares_recovery`、`engine/load.py` `source_findings`、`paper/README.md` 恢复一节、research-round `strategy-authoring.md`（#3294）。缺口：没有统计其他候选的源码 |
| Cost | unknown；三个运行各因一次中断（计划内重启、短暂 VM 停顿）结束，后续观察作废 |
| Net change | 新增一个拒绝码 `PAPER_RECOVERY_UNDECLARED`；不增存储字段；技能 +7 词 |

## Findings

| id | Finding | Evidence (session or norm; current product; consumer and decision) | Action | Cost | Status |
|---|---|---|---|---|---|
| 20261121-27 | `paper start` 不检查源码是否声明恢复协议，没有 `PAPER_RECOVERY = 1` 与 `on_save`/`on_load` 的源码照常启动，第一次中断就结束或转托管 | **运行证据**（[#3294](https://github.com/qOeOp/trade/pull/3294) 正文所引，本会话未重读远端文件）：运行 2、3、4 的 runner.log 都是 `PAPER_RECOVERY_UNAVAILABLE: the source has not completed its recovery protocol`，两份源码都没有这三个名字；运行 2 在计划内主机重启时结束，运行 3、4 在一次短暂 VM 停顿后结束。<br>**当前产品**：判定只在运行时由 runner 加载类后做（`engine.paper_session.declares_recovery`），写进 `started` 行的 `recovery_declared`，页面据此标 `Held on restart`；启动前没有任何拒绝或提示。用户期望 Paper 跨重启、发版连续跑几天，Live 准备需要一次中断后未转托管的封存 Paper 运行（`live/README.md`）。<br>**消费者**：`paper start` 与 IDE 的 Paper 启动 | authority（新增启动拒绝；Claude 按用户委托决定） | unknown | 见索引 |

## Decisions

- 2026-11-21 用户把需要定夺的事项交给 Claude（「需要我定的部份最后也是一样由你决定按推荐做」），0.5.0 清理协调会话据此决定在 `paper start` 加拒绝：
  - runner 的判定要执行源码，控制侧不执行源码（只有运行时镜像跑源码），所以启动时只查必要条件：源码的标识符与字符串里缺 `PAPER_RECOVERY`、`on_save`、`on_load` 任一个就拒绝 `PAPER_RECOVERY_UNDECLARED`（`paper.runs.unnamed_recovery`），在复制源码、拉镜像、起容器之前。源码检查拒绝 `getattr`、`setattr`、`vars`、`exec` 与双下划线名，缺名字的源码除非把名字拼出来，都过不了 runner 的判定，所以这条拒绝不会挡住 runner 会接受的源码。
  - 三个名字都写了但 runner 判定不通过的（例如 `PAPER_RECOVERY = 0`），照常启动，由 `recovery_declared` 标出，与之前相同。不复用 11-18 删掉的源码文本判定（它按文本推断结论，会误读重新赋值、计算值等写法）。
  - IDE 不改：拒绝经 `paper serve` 以 409 交给现有的拒绝提示。
