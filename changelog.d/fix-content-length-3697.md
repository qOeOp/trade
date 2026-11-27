- The IDE's forward, the Paper service and the first-run setup page answer 400 to a request whose `Content-Length` is
  not plain digits; a negative length no longer reads past the body limit and a non-numeric one no longer drops the
  connection (#3697).
