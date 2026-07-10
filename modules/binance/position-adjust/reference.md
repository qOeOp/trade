# Binance Position Adjust Reference

## 部分减仓

```bash
cd modules/binance/position-adjust
bun src/scripts/main.ts --symbol BTCUSDT --position-side LONG --reduce-quantity 0.01 --plan
bun src/scripts/main.ts --symbol BTCUSDT --position-side LONG --reduce-quantity 0.01 --yes
bun src/scripts/main.ts --symbol ETHUSDT --position-side SHORT --reduce-quantity 0.2 --yes
```

## 全平

```bash
cd modules/binance/position-adjust
bun src/scripts/main.ts --symbol BTCUSDT --position-side LONG --close-position true --plan
bun src/scripts/main.ts --symbol BTCUSDT --position-side LONG --close-position true --yes
```
