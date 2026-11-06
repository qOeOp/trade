# 2026-11-06 底部工具缺少页面上下文

## 范围与证据

用户先报告 Coins、News 应只在 Market 时显示。聚焦诊断，当前 main 为 dc49edba7，
线上 IDE 为 f217f838。`Shell` 把 overview 服务是否存在交给 `toolWindows`，后者把
Coins、News、Trades 与研究工具一起全局注册；`Stripe` 的左下工具和 `commands` 的快捷键、
命令面板均读取同一清单。`state/shell.ts` 明确把右、下工具状态当成跨页共享。

## 发现

| id | 发现与消费者 | 动作 | 代价 | 状态 |
|---|---|---|---|---|
| 20261106-07 | 用户先发现（Product contracts and delivery）。底部工具由服务可用性控制，未按当前页面过滤，Coins、News 在研究和 Runs 中仍能打开，切页后原窗口继续显示，命令面板和快捷键同样泄漏页面上下文 | fix | wrong output | in PR [#2224](https://github.com/qOeOp/trade/pull/2224) |

## 修复决定

统一按当前页面选取底部工具：Market 为 Coins、News；Runs 为 Trades；研究图和 Sources
为研究工具及未知研究 widget。右侧 Agent、Details 保持共享。切页时把不适用的已打开和
上次使用的底部窗口映射到该页默认项，隐藏状态保留。上下文过滤同时作用于工具条、窗口、
命令面板和快捷键清单，不另建多套可用性状态或存储字段。

`none` 和技能无法改变界面可点击入口；只隐藏图标会留下快捷键和已打开窗口，统一过滤
现有工具注册表及规范化既有 shell 状态最小。不加拒绝、审计规则或研究限制。

验证覆盖：Market→News→Runs→研究→Sources 的重复切换，隐藏底栏后跨页、重开快捷键，
Agent 在页间保持打开。仅为工程验证，不把它记作后续研究会话的 verified。

## 工程验证

- `npm run build --prefix ide/web`：类型、规则检查、87 项前端测试和生产构建通过。
- 独立浏览器，线上只读快照驱动本地预览：亮暗主题截图均已检查，无页面脚本异常。
- 全量 Python 测试：918 run，302 skipped，5 errors，均为本机 Dolt 1.80.2 与要求的
  2.4.2 不符；main dc49edba7 的同五项 reproduction 测试也失败。
- PR title 与 `git diff --check` 通过。未部署此修复，没有改动线上运行。

截图与只读快照位于 `/tmp/trade-ide-display-review/`；这些是工作副本，不进 Git。
