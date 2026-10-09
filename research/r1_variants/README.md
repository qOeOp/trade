# Supported R1 research variants

These are the existing published-Nautilus variants moved out of the product
strategy directory. They use qualified imports and the same
`python -m backtest.r1.run_portfolio` entry as the standalone H19a source in
`strategies/r1.py`. Their rules have not yet been consolidated into individual
files; this directory is not a second replay engine or research workflow.

The separate historical fork-based archive is retrieved through the fixed Git
source in `research/records/history.json`. Do not import its bare module names
into the supported replay. Prior records and receipts keep their original
source commits and paths.
