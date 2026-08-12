use std::str::FromStr;

use anyhow::{Context, ensure};
use serde::Serialize;
use vibe_model::types::Money;

use crate::{PilotRun, prepare_frozen_pilot};

const RECEIPT_KIND: &str = "strategy-factory-trial-receipt";
const ECONOMIC_FALSIFIER: &str = "validation_net_pnl_after_native_commissions_lte_zero";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EconomicDisposition {
    Rejected,
    SurvivedNotAdmitted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrialReceipt {
    body: TrialReceiptBody,
    receipt_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TrialReceiptBody {
    schema_version: u32,
    kind: String,
    pilot_id: String,
    research_intent_id: String,
    research_intent_digest: String,
    strategy_artifact_digest: String,
    source_manifest_digest: String,
    source_snapshot_semantics: String,
    canonical_result_digest: String,
    source_event_count: usize,
    executable_bar_count: usize,
    completed_round_trips: usize,
    starting_balance: String,
    final_balance: String,
    validation_net_pnl_after_native_commissions: String,
    native_commissions: String,
    terminal_flat: bool,
    software_disposition: String,
    economic_falsifier: String,
    economic_disposition: EconomicDisposition,
    non_claims: Vec<String>,
}

impl TrialReceipt {
    /// Issues a deterministic receipt from the already validated native Backtest result.
    pub fn issue(run: &PilotRun) -> anyhow::Result<Self> {
        let prepared = prepare_frozen_pilot()?;
        let intent = prepared.intent();
        let document = run.canonical_result().as_value();
        let summary = document
            .get("summary")
            .and_then(serde_json::Value::as_object)
            .context("canonical result summary is missing")?;
        let starting_balance = document
            .pointer("/accounts/0/Cash/base/balances_starting/USDT")
            .and_then(serde_json::Value::as_str)
            .context("canonical starting USDT balance is missing")?;
        let final_balance = summary
            .get("account.BINANCE.balance.USDT.total")
            .and_then(serde_json::Value::as_str)
            .context("canonical final USDT balance is missing")?;
        let native_commissions = document
            .pointer("/accounts/0/Cash/base/commissions/USDT")
            .and_then(serde_json::Value::as_str)
            .context("canonical native USDT commissions are missing")?;
        let starting = Money::from_str(starting_balance).map_err(anyhow::Error::msg)?;
        let final_value = Money::from_str(final_balance).map_err(anyhow::Error::msg)?;
        let commissions = Money::from_str(native_commissions).map_err(anyhow::Error::msg)?;
        ensure!(
            starting.currency == final_value.currency && starting.currency == commissions.currency,
            "trial receipt monetary currencies do not match"
        );
        ensure!(
            commissions.raw > 0,
            "trial receipt requires nonzero native commission"
        );
        let net_pnl = final_value - starting;
        let completed_round_trips = document
            .pointer("/run/total_positions")
            .and_then(serde_json::Value::as_str)
            .context("canonical total positions are missing")?
            .parse::<usize>()?;
        ensure!(
            completed_round_trips > 0,
            "trial receipt requires completed round trips"
        );
        let terminal_flat = ["orders.open", "orders.inflight", "positions.open"]
            .iter()
            .all(|key| summary.get(*key).and_then(serde_json::Value::as_str) == Some("0"));
        ensure!(
            terminal_flat,
            "trial receipt requires a terminal-flat result"
        );

        let artifact = prepared.artifact().identity();
        let body = TrialReceiptBody {
            schema_version: 1,
            kind: RECEIPT_KIND.to_string(),
            pilot_id: intent.payload.pilot_id.clone(),
            research_intent_id: intent.identity.clone(),
            research_intent_digest: artifact.intent_digest.clone(),
            strategy_artifact_digest: artifact.artifact_digest.clone(),
            source_manifest_digest: run.source_manifest_digest().to_string(),
            source_snapshot_semantics: intent.payload.data.snapshot_semantics.clone(),
            canonical_result_digest: run.canonical_result().digest()?,
            source_event_count: run.source_event_count(),
            executable_bar_count: run.executable_bar_count(),
            completed_round_trips,
            starting_balance: starting.to_string(),
            final_balance: final_value.to_string(),
            validation_net_pnl_after_native_commissions: net_pnl.to_string(),
            native_commissions: commissions.to_string(),
            terminal_flat,
            software_disposition: "ACCEPTED".to_string(),
            economic_falsifier: ECONOMIC_FALSIFIER.to_string(),
            economic_disposition: economic_disposition(net_pnl),
            non_claims: intent.payload.non_claims.clone(),
        };
        Ok(Self {
            receipt_digest: digest(&serde_json::to_vec(&body)?),
            body,
        })
    }

    /// Parses exact canonical bytes and re-derives every receipt field from `run`.
    pub fn from_slice(bytes: &[u8], run: &PilotRun) -> anyhow::Result<Self> {
        let expected = Self::issue(run)?;
        validate_canonical_bytes(bytes, &expected)?;
        Ok(expected)
    }

    pub fn to_bytes(&self) -> anyhow::Result<Vec<u8>> {
        Ok(serde_json::to_vec(self)?)
    }

    pub const fn economic_disposition(&self) -> EconomicDisposition {
        self.body.economic_disposition
    }

    pub fn receipt_digest(&self) -> &str {
        &self.receipt_digest
    }
}

fn digest(bytes: &[u8]) -> String {
    format!("blake3:{}", blake3::hash(bytes).to_hex())
}

fn validate_canonical_bytes(bytes: &[u8], expected: &TrialReceipt) -> anyhow::Result<()> {
    ensure!(
        expected.to_bytes()? == bytes,
        "trial receipt does not match the pilot run"
    );
    Ok(())
}

const fn economic_disposition(net_pnl: Money) -> EconomicDisposition {
    if net_pnl.raw <= 0 {
        EconomicDisposition::Rejected
    } else {
        EconomicDisposition::SurvivedNotAdmitted
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_receipt() -> TrialReceipt {
        let body = TrialReceiptBody {
            schema_version: 1,
            kind: RECEIPT_KIND.to_string(),
            pilot_id: "pilot".to_string(),
            research_intent_id: "intent".to_string(),
            research_intent_digest: "blake3:intent".to_string(),
            strategy_artifact_digest: "blake3:artifact".to_string(),
            source_manifest_digest: "blake3:source".to_string(),
            source_snapshot_semantics: "retrospective_current".to_string(),
            canonical_result_digest: "blake3:result".to_string(),
            source_event_count: 3,
            executable_bar_count: 2,
            completed_round_trips: 1,
            starting_balance: "1000000.00000000 USDT".to_string(),
            final_balance: "1000000.00000001 USDT".to_string(),
            validation_net_pnl_after_native_commissions: "0.00000001 USDT".to_string(),
            native_commissions: "0.00000001 USDT".to_string(),
            terminal_flat: true,
            software_disposition: "ACCEPTED".to_string(),
            economic_falsifier: ECONOMIC_FALSIFIER.to_string(),
            economic_disposition: EconomicDisposition::SurvivedNotAdmitted,
            non_claims: vec!["alpha".to_string()],
        };
        TrialReceipt {
            receipt_digest: digest(&serde_json::to_vec(&body).unwrap()),
            body,
        }
    }

    #[test]
    fn frozen_economic_falsifier_rejects_nonpositive_net_pnl_only() {
        assert_eq!(
            economic_disposition(Money::from("-0.00000001 USDT")),
            EconomicDisposition::Rejected
        );
        assert_eq!(
            economic_disposition(Money::from("0.00000000 USDT")),
            EconomicDisposition::Rejected
        );
        assert_eq!(
            economic_disposition(Money::from("0.00000001 USDT")),
            EconomicDisposition::SurvivedNotAdmitted
        );
    }

    #[test]
    fn receipt_parser_requires_exact_run_derived_bytes() {
        let receipt = sample_receipt();
        let bytes = receipt.to_bytes().unwrap();
        assert!(validate_canonical_bytes(&bytes, &receipt).is_ok());

        let mut tampered: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        tampered["body"]["final_balance"] = "999999.00000000 USDT".into();
        assert!(
            validate_canonical_bytes(&serde_json::to_vec(&tampered).unwrap(), &receipt).is_err()
        );

        let reordered = format!(
            "{{\"receipt_digest\":{},\"body\":{}}}",
            serde_json::to_string(&receipt.receipt_digest).unwrap(),
            serde_json::to_string(&receipt.body).unwrap()
        );
        assert!(validate_canonical_bytes(reordered.as_bytes(), &receipt).is_err());
    }
}
