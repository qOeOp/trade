# AGENTS.md 与 product-doctor 全自动口径对齐方案（2026-11-27，供 Claude 拆 PR 参考）

- **来源**：仓库所有者 2026-11-27 明确授权与产品方向更新（同步见 `#3785` 评论与 `#3786`）
- **定位**：由于本工作树严格保持 `/Users/vx/WebstormProjects/trade` 主工作区零改动，且由 Claude 统一审阅/拆 PR/合入 `main`，此处沉淀可直接落地的最小修改规范。

## 1. 专用 200U 合约测试账户规则（更新 `AGENTS.md` 与 `product-doctor/SKILL.md`）

- **现状问题**：`AGENTS.md` 将一切真实 Binance Live 运行一刀切列为“Agent 永不启动”，已落后于实际运维方式，多次阻断正常实盘回归验证。
- **目标口径**：
  - **200U 专用合约测试账户**：免逐条授权，允许 Agent 在明确资金/仓位上限（总权益 <= 200 USDT，单笔名义价值最小可行）内自动执行实盘端到端回归与故障演练；仍严禁打印、回显或落盘 API Key/Secret。
  - **主资金账户**：保持原有红线，Agent 严禁触碰。
  - **左移优先**：多合约/多轨道/内存上限/重连与 checkpoint 恢复优先在 `#3786` 的加速仿真浸泡 fixture 上验证，再用 200U 测试账户做最小实盘烟测。

## 2. 取消定时全自动档下的 `authority` 阻塞设计

- **现状问题**：全自动定时任务模式下，将 25 条 open `agent-finding` 长期挂在 `authority` 阻塞队列会形成死锁或大量积压。
- **目标口径**：
  - `doctor.py advise --auto --steady-exit-code 2` 提供 0-token 定时任务门禁：`--auto` 下 `authority` 不再阻断 `actionable_harm`，`steady` 时以退出码 `2` 直接终止而不唤醒 LLM。
  - Claude 在合入 PR 3 / PR 5 时，可将 `AGENTS.md` / `record.md` 的 `authority` 范围收窄为极少数不可逆物理/资产红线（字体、主资金账户、破坏性清库/删历史、发版 tag），普通代码/测试/拒收修复走全自动闭环。

## 3. 新增的两条确定性信号通道（已在 v3.0 `friction.py` / `scheduler.py` / `doctor.py` 原型实现）

1. **生产服务日志遥测（`--prod-logs`）**：直接扫描生产 Paper/Live/IDE/Dolt 日志中的 OOM（`ExitCode: 137` / `oom-killer`）、持续 checkpoint 延迟（`Paper checkpoint deferred:` >= 3，直接捕获 `#3783`）、`PAPER_RECOVERY_UNAVAILABLE`、WS 重连风暴、异常爆发与静默 0 行日志（日志系统自身缺陷），自动路由到对应服务对象的 `operation` 镜头。
2. **研发会话流程遵守度遥测**：在 `analyze_transcripts` 中以隐私安全方式确定性检出直接 `dolt sql`/`mysql` 绕过 CLI、读取 `.env`/`dolt/service.json` 红线文件、以及执行研究命令但未加载 `research-round`/`research-start` 技能的过程漂移。
