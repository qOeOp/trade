- Release: a version tag on a commit that built no product image (a documentation-only commit) now fails every
  `release-ready` run, naming the newest commit `main-ready` admitted at or before it to release instead; it used to
  log only a warning while `deploy-ready` stayed on the previous version. Before the tagged commit's push runs start,
  the run still only waits.
