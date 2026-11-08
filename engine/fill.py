"""Construct the shared native Replay/Sandbox fill model from the existing account contract."""

from nautilus_trader.execution import DefaultFillModel


def fill_model(account) -> DefaultFillModel:
    """engine.fill_model: a fresh native fill model per engine; with probabilities 0 it draws nothing."""
    return DefaultFillModel(prob_fill_on_limit=float(account["prob_fill_on_limit"]),
                            prob_slippage=float(account["prob_slippage"]))
