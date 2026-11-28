- Fixed: every start of the compose ledger service refuses (`SERVICE_CHECK_FAILED`) a database its `service.json`
  records but no ledger profile in its profile directory (`TRADE_LEDGER_HOME`) names at that service directory: a
  data directory moved while the profiles still name the old one, or a database `ledger init` made on the service
  from a shell with another profile directory. Before, the service served such a database without checking its
  schema version. The refusal names the databases; putting each one's profile in that directory lets it start
  (#3695).
