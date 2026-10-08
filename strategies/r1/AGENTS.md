# Native replay POC

- Purpose: verify one frozen 37-instrument shared-account RD replay against published Nautilus.
- Entries: `run_portfolio.py` remains the full research runner; `run_portfolio_node.py` is the native Catalog funding-loader proof for H18a/H19a. Native Strategy source is adjacent. `funding_catalog.py` belongs only to the older manual `BacktestEngine.add_data()` entry.
- Contract: retain one native margin account, LAST/MARK bars, funding settlements, fees, native order protection and zero denied/rejected orders. Do not turn this POC into a second engine or research workflow.
- Check: run the BTC/ETH pilot, then the full 37-instrument replay. Use `compare.py` for the older runner and `compare_node.py` for the Node proof. Final H18a and H19a parity receipts are in this directory; re-run them after changing Strategy, data adaptation, or Nautilus version.
