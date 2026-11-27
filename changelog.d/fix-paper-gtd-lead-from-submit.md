- Paper counts a waiting entry's GTD lead (605 seconds, order rule 5) from when its source submitted it, as a replay
  does, not from the end of its terms read: an entry on the boundary, sent or cancelled while it waits, no longer
  stops the run with `ORDER_RULE`. Every other order rule is still checked when the entry is sent or ended (#3658).
