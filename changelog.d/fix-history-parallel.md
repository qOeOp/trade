- `line history` (A-24): a line's closing history test replays several segments at once instead of one after
  another, as many as Docker's memory (its total less what its running containers hold and 1 GiB) has room for at a
  replay stage's 16 GiB limit, at least one (3 on a 62.7 GiB Docker VM). Each segment exports and seals as before;
  `ran` keeps the segment order, and a segment that fails lets the running ones seal and starts no other.
