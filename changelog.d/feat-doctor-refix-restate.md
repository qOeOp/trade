- product-doctor's `scan` lists in `fixed_files` the tenth of files fixed most often (at least three times), with no
  top-20 cut. A fix on such a file, or on an object with three open findings, is one restatement that closes them
  without growing the file; the change check tries that restatement first. A themed audit stops searching for new
  findings while the open backlog outruns closing, or once two searches found nothing above minor and no file is
  fixed again and again.
