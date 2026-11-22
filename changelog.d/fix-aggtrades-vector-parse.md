- Market: `market import-trades` (and `market follow`'s aggTrades months) checks and scales the archives a CSV block
  at a time instead of row by row: one month of ETHUSDT (31 M trades) imports in 19.5 s instead of 76.8 s from a warm
  cache, with byte-identical files. A day in any other spelling, or one a check refuses, is read row by row as before,
  with the same refusals (doctor 20261120-10).
