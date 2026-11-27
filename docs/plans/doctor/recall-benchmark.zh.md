# `product-doctor` 实证召回基准与零召回剪枝规约（永久基准）

本记录确立 `product-doctor` 的**实证准入与淘汰基准（Real-Data Crucible & Historical Blind-Recall Benchmark）**：后续任何新增或修改 `product-doctor` 资产脚本、静态检查或调度规则，都必须用真实历史缺陷与真实会话转录给出可复现的召回率（Recall > 0）与低误报率（Low FP）实证；无法证明有效信号或与 CI 重复的机制一律删除。

---

## 一、三组实证熔炉总览（2026-11-27）

| 基准 | 靶标与输入（完全零提示 / 真实数据） | 实测结果 | 核心结论 |
|---|---|---|---|
| **Bench A（当前 `origin/main` 盲测）** | `origin/main` @ `d4460250a`（`/tmp/doctor-crucible/evidence_a/`） | **7 / 7** `doctor.py probe` `shown` 缺陷证实（含 `live`/`replay`/`ide`/`market` L4 链路死锁、持锁阻塞紧急停机、死 CLI action、UI 停轮询与杠杆契约错配、`months_missing` fail-open、REST 精度溢出） | `doctor.py probe` + `telemetry` + `surface` + `journey` 指南驱动全部核心检出；`posture` 暴露了与 CI 的大量重复项 |
| **Bench B（历史时间机器盲测）** | 历史基线 `16e51a5dc` / 靶标 `d876f6b3d`（`/tmp/doctor-crucible/evidence_b/`） | **32** 个 `doctor.py probe` `shown` 缺陷盲测独立检出，覆盖 `report`、`paper`、`live`、`engine`、`audit`（如 `deflated_sharpe` 常量除零、强平 `log1p(-1)` 崩溃、`attribution` 符号检验不可达、`paper` 持锁阻停机、`live` 静默丢日报与部分撤单幽灵态等） | 证明 `probe()` + `control()` 隔离复现、`telemetry` 冷热文件定位、`references/prod-ops.md` 静默失效分类学与 `references/journey.md` 具有极高跨版本迁移召回率 |
| **Bench C（真实转录 & 线上数据计分卡）** | 5 份真实 Claude Code 会话转录（19 MiB–219 MiB：`76a990ad`、`b5788262`、`9a986a50`、`fc932fd2`、`8c42632e`）+ 真实 `ci.json` / `issues.json` | 暴露 3 个自造 Schema 模块 **0% 真实有效召回**；`ad_hoc_ledger_sql` **0/30 TP（100% FP）**；`missing_research_skill` **0/2 TP（100% FP）**；`friction.py` 在 Claude Code 转录上 `user_turns=0`、将 `api-request-blob` 重复计入 10–30%、把 `research-sources` 合法单键读取与 `deploy/.env` 误报为密钥泄漏（43 个 FP），却在 `fc932fd2` 命中了 **8 个真实 `dolt/service.json` 读取 TP**；`evaluate_lens_slas()` 对从未审计的 `methodology` 矛盾输出 `no_overdue_lens_sla=True` | 用真实数据驱动了 Stage 3 减法剪枝与全部 5 类解析/调度缺陷修复 |

---

## 二、Stage 3 实证剪枝与修复清单（Before vs After）

### 1. 彻底删除（0% 有效召回 / 自造 Schema / CI 重复）

