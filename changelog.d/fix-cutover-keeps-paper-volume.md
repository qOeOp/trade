- A release host's data generation cutover packs the Paper database into the archive (`trade-dolt-data.tgz`) before it
  removes the ledger's volume; only the research mirror is left out. Before, only the Paper database's last backup
  stayed.
