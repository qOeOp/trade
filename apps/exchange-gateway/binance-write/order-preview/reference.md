# Binance Order Preview Reference

只有在需要具体命令时再读本文件。

## USDM 主单

```bash
cd apps/exchange-gateway/binance-write/order-preview
bun src/scripts/main.ts --symbol BTCUSDT --position-side LONG --side BUY --type MARKET --quantity 0.01
bun src/scripts/main.ts --symbol BTCUSDT --position-side LONG --side BUY --type STOP_MARKET --quantity 0.01 --stop-price 75280
bun src/scripts/main.ts --symbol ETHUSDT --position-side SHORT --side SELL --type TAKE_PROFIT --quantity 0.2 --stop-price 3150 --price 3152
```

## USDM 保护腿

```bash
cd apps/exchange-gateway/binance-write/order-preview
bun src/scripts/main.ts --symbol BTCUSDT --position-side LONG --side SELL --type STOP_MARKET --close-position true --stop-price 73600
bun src/scripts/main.ts --symbol BTCUSDT --position-side LONG --side SELL --type TAKE_PROFIT --reduce-only true --quantity 0.01 --stop-price 76800 --price 76820
bun src/scripts/main.ts --symbol ETHUSDT --position-side SHORT --side BUY --type TRAILING_STOP_MARKET --reduce-only true --quantity 0.2 --activation-price 2980 --callback-rate 1.2
```
