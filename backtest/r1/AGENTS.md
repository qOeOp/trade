# Native replay POC

- Purpose: verify one frozen 37-instrument shared-account RD replay against published Nautilus.
- Entry: `run_portfolio.py` uses `native_node.py` and importable wrappers in `node_strategy.py` for every supported R1 variant. Nautilus loads funding directly from the existing Catalog; `replay_inputs.py` validates receipts and funding coverage.
- Contract: retain one native margin account, LAST/MARK bars, funding settlements, fees, native order protection and zero denied/rejected orders. Do not turn this POC into a second engine or research workflow.
- Check: run BTC/ETH pilots for affected variants, then the full 37-instrument replay for current candidates. Use `compare_node.py` against frozen native controls and retain a behavior receipt. Re-run after changing Strategy, data adaptation, or Nautilus version.
- Registered tiered research runs: use the Git record and local artifact steps in `research/records/README.md`; they call this same native runner. Keep direct `/tmp` runs labeled as temporary diagnostics.
