- Market export: a contract whose prices lie off its tick's grid now exports at the decimals its prices need. Binance
  writes a tick at the contract's display precision (`0.0001000`), and those trailing zeros made the widened step finer
  than any price (币安人生USDT: 0.0000001 instead of 0.00001). Exports of such off-grid contracts change (their price
  precision and step); exports on the tick's grid are unchanged. `PRECISION_NARROWED` now compares with the tick's
  value decimals (`0.10` has one), not its written ones (doctor 20261121-28).
