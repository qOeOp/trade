- Breaking: order rule 5 (replay, Paper and Live, `ORDER_RULE`) accepts only orders Nautilus's Binance USD-M client
  sends: no TRAILING_STOP_LIMIT or MARKET_TO_LIMIT; time in force GTC, IOC, FOK or GTD (also on `close_position`);
  trailing offsets in basis points; no post-only GTD. A trigger other than the default (MARK_PRICE, LAST_PRICE and
  the rest) is refused, and a GTD order expires at least 605 seconds after it is submitted, the floor Live sends an
  entry with, instead of 600. A source using any of these needs a new version.
