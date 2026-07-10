# Observe Domain

## 输入

- account snapshot
- symbol snapshot
- runtime policy
- strategy directory
- optional tool runner output

## 输出

- normalized observe event body
- account projection
- market projection refs
- runtime load result

## 负责

- building observe events
- reading runtime config and strategy policy files
- calling read-only snapshot tools through CLI
- keeping observe facts separate from plan judgement

## 禁止

- 下单、撤单、减仓
- 产出 final target action without plan context
- 写 R&D evidence
- 持久化 market artifact without catalog owner

