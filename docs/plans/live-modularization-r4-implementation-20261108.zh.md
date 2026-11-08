# R4：Runs 选择与 Live 视图数据边界

2026-11-08，独立 main 基线 7b66fea79。保留既有 Runs 页面、InlineWizard、LiveChart、HTTP协议和请求状态。

## 所有权

`model/runSelection.ts` 提取原 useShown 的纯选择投影，以 stage 区分 Live 的字符串运行ID和 Paper/Backtest 数字ID；原字段、fallback与各模式选择保持。`state/shown.ts` 只收集输入并委托该纯函数；`state/stage.ts` 使用共享类型，未新增持久字段。

`state/liveRun.ts` 是 Live 视图的数据入口，复用原 liveHome/run/actions。Canvas 的原只读 inspect effect 原样迁移，依赖仍为运行ID和 inspect 函数。Canvas、Details、Trades 的连接包装把数据交给视图；不新增轮询、账户事实或第二套订单状态。原 pending、停止操作、确认及请求重放检查均保留。Nautilus 不负责浏览器选择投影；本次不涉及交易机制实现。

## 验证

完整前端构建及203项测试通过，新增选择测试覆盖数字/字符串同值ID、模式切换保留选择、Live不混入Paper链及原空选择fallback。仓库Python标准测试1450项通过、9项按环境跳过（r4-full-tests.log）。

本机现有Chrome的全新临时上下文，四组桌面/手机×浅/深主题截图已检查；所有API为虚构内存响应，外部网络阻断。无隐式POST、无JS错误、无横向溢出。各组确认Escape关闭Review，刷新GET悬而未决时STOP仍可点击；仅显式点击产生一次模拟STOP，未连接服务器、交易所或读取用户浏览器资料。

证据在 `/tmp/trade-live-refactor-goal-20261108/r4-build-final-2.log`、`r4-browser/interaction-results.json` 与四组截图。缺少Playwright配套Chromium的首次失败保留，使用已安装Chrome复验；未安装浏览器或修改主机配置。等待冻结后独立审查。
