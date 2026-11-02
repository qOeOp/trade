# 市场回执按位置归属，不再拒绝重复回执

2026-11-03，市场 Parquet 存储第 3 步（`market convert`）的独立审阅之后。用户授权：“Yes, change it”。

## 问题

- 第 2 步的 `market.commit_version` 在 head 已列出同一份回执（规范 JSON 的 SHA-256 相同）时拒绝（`CHECK_FAILED`），
  因为 `market.imports` 按回执的内容找“链上最早列出它的版本”，重复的回执会归错。
- 两次表结构升级的回执都是 `{"import": "market-upgrade"}`，会撞上这条拒绝。第 3 步原先给升级回执加了 `version`
  字段（升到的表结构版本）来区分。
- 真实历史里也可能有完全相同的两份导入回执：同一天的 K 线重导一次，K 线和资金费都没有新行，只多了条款行，
  提交信息一字不差。转换会因此整个拒绝；第 4 步改成每天导入之后也会碰到。

## 字段审阅（独立子 Agent）

升级回执的 `version` 不该加：
- 没有读它的地方。`commit_version` 自己用父版本加一，`market review` 看 `market_schema`。
- 不是独立事实：它等于第一个列出这份回执的版本的 `market_schema.version`，可以推出来；也没有任何地方核对它，
  会成为第二个事实来源。
- 它唯一的作用是绕开“回执重复即拒绝”。

## 决定

- `market.imports` 按位置归属：一个版本把它那些导入的回执接在父版本的回执之后，第 i 份回执由父版本链上回执多于
  i 份的最老版本写入。两份相同的回执按位置各归各的。
- 删掉 `commit_version` 里“head 已列出同一份回执”的 `CHECK_FAILED`（放宽一项拒绝，用户授权）。
- 升级回执只是 `{"import": "market-upgrade"}`，不加字段。
- 被否掉的另一种做法：升级回执记 `table`（加的是哪张表），由 `commit_version` 和 `market review` 核对。这是新增
  检查，同样要授权，而且解决不了导入回执重复的问题。

`market review` 的父子链核对不变：子版本的 `receipts` 必须以父版本的全部回执原样开头，归属所依赖的位置因此不会被改写。
