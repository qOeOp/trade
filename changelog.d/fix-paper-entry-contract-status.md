- Paper sends an entry only on an active USDT-margined perpetual (status `TRADING`, contract type `PERPETUAL`, margin
  asset `USDT`), from the same `exchangeInfo` read as its terms check, under one rule shared with Live's admission.
  An entry on another contract (a `SETTLING` one still streams bars) is not sent, is journalled as `entry_not_sent`
  with code `PAPER_INSTRUMENT`, and the run goes on; reduce-only orders are unchanged (#3674).
