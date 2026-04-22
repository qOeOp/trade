# Binance Position Protect Reference

## 当前 live 仓位保护

```bash
cd .agents/skills/binance-position-protect
./scripts/main.ts --symbol BTCUSDT --position-side LONG --close-position true --stop-loss-trigger 73600 --yes
./scripts/main.ts --symbol BTCUSDT --position-side LONG --close-position true --stop-loss-trigger 73600 --take-profit-trigger 76800 --yes
./scripts/main.ts --symbol ETHUSDT --position-side SHORT --close-position true --take-profit-trigger 2980 --yes
```

## 显式数量保护

```bash
cd .agents/skills/binance-position-protect
./scripts/main.ts --symbol BTCUSDT --position-side LONG --quantity 0.01 --stop-loss-trigger 73600 --take-profit-trigger 76800 --yes
./scripts/main.ts --symbol ETHUSDT --position-side SHORT --quantity 0.2 --take-profit-trigger 2980 --take-profit-limit-price 2978 --yes
```

## trailing 保护

```bash
cd .agents/skills/binance-position-protect
./scripts/main.ts --symbol BTCUSDT --position-side LONG --quantity 0.01 --trailing-activation-price 75800 --callback-rate 1.2 --yes
./scripts/main.ts --symbol ETHUSDT --position-side SHORT --close-position true --trailing-activation-price 3020 --callback-rate 1.0 --yes
```
