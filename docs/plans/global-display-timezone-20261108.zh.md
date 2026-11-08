# UTC 计算与全局展示时区

用户要求：后端以 UTC 计算与保存，页面默认 UTC；Settings 提供纽约、中国、日本，同一页面切换后全部时刻同步更新。纽约采用 `America/New_York`，不固定为 UTC−5。

## 边界与复用

- 只新增一个浏览器偏好 `rg-time-zone`，四个 IANA 值。字段添加前的独立审查见 [存储审查](global-display-timezone-field-review-20261108.zh.md)。复用 persistedAtom、storage 和 Settings radio；不新增后端字段或偏好服务。
- `lib/time.ts` 是纯展示转换：明确解析已约定为 UTC 的无 offset datetime；已有 offset 保留；date-only 不当作时刻。ns 先用 BigInt 除到毫秒，再转换 Number，原始 ns 留在证据和排序中。
- `Intl.DateTimeFormat` 按事件自身日期处理 DST。纽约重复的当地钟点以 GMT offset 区分。所有转换只在展示消费者发生。
- 图表复用 Lightweight Charts 的原生 time/tick formatter、applyOptions 和既有 primitive 刷新；不平移 series time，不重建图表、不重采样或重设缩放。已打开 candle tooltip 保存语义 hover 目标，在时区变化时重新格式化。
- UTC 日收益、行情分区、研究窗口和选中日期过滤保持 UTC；日历标明 UTC day，并显示该日实际起止瞬间在所选时区的范围。duration、相对 age、倒计时不换区。原始日志、源码和证据 JSON 不作字符串改写。

## 消费者

Live：订单/持仓事件首列、账户观察、原生完成观察、证据观察/读取时间、账户检查及凭据保存时间。事件缺少原生时间时明确使用 observation time；两者均无效则留空，不能显示虚构的 1970 或当前时间。

Runs：Paper/Backtest/Live 共用的成交、cycles、events、reconciliation、运行健康、warm-up、日历、equity legend；图表轴、crosshair、stretch caption、cycle/fill/flag/offline tooltip。

其他页面：版本/审阅时间、市场来源与导入时间、新闻绝对时间提示、liquidations 起点、Agent probe 和聊天历史。聊天历史保存原始时刻，避免请求返回时固化旧时区文案。

同一页面即时更新，刷新保留选择；其他已打开 tab 依现有 persistedAtom 行为，在重新加载后读到最近保存值。没有新增时区专属跨 tab 同步协议。

## 后端核对

Python 的交易/行情/ledger 时间生产和 SQL UTC_TIMESTAMP 路径以 UTC 或 epoch 为基准。发现的 Paper orphan naive datetime.timestamp 缺陷由独立 [PR #2499](https://github.com/qOeOp/trade/pull/2499) 修复；原 600 秒阈值和恢复条件不变。专项验证覆盖 UTC/纽约/中国/日本宿主及夏冬边界。

固定 Dolt 2.7.2 与其 go-mysql-server 依赖：dolt_log 提交时间保留 epoch，TIMESTAMPDIFF 把输入转为 UTC 后计算 Unix 微秒差，未发现需要设置 session 时区的原因。无 offset API datetime 仍按现有 UTC 合同解释，不改历史或日期键。HTTP 日志 localtime 前缀属于展示格式，另行收敛，不当作交易计算错误。

## 验证范围

新增隔离测试覆盖默认与持久化、损坏偏好、四时区、跨年日界、纽约春跳/秋回拨、UTC 日范围、ns 精度和缺失值。前端全套 208 项及类型检查/构建通过。浏览器即时更新与浅深主题验收、独立实现评审在提交前后继续进行，未完成前不声称上线。

本变更不触发交易请求、重启运行、改变准入检查、策略或验收标准，也不证明 Live 其余重构已完成。
