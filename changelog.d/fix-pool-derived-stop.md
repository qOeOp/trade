- Breaking (replay inputs and outcomes): a contract that no lifecycle bundle lists and whose stored trades stopped
  now terminates where they stop. When its last traded minute (LAST volume above zero) of everything stored through
  the market day closes before the window's end and at least 7 days before the market day's end, the export gives
  that close as one native InstrumentStatus CLOSE (no settlement price) and leaves out what follows. Pool replays
  over a month in which a member was settled, such as MATICUSDT in 2024-09, are no longer invalid with
  `DATA_ENDS_WITHOUT_TERMINATION`. A run holding such a contract past its stop is now invalid
  (`POSITION_OPEN_AT_TERMINATION`, `ORDER_OPEN_AT_TERMINATION`), where before it went on at a frozen price. Exports
  and results of those windows change; contracts that never stopped export the same bytes. A contract terminated
  before the window's start no longer counts as data ending early. Delegated decision of 2026-11-22 (docs/rd
  W.3.2.2, doctor row 20261122-04).
