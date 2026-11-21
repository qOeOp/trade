- Breaking (registration): `registration add` reconciles a derived registration's `changed_duties` with its grid
  candidates' file headers and refuses with `DUTY_HEADER_MISMATCH` unless they equal, for every grid candidate, the
  duty lines its header changes from its parent's header (a removed or added line counts). A grid whose header edits
  other lines is published again with those lines as in the parent.
