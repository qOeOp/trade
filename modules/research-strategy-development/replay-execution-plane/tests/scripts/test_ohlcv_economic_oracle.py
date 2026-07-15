import unittest
from decimal import Decimal, localcontext

from ohlcv_economic_oracle import (
    REQUEST_SCHEMA_VERSION,
    RESPONSE_SCHEMA_VERSION,
    evaluate_request,
    evaluate_vector,
)


class OhlcvEconomicOracleTest(unittest.TestCase):
    def test_long_and_short_cost_vectors_match_hand_calculated_goldens(self):
        common = {
            "entry_basis_price": "100",
            "quantity": "1.37",
            "fee_bps": "8",
            "slippage_bps": "6",
            "price_increment": "0.01",
            "settlement_increment": "0.000001",
        }
        with localcontext() as context:
            context.prec = 80
            long_result = evaluate_vector({
                **common,
                "vector_id": "long-target",
                "position_side": "long",
                "exit_side": "sell",
                "trigger_price": "105",
            })
            short_result = evaluate_vector({
                **common,
                "vector_id": "short-target",
                "position_side": "short",
                "exit_side": "buy",
                "trigger_price": "95",
            })
        self.assertEqual(long_result["economics"], {
            "simulated_execution_price": "104.93",
            "gross_realized_pnl": "6.7541",
            "exit_fee": "0.115004",
            "net_terminal_contribution": "6.639096",
        })
        self.assertEqual(short_result["economics"], {
            "simulated_execution_price": "95.06",
            "gross_realized_pnl": "6.7678",
            "exit_fee": "0.104186",
            "net_terminal_contribution": "6.663614",
        })

    def test_request_protocol_preserves_order_and_rejects_duplicate_ids(self):
        vector = {
            "vector_id": "zero-cost",
            "position_side": "long",
            "exit_side": "sell",
            "entry_basis_price": "100",
            "trigger_price": "105",
            "quantity": "1",
            "fee_bps": "0",
            "slippage_bps": "0",
            "price_increment": "0.01",
            "settlement_increment": "0.00000001",
        }
        with localcontext() as context:
            context.prec = 80
            response = evaluate_request({
                "schema_version": REQUEST_SCHEMA_VERSION,
                "vectors": [vector],
            })
            self.assertEqual(response["schema_version"], RESPONSE_SCHEMA_VERSION)
            self.assertEqual(response["status"], "completed")
            self.assertEqual(response["results"][0]["economics"]["net_terminal_contribution"], "5")
            with self.assertRaisesRegex(ValueError, "vector_id must be unique"):
                evaluate_request({
                    "schema_version": REQUEST_SCHEMA_VERSION,
                    "vectors": [vector, vector],
                })

    def test_vector_rejects_direction_mismatch_and_noncanonical_decimal(self):
        base = {
            "vector_id": "invalid",
            "position_side": "long",
            "exit_side": "buy",
            "entry_basis_price": "100",
            "trigger_price": "105",
            "quantity": "1",
            "fee_bps": "0",
            "slippage_bps": "0",
            "price_increment": "0.01",
            "settlement_increment": "0.00000001",
        }
        with self.assertRaisesRegex(ValueError, "exit_side must close position_side"):
            evaluate_vector(base)
        with self.assertRaisesRegex(ValueError, "canonical non-negative decimal string"):
            evaluate_vector({**base, "exit_side": "sell", "quantity": "1.0"})


if __name__ == "__main__":
    unittest.main()
