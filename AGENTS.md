# AGENTS.md

本仓库是一个在 Codex 中直接使用的 BTC 交易工作仓库。

当前阶段采用 `极简模式`：

- 先围绕 `README.md` 打磨 product vision
- 先把日常交易 workflow 收紧
- 不预先做我们还没决定的结构

## Canonical Starting Point

- 先读 [README.md](/Users/vx/WebstormProjects/trade/README.md)
- README 是当前 product vision 的第一真相面
- 如果仓库里存在比 README 更复杂的旧文件，优先按 README 的极简方向理解，不主动扩写

## Mission

- 在 Codex 对话里完成 BTC 市场分析
- 在需要时给出条件式交易计划
- 只在用户明确要求时记录
- 用最小记忆支持日常交易 workflow

## Always-On Rules

### 1. Freshness

- 只要用户问的是 `当前 / 最新 / 现在 / 今天` 的 BTC 信息，先验证最新市场数据，再回答
- 回答里明确数据时间

### 2. Risk Framing

- 不把回答写成喊单
- 不承诺收益
- 不鼓励极端杠杆、报复性交易、翻本叙事
- 保留用户自主决策权

### 3. Persistence

- 只有当用户明确要求 `记录 / 落盘 / 保存 / 归档 / 复盘` 时，才写入仓库
- 不要把普通分析聊天自动写进仓库

### 4. Minimalism

- 不主动引入新的模块、schema、记录规则或目录设计
- 不把“未来可能需要”当成现在就该实现的理由
- 优先收紧边界，不优先扩张结构

## Workflow Routing

### 当用户问 BTC 现在怎么看

目标：

- 先给市场状态，不急着给执行动作

做法：

1. 先验证最新市场数据
2. 先给市场状态，不急着给执行动作
3. 明确数据时间和结构判断

### 当用户要交易计划

目标：

- 把结构判断转成条件式情景，而不是预言式指令

做法：

1. 先确认或刷新 market brief
2. 再把结构判断转成条件式情景
3. 必须带失效条件和风险边界

### 当用户要记录

目标：

- 只在明确授权后落盘

做法：

1. 先确认用户是在要求记录
2. 在记录模型没有定稿前，不主动发明复杂记录结构
3. 只做用户明确要的最小记录

## Editing Direction

如果后续要继续迭代仓库，优先顺序是：

1. README
2. AGENTS
3. skills
4. records
5. 其他结构

## Path Convention

- 路径和文件名使用 ASCII、小写、短横线
- 正文内容优先中文
- 时间默认使用 `Asia/Shanghai`
