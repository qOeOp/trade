# 2026-11-06 Paper 图表缩放异常

| 项目 | 内容 |
|---|---|
| 范围 | 用户报告 Paper 页面整页灰屏，滚动到边缘、缩放时复发； focused diagnosis |
| 当前产品 | origin/main e03d6af91；生产页面 127.0.0.1:8765，ema-entryvar@2 |
| 证据 | 用户截图整页只剩背景；本机会话用实际页面切到 Runs / Equity，再连续向内、向外派发滚轮，捕获 59 次 `Cannot read properties of null (reading 'maxValue')`，堆栈顶端是 exposure series 的 autoscaleInfoProvider。Lightweight Charts 5.2.1 的 AutoscaleInfo.priceRange 明确允许 null，而 equityExtras.ts 把回调参数错误标成非空并直接访问。此次探针页面 root 尚未卸载，不能把整页灰屏的每次发生都归因于这一堆栈 |
| 代价 | wrong output；未计量会话成本 |
| 净变化 | 在原图表 consumer 使用库的真实 nullable 类型，空区间保持合法的 exposure 基线；不改数据、账户、拒绝或存储 |

## 发现

| id | 发现 | 消费者 | 动作 | 状态 |
|---|---|---|---|---|
| 20261106-03 | 收益图 exposure 纵轴读取空 priceRange，滚动/缩放触发未捕获异常 | EquityExtras.attach 的 autoscaleInfoProvider；动画帧与 React effect 均可触发自动纵轴计算 | fix：接受 null priceRange，覆盖真实回调契约与浏览器缩放路径 | open |

## 决定

用户已授权产品修复、合并与生产部署。先消除此确定根因，再复测整页灰屏。控制台另见 `Value is null` 绘图异常，需独立定位，不能借本修复声称它已解决。

## 继续诊断

开发构建启用库的时间顺序校验后，实际复现 root.childElementCount=0、body 无文本，堆栈为 `data must be asc ordered by time, index=521, time=1793440800, prev time=1793575800`。独立根因是 downSlots 对无行情中间运行形成的重叠 gap 重复插入时间；另记 20261106-04 并单独修复。本条仍只处理 nullable autoscale，不能据此声称独自解决整页灰屏。

验证：`npm run build` 通过；包含真实空 priceRange 回调的 79 个前端测试通过。浏览器原有 maxValue 异常消除，剩余时间倒序异常在另一条修复处理。
