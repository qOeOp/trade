- `research history` no longer reads a control segment that an interrupted `line history` left without a run as a
  control that does not reproduce the research run: the row keeps its summary with `control` missing until the test
  resumes, instead of voiding it (#3761).
