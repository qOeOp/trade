# Native replay POC

- Purpose: verify one frozen 37-instrument shared-account RD replay against published Nautilus.
- Entry point: `run_portfolio.py`; native Strategy source is in the adjacent strategy files. `funding_catalog.py` only decodes the legacy funding Parquet format.
- Contract: retain one native margin account, LAST/MARK bars, funding settlements, fees, native order protection and zero denied/rejected orders. Do not turn this POC into a second engine or research workflow.
- Check: run the BTC/ETH pilot, then the full 37-instrument replay; use `compare.py` against the frozen native report. Final H18a and H19a parity receipts are in this directory; re-run them after changing Strategy, data adaptation, or Nautilus version.
