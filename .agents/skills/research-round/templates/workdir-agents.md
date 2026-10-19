# 本目录是候选 <strategy_id@revision> 的工作副本

- 这里的源码不是记录。改完经 `candidate publish` 发布才成为新候选；工作副本随时可删。
- 改源码前先读文件头 27 项职责立场；只改本次改动涉及的职责行，登记时把这些编号写进 changed_duties。
- 文件头格式见同目录 strategy-header.md；拿不准某项立场时读 research-round 的 references/duty-directory.md。
- 规则与参数全部写在源码里；交易事实只取引擎状态；只用已收盘信息决策。
- 下一步：`candidate publish` → `replay precheck` → `registration add --source …` → `replay run`。
- 命令拒绝时，按返回的 next_actions 补齐再继续，不绕过。
