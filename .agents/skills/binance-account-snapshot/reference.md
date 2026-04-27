# Binance Account Snapshot Reference

只有在需要具体命令或边角分类细节时再读本文件。

## 常用命令

### 环境检查

```bash
cd .agents/skills/binance-account-snapshot
./scripts/main.ts --check-env
```

### 完整账户快照

```bash
cd .agents/skills/binance-account-snapshot
./scripts/main.ts
```

### 单标的核对

```bash
cd .agents/skills/binance-account-snapshot
./scripts/main.ts --symbol BTCUSDT
```

### 补历史订单

```bash
cd .agents/skills/binance-account-snapshot
./scripts/main.ts --symbol BTCUSDT --include-history
./scripts/main.ts --symbol BTCUSDT --include-history --history-limit 50
```

## 低频但重要的判读细节

- 当母单出现 `strategyType=OTO` 或 `OTOCO` 时，公共 API 可能读不到附带 TP/SL 明细；若出现 `manualTpSlRequired=true`，要明确提示用户手动提供价格
- 若某接口失败，不要让整次分析报废，要明确缺了哪一块
- 端点和分类补充见 [references/endpoints.md](./references/endpoints.md)
