"""Complete native profit readings, shared by reports, attribution and ledger review.

The original audit observes realized PnL independently of the equity endpoint. Historical
cycle NULLs remain unknown; a uniquely identified residual is a labelled derived reading,
never an independent check of the same stored rows.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from decimal import Decimal

from ledger import execution, metrics, problems


def native_economics(capture: Mapping) -> Mapping | None:
    audit = problems.json_object(problems.sealed(capture, execution.AUDIT_RESULT)) or {}
    return audit.get("native_economics") if isinstance(audit.get("native_economics"), Mapping) else None


def amount(value) -> Decimal | None:
    if value is None:
        return None
    try:
        result = Decimal(str(value))
        return result if result.is_finite() else None
    except ArithmeticError:
        return None


def total(values) -> Decimal | None:
    values = [amount(value) for value in values]
    return None if any(value is None for value in values) else sum(values, Decimal(0))


def cycle_value(cycle: Mapping) -> Decimal | None:
    realized = amount(cycle.get("realized_pnl"))
    if cycle["ts_closed_ns"] is not None:
        return realized
    mark = amount(cycle.get("open_unrealized"))
    return None if realized is None or mark is None else realized + mark


def complete_cycles(cycles: Sequence[Mapping], audit: Mapping | None) -> list[dict]:
    """Copy readings; only one historical unknown open realized is identifiable from a total.

    Callers auditing the stored rows must use the original rows, not this residual view.
    Multiple unknown rows require verified native detail, not arbitrary allocation.
    """
    found = [dict(cycle) for cycle in cycles]
    missing = [cycle for cycle in found if cycle.get("realized_pnl") is None]
    realized = amount((audit or {}).get("reported_realized_pnl_usdt"))
    known = total(cycle["realized_pnl"] for cycle in found if cycle.get("realized_pnl") is not None)
    if len(missing) == 1 and missing[0]["ts_closed_ns"] is None and realized is not None and known is not None:
        missing[0]["realized_pnl"] = realized - known
        missing[0]["realized_pnl_source"] = "derived:original-native-audit-total-minus-known-cycles"
    for cycle in found:
        value = amount(cycle.get("realized_pnl"))
        cycle["price_pnl"] = (None if value is None else
                              value + Decimal(cycle["commissions"]) - Decimal(cycle["funding"]))
    return found


def account_bridge(cycles: Sequence[Mapping], starting, final, audit: Mapping | None = None) -> dict:
    """Reconcile complete account contributions without inferring realized PnL from equity.

    Audit totals restore historical account readings even when per-cycle allocation is unknown.
    Complete stored populations are independently reconciled to the original native audit.
    """
    fees = total(cycle["commissions"] for cycle in cycles)
    funding = total(cycle["funding"] for cycle in cycles)
    marks = total(cycle.get("open_unrealized") for cycle in cycles if cycle["ts_closed_ns"] is None)
    stored = total(cycle.get("realized_pnl") for cycle in cycles)
    realized = stored
    reason = None
    if fees is None or funding is None:
        reason = "CYCLE_COST_MISSING: cycle fees or funding are unreadable"
    elif marks is None:
        reason = "OPEN_MARK_MISSING: an open cycle has no final mark"
    if audit is not None:
        native_realized = amount(audit.get("reported_realized_pnl_usdt"))
        native_fees = amount(audit.get("fill_commissions_usdt"))
        native_funding = amount(audit.get("reported_funding_usdt"))
        if any(value is None for value in (native_realized, native_fees, native_funding)):
            reason = "AUDIT_ECONOMICS_MISSING: original native economics are incomplete"
        elif fees is not None and funding is not None:
            assert native_fees is not None and native_funding is not None and native_realized is not None
            if abs(fees - native_fees) > metrics.TOLERANCE or abs(funding - native_funding) > metrics.TOLERANCE:
                reason = "CYCLE_COST_MISMATCH: stored fees or funding differ from the original native audit"
            elif stored is not None and abs(stored - native_realized) > metrics.TOLERANCE:
                reason = "CYCLE_REALIZED_MISMATCH: stored realized PnL differs from the original native audit"
        realized = native_realized
    if realized is None and reason is None:
        reason = "REALIZED_PNL_MISSING: historical open-cycle realized PnL was not retained"
    start, end = amount(starting), amount(final)
    if (start is None or end is None) and reason is None:
        reason = "ACCOUNT_UNKNOWN: the starting balance or final equity is not recorded"
    values = dict.fromkeys(("price", "fee", "funding", "open_mark", "account"))
    if reason is None:
        assert realized is not None and fees is not None and funding is not None and marks is not None
        assert start is not None and end is not None
        if abs(realized + marks - (end - start)) > metrics.EQUITY_TOLERANCE:
            reason = "BRIDGE_UNRECONCILED: native realized plus open mark differs from the account change"
        else:
            values.update(price=realized + fees - funding, fee=-fees, funding=funding,
                          open_mark=marks, account=end - start)
    return {"values": values, "reason": reason, "cycle_realized_complete": stored is not None,
            "source": "original-native-audit" if audit is not None else "stored-native-cycles"}
