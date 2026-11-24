- Live no longer ends the run and closes every position when the source cancels an entry, or exits, while an entry
  waits for its account check or is held: that entry is never sent, ends as `CANCELED`, and the run goes on.