| 删减项 | 剪枝前行数 | 实证依据 |
|---|---|---|
| `assets/ops_invariants.py` + `tests/product_doctor/test_ops_invariants.py` | 1,107 + 434 | 依赖仓库中不存在的手造 `ops-status.json` Schema，真实靶标 0 召回 |
| `assets/prod_invariants.py` + `tests/product_doctor/test_prod_invariants.py` | 901 + 499 | 依赖手造 `--prod-state` / `prod-snapshot` 快照协议，真实运行 0 召回（保留 `references/prod-ops.md` 静默失效分类学与 `--prod-logs`） |
| `assets/research_quality.py` + `tests/product_doctor/test_research_quality.py` | 945 + 504 | 在 5 份真实策略研发转录上把合规探索误判为 `param_churn_ratio` 假阳性（0% 真实召回）；仅保留修复后的 25 行 `evaluate_lens_slas()` 迁入 `scheduler.py` |
| 5 个绑定上述已删模块的新增 eval 目录 | 5 eval suites | 严格限于本分支新增 eval（不动任何 `origin/main` 原有 eval） |
| `runtime_posture.py` CI 重复项（`replay_closure`、`check_docs_posture`、依赖锁解析） | -402 行 | 与 `tests/runtime/test_replay_closure.py`、`.github/scripts/skill-names.py`、`uv sync --frozen` 重复；保留高信噪比的 Dockerfile `@sha256:`、Python 安全 AST、跟踪凭据检查与 `cost --baseline` |
| `scheduler.py` 115 行英文正文 `REDLINE_PATTERNS` 正则墙 | -56 行（含新增修复） | 改由 GitHub `authority` / `authority:redline` 标签驱动，杜绝正文误匹配 |
| `friction.py` `ad_hoc_ledger_sql`（0/30 TP）与 `missing_research_skill`（0/2 TP） | 净裁剪并重写 | 消除 100% 假阳性规则，聚焦真实高信噪比信号 |

### 2. 真实数据修复（5 份真实转录与 `origin/main` 前后实测对比）

| 维度 / 会话 | 修复前（Before） | 修复后（After） |
|---|---|---|
| **总代码量（`.agents/skills/product-doctor/`）** | **10,257 行**（10 个资产脚本 9,713 行） | **6,796 行**（7 个资产脚本 6,276 行，净减 **-3,461 行 / -33.7%**） |
| **`friction` 流式解析 & 去重** | 整文件读入内存；`api-request-blob` 与重复 `tool_use.id` 膨胀 10–30% | 逐行流式读取；跳过 `api-request-blob` 并按 `tool_use.id` 去重（`76a990ad` `1172→1070`，`b5788262` `1303→981`） |
| **`friction` `user_turns`（Claude Code）** | 5 份会话全部错误输出 `0` | 准确计数真实人工轮次：`119` / `97` / `115` / `269` / `407`（排除 `tool_result` 与 `isMeta`） |
| **`friction` 活跃时长 `active_minutes`** | 仅壁钟跨度（11 天跨度报 `16303.9m`） | 连续间隔上限 30m 截断：`fc932fd2` `16303.9m→3540.4m active`，`8c42632e` `7329.6m→3138.2m active` |
| **`friction` `secret_file_access`** | 52 命中含 43 假阳性（`deploy/.env` 11、`research-sources` 单键查询 32） | **`76a990ad` 0、`b5788262` 0、`8c42632e` 0**；**`fc932fd2` 精准保留全部 8 个真实 `dolt/service.json` TP**；`9a986a50` 保留 1 个直接 `grep .env` |
| **`skills-audit --tree origin/main`** | 误报 4+ 个 `missed_skill_triggers`（未识别 Bash 读 `SKILL.md` / `.claude/skills/` / `Base directory for this skill:`，且把只读调试与 `--help` 计为策略研发） | 复用 `friction` 去重解析器 + 仅策略写/跑命令触发，5 份真实会话 **`missed: []`** |
| **`advise --tree origin/main`** | 显式传 `--tree origin/main` 仍打印默认警告；`no_overdue_lens_sla` 矛盾返 `True`；旧记录无冒号主语漏算（17 个对象超期）；`2026-11-25-partial-audit` 引用 `` `# Full audit` `` 误判非 partial | `stderr=''`；`no_overdue_lens_sla=False` 与 `lens_sla_breaches=['journey','methodology']` 自洽；`staleness_breach_count` 准确降至 `12`；`is_partial=True` 准确识别 |
| **`posture` / `surface` / `skills-audit` `--tree`** | 不支持 `--tree`，只能审当前工作区 | 统一通过临时 `git archive` 支持 `--tree REV` |

