- The Paper runner turns transparent huge pages off for its process (and its Redis child) at start. On a host with
  THP `always` its heap was backed by 2 MiB pages and kept growing with no data held; a six-contract run's container
  used 279 MiB after its warm-up with THP and 182 MiB without, against a 384 MiB limit (#3782).
