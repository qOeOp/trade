#!/usr/bin/env python3

import json
import re
import sys
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, localcontext


REQUEST_SCHEMA_VERSION = "trade.rd-replay-ohlcv-economic-oracle-request.v1"
RESPONSE_SCHEMA_VERSION = "trade.rd-replay-ohlcv-economic-oracle-response.v1"
DECIMAL_PATTERN = re.compile(r"^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$")


def canonical(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return "0" if text in {"", "-0"} else text


def decimal_field(vector: dict, field: str, *, positive: bool = False) -> Decimal:
    value = vector.get(field)
    if not isinstance(value, str) or DECIMAL_PATTERN.fullmatch(value) is None:
        raise ValueError(f"{field} must be a canonical non-negative decimal string")
    result = Decimal(value)
    if positive and result <= 0:
        raise ValueError(f"{field} must be positive")
    return result


def quantize_increment(value: Decimal, increment: Decimal, rounding: str) -> Decimal:
    mode = ROUND_CEILING if rounding == "ceil" else ROUND_FLOOR
    units = (value / increment).to_integral_value(rounding=mode)
    return units * increment


def evaluate_vector(vector: dict) -> dict:
    vector_id = vector.get("vector_id")
    if not isinstance(vector_id, str) or not vector_id:
        raise ValueError("vector_id must be a non-empty string")
    position_side = vector.get("position_side")
    exit_side = vector.get("exit_side")
    if position_side not in {"long", "short"}:
        raise ValueError("position_side must be long or short")
    expected_exit_side = "sell" if position_side == "long" else "buy"
    if exit_side != expected_exit_side:
        raise ValueError("exit_side must close position_side")

    entry = decimal_field(vector, "entry_basis_price", positive=True)
    trigger = decimal_field(vector, "trigger_price", positive=True)
    quantity = decimal_field(vector, "quantity", positive=True)
    fee_bps = decimal_field(vector, "fee_bps")
    slippage_bps = decimal_field(vector, "slippage_bps")
    price_increment = decimal_field(vector, "price_increment", positive=True)
    settlement_increment = decimal_field(vector, "settlement_increment", positive=True)
    if slippage_bps >= Decimal("10000"):
        raise ValueError("slippage_bps must be below 10000")

    basis = Decimal("10000")
    multiplier = basis + slippage_bps if exit_side == "buy" else basis - slippage_bps
    execution_price = quantize_increment(
        trigger * multiplier / basis,
        price_increment,
        "ceil" if exit_side == "buy" else "floor",
    )
    direction = Decimal("1") if position_side == "long" else Decimal("-1")
    gross = quantize_increment(
        (execution_price - entry) * quantity * direction,
        settlement_increment,
        "floor",
    )
    fee = quantize_increment(
        execution_price * quantity * fee_bps / basis,
        settlement_increment,
        "ceil",
    )
    return {
        "vector_id": vector_id,
        "economics": {
            "simulated_execution_price": canonical(execution_price),
            "gross_realized_pnl": canonical(gross),
            "exit_fee": canonical(fee),
            "net_terminal_contribution": canonical(gross - fee),
        },
    }


def evaluate_request(request: dict) -> dict:
    if request.get("schema_version") != REQUEST_SCHEMA_VERSION:
        raise ValueError("unsupported request schema_version")
    vectors = request.get("vectors")
    if not isinstance(vectors, list) or not vectors:
        raise ValueError("vectors must be a non-empty list")
    results = [evaluate_vector(vector) for vector in vectors]
    if len({result["vector_id"] for result in results}) != len(results):
        raise ValueError("vector_id must be unique")
    return {
        "schema_version": RESPONSE_SCHEMA_VERSION,
        "status": "completed",
        "results": results,
    }


def main() -> int:
    try:
        request = json.load(sys.stdin)
        if not isinstance(request, dict):
            raise ValueError("request must be an object")
        with localcontext() as context:
            context.prec = 80
            response = evaluate_request(request)
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        response = {
            "schema_version": RESPONSE_SCHEMA_VERSION,
            "status": "failed",
            "error_class": "input_invalid",
            "message": str(error),
        }
        print(json.dumps(response, separators=(",", ":"), sort_keys=True))
        return 2
    print(json.dumps(response, separators=(",", ":"), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