---

## 三、零召回淘汰铁律（Zero-Recall Elimination Rule）

对 `product-doctor` 未来的任何 PR 生效：

1. **禁止无实证堆脚本**：新增资产脚本或静态规则前，必须提供至少 1 个真实历史缺陷（或真实转录违规）的盲测复现证明（Recall > 0）以及在真实仓库/转录集上的误报率验证。
2. **禁止与 CI 重复造轮子**：若现有单测或 `.github/scripts/` 已覆盖某项确定性检查（如 `test_replay_closure.py`、`skill-names.py`、`uv sync --frozen`），`product-doctor` 不再维护平行副本。
3. **禁止自造未落地输入 Schema**：工具只能消费仓库真实存在的产物（Git 历史、真实日志文件、真实 CLI/IDE 输出、真实会话 JSONL），不得要求人工拼装仓库从未产出的中间 JSON 协议。
4. **保持纯 stdlib 与低复杂度**：`.agents/skills/product-doctor/assets/*.py` 必须保持 100% Python 标准库且每文件 `max_cognitive <= 47`。

---

## 四、Bench A & Bench B 新发现索引（备查，防止遗失）

以下为本轮零提示盲测在隔离靶场通过 `doctor.py probe`（`verdict: "shown"`）证实的真实缺陷索引（仅作备查记录，按 `product-doctor` 流程另行核对既有 Issue 后建单修复）：

- **Bench A（`origin/main` @ `d4460250a`，7/7 `shown`）**：
  - `p1_closed_line_explore_deadlock`：闭线后 `replay explore` 撞 `LINE_ENDED` 导致小资金 Live 证据补采死锁。
  - `p2_paper_compare_blocks_live_stop`：`live/reconcile.py` 在长时间 Paper 对比回放期间持共享锁阻塞紧急 `live stop`。
  - `p3_dead_cli_resolve_action`：CLI `--action resolve` 与后端分派契约不一致（400 `LIVE_CONFIG` vs 503）。
  - `p4a_live_evidence_leverage_mismatch`：Live 预读/UI 杠杆校验与 `prepare` 契约不一致。
  - `p4b_live_ui_evidence_polling_stops`：Live UI 证据轮询在错误分支后永久停止。
  - `p5_months_missing_fail_open`：月份缺口检查在边界输入下 fail-open 返回空列表。
  - `p6_metrics_rest_precision_overflow`：REST 指标解析高精度数值触发 `InvalidOperation` 溢出。
- **Bench B（历史时间机器 @ `16e51a5dc` / `d876f6b3d`，32 个 `shown`）**：
  - `report/`（9 项）：`deflated_sharpe` 常量收益除零、`measures` 强平 `log1p(-1)` 崩溃、`attribution` 非负指标符号检验不可达、`status` `mean_correlation` ULP 残差压扁有效试验数、`review` 空 `run_return` 绕过审计、`splits` 29 日/5 季度边界、`history` 未完成对照、`compare_reports` NaN 崩溃、`expectancy` 不可检。
  - `paper/` & `live/` & `engine/`（23 项）：`paper` 封存后迟到 K 线/孤儿恢复死循环/封存线程崩溃/持锁阻塞 `stop`/零权益除零/资金费 1ms 边界/`warmup` 覆盖/`audit` 过期停止；`live` 静默丢日报（`str` 分钟类型错配）/部分撤单幽灵态/`held` 失败穿透与首 tick 误报/平仓缺 K 线；`engine` & `audit` 撤单拒单/同时间戳 UUID/Live 成交 UUID/GTD 提前量对等/指标部分缺失崩溃。
