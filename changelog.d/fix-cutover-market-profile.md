- A data generation cutover on a Linux workstation puts `market.json` back. Before, the archive the cutover makes as
  root could not be read by the user running the update, and the market profile was silently left out of `ledgers`. A
  cutover an earlier version left unfinished is finished by that version.
