# Binance Order Preview Reference

只有在需要具体命令时再读本文件。

## 现货

```bash
cd .agents/skills/binance-order-preview
./scripts/main.ts --symbol BTCUSDT --market spot --side BUY --type MARKET --quote-order-qty 200
./scripts/main.ts --symbol ETHUSDT --market spot --side SELL --type LIMIT --quantity 0.2 --price 3200
```

## USDM 主单

```bash
cd .agents/skills/binance-order-preview
./scripts/main.ts --symbol BTCUSDT --market usdm --position-side LONG --side BUY --type MARKET --quantity 0.01
./scripts/main.ts --symbol BTCUSDT --market usdm --position-side LONG --side BUY --type STOP_MARKET --quantity 0.01 --stop-price 75280
./scripts/main.ts --symbol ETHUSDT --market usdm --position-side SHORT --side SELL --type TAKE_PROFIT --quantity 0.2 --stop-price 3150 --price 3152
```

## USDM 保护腿

```bash
cd .agents/skills/binance-order-preview
./scripts/main.ts --symbol BTCUSDT --market usdm --position-side LONG --side SELL --type STOP_MARKET --close-position true --stop-price 73600
./scripts/main.ts --symbol BTCUSDT --market usdm --position-side LONG --side SELL --type TAKE_PROFIT --reduce-only true --quantity 0.01 --stop-price 76800 --price 76820
./scripts/main.ts --symbol ETHUSDT --market usdm --position-side SHORT --side BUY --type TRAILING_STOP_MARKET --reduce-only true --quantity 0.2 --activation-price 2980 --callback-rate 1.2
```
