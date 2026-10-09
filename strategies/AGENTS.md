# Strategy sources

- Each independent strategy keeps its complete signal, sizing and native order rules in one Python file. Use Nautilus for execution and accounting.
- `r1.py` is the standalone H19a implementation. R1's 37 instruments share one fixed-capital native account; do not split them into independent strategies.
- Shared replay/data/report capabilities are in `backtest/r1`; other supported research variants are in `research/r1_variants`.
- Preserve causal clocks and native order protection. Source changes require paired replay against a frozen control before claiming equivalent behavior.
