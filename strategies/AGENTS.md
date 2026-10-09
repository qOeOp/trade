# Strategy sources

- Each independent strategy keeps its complete signal, sizing and native order rules in one Python file. Use Nautilus for execution and accounting.
- Publish complete Strategy bytes and revisions to Dolt through `research.records.cli strategy`; develop and export working files outside product Git. H19a's current logical identity is `r1.broad-two-tier`, family `r1`, entry class `R1Strategy`, runtime contract `r1-native-v1`. R1's 37 instruments share one fixed-capital native account; do not split them into independent strategies.
- Shared replay/data/report capabilities are in `backtest/r1` and the fixed runtime image. Historical research variants retain their old Git identities until their complete rules are individually consolidated and published; they are not supported by the current external-source runtime contract.
- Preserve causal clocks and native order protection. Source changes require paired replay against a frozen control before claiming equivalent behavior.
