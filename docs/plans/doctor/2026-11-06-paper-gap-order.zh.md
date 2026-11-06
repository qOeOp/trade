# 2026-11-06 Paper 重叠离线区间使图表时间倒序

| 项目 | 内容 |
|---|---|
| 范围 | 用户报告 Paper 整页灰屏、滚动到边缘和缩放时发生；产品契约与交付的 focused diagnosis |
| 当前产品 | origin/main e03d6af91；实际生产 run 4–7 的只读输入 |
| 证据 | run 5 无行情。相邻 run 4→5、5→6 的两个 gap 在 downSlots 中都以 run 4 最后权益点、run 6 第一权益点为边界，各生成同一套 minute slots，flatMap 后出现重复与倒序。开发构建在 EquityChart.setData 抛出 `data must be asc ordered by time, index=521, time=1793440800, prev time=1793575800`；浏览器实测 root.childElementCount=0、body 无文本。生产库关闭顺序断言后，同输入表现为 `Value is null` |
| 代价 | wrong output；会话耗时未测量 |
| 净变化 | 生成离线 slots 的公共 consumer 返回严格升序的唯一时刻；收益和 K 线共用，不靠隐藏库异常或修改原始 journal 解决 |

## 发现

| id | 发现 | 消费者 | 动作 | 状态 |
|---|---|---|---|---|
| 20261106-04 | 无行情的中间运行使两个离线区间映射到相同样本边界，重复插入 slots | downSlots → withDowns → continuous/resample → EquityChart.setData；candleDown/onScale 也消费相同 slots | fix：在 slots 生成处去重并排序，保留实际运行边界说明 | open |

## 决定

用户已授权修复、合并和部署。与 20261106-03 的空 autoscale 回调分 PR。不添加存储字段，不改变交易、账户或封存记录。

验证：`npm run build` 通过，79 个前端测试通过；新增用例覆盖无行情中间运行、倒序 gap 输入、K 线最小空白槽和所有收益采样粒度。原始生产运行只读，整合浏览器验证在两项图表修复合并后继续。

整合验证（包含 #2202）：80 个前端测试通过。用实际只读 run 4–7 输入，在 dark/light、1600×1100 和 1200×900（DPR 1/1.5），连续缩放、BTC/Equity 切换及 resize 后，捕获的 error 数为 0，React root 保持一个子节点、图表保持 7 个 canvas。独立 PR #2202 已合入 main。
