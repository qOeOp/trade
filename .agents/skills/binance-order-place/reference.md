# Binance Order Place Reference

只有在需要具体命令或低频参数时再读本文件。

## 常用命令

### 环境检查

```bash
cd .agents/skills/binance-order-place
./scripts/main.ts --check-env
```

### 现货

```bash
cd .agents/skills/binance-order-place
./scripts/main.ts --symbol BTCUSDT --market spot --side BUY --type MARKET --quote-order-qty 200 --yes
./scripts/main.ts --symbol ETHUSDT --market spot --side BUY --type LIMIT --quantity 0.2 --price 2800 --yes
./scripts/main.ts --symbol SOLUSDT --market spot --side SELL --type LIMIT_MAKER --quantity 5 --price 210 --yes
```

### USDM 立即进场

```bash
cd .agents/skills/binance-order-place
./scripts/main.ts --symbol BTCUSDT --market usdm --position-side LONG --side BUY --type MARKET --quantity 0.01 --leverage 20 --yes
./scripts/main.ts --symbol ETHUSDT --market usdm --position-side SHORT --side SELL --type LIMIT --quantity 0.2 --price 3200 --leverage 10 --yes
```

### USDM 突破进场

```bash
cd .agents/skills/binance-order-place
./scripts/main.ts --symbol BTCUSDT --market usdm --position-side LONG --side BUY --type STOP_MARKET --quantity 0.01 --stop-price 75280 --leverage 20 --yes
./scripts/main.ts --symbol BTCUSDT --market usdm --position-side LONG --side BUY --type STOP --quantity 0.01 --stop-price 75280 --price 75290 --leverage 20 --yes
./scripts/main.ts --symbol ETHUSDT --market usdm --position-side SHORT --side SELL --type STOP_MARKET --quantity 0.2 --stop-price 2980 --leverage 10 --yes
./scripts/main.ts --symbol ETHUSDT --market usdm --position-side SHORT --side SELL --type STOP --quantity 0.2 --stop-price 2980 --price 2978 --leverage 10 --yes
```

### USDM 回撤 / 反弹进场

```bash
cd .agents/skills/binance-order-place
./scripts/main.ts --symbol BTCUSDT --market usdm --position-side LONG --side BUY --type TAKE_PROFIT_MARKET --quantity 0.01 --stop-price 74200 --leverage 20 --yes
./scripts/main.ts --symbol BTCUSDT --market usdm --position-side LONG --side BUY --type TAKE_PROFIT --quantity 0.01 --stop-price 74200 --price 74190 --leverage 20 --yes
./scripts/main.ts --symbol ETHUSDT --market usdm --position-side SHORT --side SELL --type TAKE_PROFIT_MARKET --quantity 0.2 --stop-price 3150 --leverage 10 --yes
./scripts/main.ts --symbol ETHUSDT --market usdm --position-side SHORT --side SELL --type TAKE_PROFIT --quantity 0.2 --stop-price 3150 --price 3152 --leverage 10 --yes
```

### 测试 / 干跑

```bash
cd .agents/skills/binance-order-place
./scripts/main.ts --symbol BTCUSDT --market usdm --position-side LONG --side BUY --type STOP_MARKET --quantity 0.01 --stop-price 75280 --dry-json
./scripts/main.ts --symbol BTCUSDT --market usdm --position-side LONG --side BUY --type LIMIT --quantity 0.01 --price 65000 --test
```

## 低频但重要的脚本约定

- 依赖定义在 [package.json](./package.json)
- 只有首次运行缺依赖时再执行 `bun install`
- USDM 若显式传 `--leverage`，脚本会先把 symbol 杠杆调到目标值，再提交主单
- `--working-type` 默认 `CONTRACT_PRICE`
- 流动性差或极端行情下，如需降低插针干扰，可改成 `MARK_PRICE`
