# 全局展示时区偏好：新增持久字段独立设计审查

2026-11-08。此审查发生在字段与实现添加之前，仅阅读当前前端状态/存储/设置和时间消费者；未改实现、运行服务、读取凭据或改变后端合同。用户已明确选择默认 UTC，并提供纽约、中国、日本切换，其中纽约为 `America/New_York`、自动处理 DST。

**结论：无存储设计阻断。批准记录该字段设计合理性：一个浏览器偏好键足够，复用现有持久 atom/storage 和 Settings radio；不需要后端字段、运行配置、ledger 字段、派生时间副本或第二套状态协议。此结论不是实现/视觉验收已通过。**

## 字段必要性与消费者

| 项 | 决定 |
| --- | --- |
| 唯一字段 | localStorage 的 `rg-time-zone`，通过现 `writeJson/readJson` 存一个 JSON 字符串；不要另加裸字符串存储通道 |
| 有效值 | 严格四选一：`UTC`、`America/New_York`、`Asia/Shanghai`、`Asia/Tokyo` |
| 默认/错误值 | 缺失、格式错误、不在四值中的值均按现 persistedAtom 的 validator 回退 UTC；存储不可用时页面内仍可切换，不宣称可跨重载保存 |
| 独立事实 | 用户主动选择的展示时区。相同原始 UTC 时刻可有四种合法展示，不能从该时刻、theme、当前设备时区、当前项目或账户推导用户选择 |
| 消费者 | 同一页面全部“时刻”展示、交易/订单/运行记录的时间、图表轴/十字线/浮层/事件标注等；Settings 显示当前选项 |
| 不存的派生数据 | 当前 UTC offset、DST 状态、四套已转换时间、格式化结果、每个窗口独立时区均不持久化；由 IANA zone＋事件时刻计算 |

现 `state/theme.ts` 使用 `persistedAtom("rg-theme",…)` 并由 `useAtom/useSyncExternalStore` 订阅；`state/atom.ts:19–24` 与 `lib/storage.ts` 已提供有效值校验、guarded localStorage、同页面通知。`shell/toolbar/SettingsMenu.tsx` 已有 DropdownLabel/DropdownRadio 分组，直接追加 Time zone 分组即可。无需引入另一 store、Context 持久方案或后端用户偏好 API。

## 实现必须遵守的语义边界

1. **只转换展示时刻。** 原始 epoch/ns、排序、duration、因果时钟、订单期限、行情请求范围、K线分桶、日收益/UTC业务日期和后端计算都不改变。Lightweight Charts 的数据 time 保持 UTC timestamp，改变 formatter 而非给全部点加 offset；否则会改变点的身份、间隔和 DST 时间顺序。
2. **纽约不能写死 UTC−5 或把当前offset套到全部历史。** formatter 明确使用 `America/New_York`，按每个时刻决定冬夏令时。回拨的两个 01:30 应在详细时间/tooltip 中可通过 EST/EDT 或 UTC offset 区分；不要只标恒定 EST。用户标签用 New York，IANA 值只作为机制输入。
3. **跨日转换同时处理日期和钟点。** 禁止 `getUTCDate()` 拼接所选zone的月份/时间，也不能把格式化后字符串固定 slice 当日期边界。当前 `chartTheme.ts` 就有 module-level UTC formatter 和 `getUTCDate` 组合，需要统一审视，不能只换其中一个 `timeZone`。
4. **旧无offset字符串按已知UTC合同解析。** 当前 `lib/format.ts::when` 只是截字符串，另一些入口直接 Date.parse；若将它们转成Date，不能让 `YYYY-MM-DD HH:mm:ss` 或 `YYYY-MM-DDTHH:mm:ss` 静默按设备本地时区解释。应只对确认是后端UTC的naive datetime形状明确规范化为UTC；已有Z/±offset须保留。纯 `YYYY-MM-DD` 是业务日期而非任意午夜时刻，不可一律转为纽约前一天。无效/缺失仍保留既有缺失展示，不猜时间。
5. **UTC业务日与展示日期要可区分。** Calendar/day filter/日收益的日期键、UTC区间仍保持原义并标明UTC。事件行的当地时刻跨到相邻日期时，显示完整选区日期或采用当地展示分组；不能把一个UTC日聚合简单改标题为某个当地日而暗示已重算。仅展示分组可以改变，筛选和收益事实不变。区间两端分别转换；跨当地日/DST时不拼接“第一端日期＋第二端时分”误导。

## 全局与即时更新

“全局”按本轮范围指同一页面全部消费者，不是只有 Settings 或 Live 卡片更新。单纯 formatter 内调用 atom.get() 不会让 React 已渲染文本刷新；消费链必须订阅或通过明确的统一展示订阅边界刷新。memoized formatter/derived label 的依赖须包含 zone。

Canvas 图表和 controller/primitive 并非 React 文本：应使用既有主题更新模式，切换时更新轴与crosshair formatter、触发绘制/刷新已打开浮层。不能以销毁后重新加载整个 run 或重新请求数据代替展示刷新。当前独立UTC消费者分布在 Paper Trades/Cycles/Events/Reconcile/TradeStrip、chartTheme、candleEvents/cycleBand、市场News/Liquidations等；实施时要做全页消费者清单，防止新Settings成为只影响单页的装饰。

同源页面重载由 persistedAtom 初始化读取同一个键即可恢复。浏览器localStorage共享不等于现有多个已打开tab实时同步：现 persistedAtom没有storage事件监听。**建议本轮不新增跨tab状态协议**，明确已打开其他tab在重载后采用最近保存选择；跨tab即时同步不是用户本轮“同一页面全局”的必要条件。若以后需要，与其他偏好统一设计，避免时区专属BroadcastChannel/版本/时间戳等额外状态。

## 验证建议（未在本审查执行）

- 四值、默认UTC、旧/损坏值回退，重载持久化；禁用localStorage后页面内仍可切换。
- 同一UTC时刻在四区正确显示；naive UTC字符串与带Z字符串表示同一instant，不因测试机器时区改变。
- 纽约DST春季跳时、秋季回拨，两次相同当地时分可区分；UTC午夜附近转换正确跨日。上海/东京无错误套用纽约DST规则。
- 切换后所有已显示时间、表格、chart轴/crosshair/打开的tooltip即时更新；原数据timestamps、排序、选中事件、视图范围与K线/日收益数据不变。
- UTC日历/业务日期标签保留语义；当地时刻跨日前后不出现日期标题与行内容矛盾。实际截图验收浅/深主题下新增Settings组的密度与可读性。

无新增持久事实之外的字段需求；本报告满足 AGENTS 对新增stored field的独立消费者/独立事实/不可派生性审查要求。后续实现仍需按实际变更验证，不能把此设计审查当成测试结果。
