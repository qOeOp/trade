- Fixed: every start of the compose ledger service refuses (`SERVICE_CHECK_FAILED`) a database its `service.json`
  records but no ledger profile names at that service directory, such as after the data directory was moved while
  the profiles still name the old one; before, a mirror started and served it without checking its schema version
  (#3695).
