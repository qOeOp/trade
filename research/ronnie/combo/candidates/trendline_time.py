"""R&D loop F-2, frozen as tested: trendline_break_strong with the exit model changed to time only (no 2R target):
exit at the stop or after 30 4h bars."""
import trendline_break_strong as TL
from harness import Signal


def signals(bars):
    saved = TL.RR
    TL.RR = 1000.0
    try:
        return [Signal(s.time, s.side, s.stop, s.target, s.max_bars) for s in TL.signals(bars)]
    finally:
        TL.RR = saved
