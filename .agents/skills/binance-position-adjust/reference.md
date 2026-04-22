# Binance Position Adjust Reference

## 部分减仓

```bash
cd .agents/skills/binance-position-adjust
./scripts/main.ts --symbol BTCUSDT --position-side LONG --reduce-quantity 0.01 --plan
./scripts/main.ts --symbol BTCUSDT --position-side LONG --reduce-quantity 0.01 --yes
./scripts/main.ts --symbol ETHUSDT --position-side SHORT --reduce-quantity 0.2 --yes
```

## 全平

```bash
cd .agents/skills/binance-position-adjust
./scripts/main.ts --symbol BTCUSDT --position-side LONG --close-position true --plan
./scripts/main.ts --symbol BTCUSDT --position-side LONG --close-position true --yes
```
