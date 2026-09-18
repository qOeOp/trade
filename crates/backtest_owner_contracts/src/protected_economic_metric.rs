//! Versioned Backtest-owned catalog of protected economic metrics and coverage rules.
//!
//! A frozen [`ProtectedEconomicPolicyBundleV1`] names the metric and the coverage rule by identity
//! and digest only; it carries thresholds and tolerances but no computation. The computation is
//! Backtest's, exactly as the kernel owns its primitive semantic IDs: this catalog is the complete
//! admitted set, each member frozen as a semantic ID, a unit, a decimal scale, the exact formula,
//! and the canonical-result fields it reads. The digest over that frozen definition is what
//! Qualification freezes into the bundle, so a bundle can select a computation but can never
//! describe one, and a caller can never introduce one.
//!
//! An identity this catalog does not publish, or a digest, unit, or scale that disagrees with the
//! published definition, resolves to nothing and produces no measurement.

use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::protected_replay::{
    ProtectedEconomicPolicyBundleV1, ProtectedEconomicPolicyReferenceV1,
};

const METRIC_DEFINITION_DIGEST_DOMAIN_V1: &str = "vibe.backtest.protected-economic-metric.v1";
const COVERAGE_DEFINITION_DIGEST_DOMAIN_V1: &str = "vibe.backtest.protected-economic-coverage.v1";

/// Semantic ID of the sole admitted protected economic metric.
pub const NET_RETURN_BASIS_POINTS_METRIC_V1: &str = "backtest.protected-metric.net-return-bps.v1";

/// Semantic ID of the sole admitted protected coverage rule.
pub const OBSERVED_WINDOW_SPAN_COVERAGE_V1: &str =
    "backtest.protected-coverage.observed-window-span.v1";

/// Unit every catalog member reports in.
pub const BASIS_POINTS_UNIT: &str = "basis-points";

/// One admitted protected economic metric.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtectedEconomicMetricV1 {
    /// Net-of-cost account return over the replay, in basis points.
    NetReturnBasisPoints,
}

/// One admitted protected coverage rule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtectedEconomicCoverageRuleV1 {
    /// Share of the configured replay window the observed position lifecycle actually spans.
    ObservedWindowSpan,
}

/// Why a frozen policy reference selects no admitted computation.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ProtectedEconomicCatalogFaultV1 {
    #[error("the Backtest catalog publishes no protected economic metric named {identity}")]
    UnknownMetric { identity: String },
    #[error("the Backtest catalog publishes no protected coverage rule named {identity}")]
    UnknownCoverageRule { identity: String },
    #[error("frozen digest for {identity} does not match the published definition")]
    DefinitionDigestMismatch { identity: String },
    #[error("frozen unit {frozen} does not match the published unit {published} for {identity}")]
    UnitMismatch {
        identity: String,
        frozen: String,
        published: &'static str,
    },
    #[error(
        "frozen decimal scale {frozen} does not match the published scale {published} for {identity}"
    )]
    DecimalScaleMismatch {
        identity: String,
        frozen: u8,
        published: u8,
    },
    #[error("protected economic definition could not be encoded")]
    DefinitionUnavailable,
}

/// The frozen text of one catalog definition. Its serialization is the digest preimage.
#[derive(Debug, Serialize)]
struct DefinitionV1 {
    semantic_id: &'static str,
    unit: &'static str,
    decimal_scale: u8,
    formula: &'static str,
    source_paths: &'static [&'static str],
}

impl ProtectedEconomicMetricV1 {
    /// Every metric this catalog publishes.
    pub const ALL: [Self; 1] = [Self::NetReturnBasisPoints];

    /// Returns the stable semantic ID a frozen policy must name to select this metric.
    #[must_use]
    pub const fn semantic_id(self) -> &'static str {
        match self {
            Self::NetReturnBasisPoints => NET_RETURN_BASIS_POINTS_METRIC_V1,
        }
    }

    /// Returns the unit this metric reports in.
    #[must_use]
    pub const fn unit(self) -> &'static str {
        match self {
            Self::NetReturnBasisPoints => BASIS_POINTS_UNIT,
        }
    }

    /// Returns the fixed-point scale applied to the reported basis points.
    #[must_use]
    pub const fn decimal_scale(self) -> u8 {
        match self {
            Self::NetReturnBasisPoints => 4,
        }
    }

    /// Returns the exact frozen formula, as the definition digest commits to it.
    #[must_use]
    pub const fn formula(self) -> &'static str {
        match self {
            Self::NetReturnBasisPoints => concat!(
                "observed_raw = trunc_toward_zero(",
                "(settlement_balance_total - settlement_balance_starting)",
                " * 10^(4 + decimal_scale) / settlement_balance_starting)",
                "; the balance delta must equal the sum of every position realized_pnl",
                " in the same settlement currency",
            ),
        }
    }

    /// Returns the canonical-result fields the formula reads, in canonical order.
    #[must_use]
    pub const fn source_paths(self) -> &'static [&'static str] {
        match self {
            Self::NetReturnBasisPoints => &[
                "accounts[].*.base.balances[currency].total",
                "accounts[].*.base.balances_starting[currency]",
                "positions[].realized_pnl",
                "positions[].settlement_currency",
            ],
        }
    }

    /// Returns the digest a frozen policy must carry to select this metric.
    ///
    /// # Errors
    ///
    /// Returns an error when the frozen definition cannot be encoded.
    pub fn definition_digest(self) -> Result<String, ProtectedEconomicCatalogFaultV1> {
        definition_digest(
            METRIC_DEFINITION_DIGEST_DOMAIN_V1,
            &DefinitionV1 {
                semantic_id: self.semantic_id(),
                unit: self.unit(),
                decimal_scale: self.decimal_scale(),
                formula: self.formula(),
                source_paths: self.source_paths(),
            },
        )
    }

    /// Resolves the metric one frozen policy reference selects.
    ///
    /// # Errors
    ///
    /// Returns an error when the identity is not published, or the digest, unit, or decimal scale
    /// disagrees with the published definition.
    pub fn resolve(
        reference: &ProtectedEconomicPolicyReferenceV1,
        unit: &str,
        decimal_scale: u8,
    ) -> Result<Self, ProtectedEconomicCatalogFaultV1> {
        let metric = Self::ALL
            .into_iter()
            .find(|member| member.semantic_id() == reference.identity)
            .ok_or_else(|| ProtectedEconomicCatalogFaultV1::UnknownMetric {
                identity: reference.identity.clone(),
            })?;

        if metric.definition_digest()? != reference.digest {
            return Err(ProtectedEconomicCatalogFaultV1::DefinitionDigestMismatch {
                identity: reference.identity.clone(),
            });
        }

        if unit != metric.unit() {
            return Err(ProtectedEconomicCatalogFaultV1::UnitMismatch {
                identity: reference.identity.clone(),
                frozen: unit.to_owned(),
                published: metric.unit(),
            });
        }

        if decimal_scale != metric.decimal_scale() {
            return Err(ProtectedEconomicCatalogFaultV1::DecimalScaleMismatch {
                identity: reference.identity.clone(),
                frozen: decimal_scale,
                published: metric.decimal_scale(),
            });
        }
        Ok(metric)
    }
}

impl ProtectedEconomicCoverageRuleV1 {
    /// Every coverage rule this catalog publishes.
    pub const ALL: [Self; 1] = [Self::ObservedWindowSpan];

    /// Returns the stable semantic ID a frozen policy must name to select this rule.
    #[must_use]
    pub const fn semantic_id(self) -> &'static str {
        match self {
            Self::ObservedWindowSpan => OBSERVED_WINDOW_SPAN_COVERAGE_V1,
        }
    }

    /// Returns the exact frozen rule, as the definition digest commits to it.
    #[must_use]
    pub const fn formula(self) -> &'static str {
        match self {
            Self::ObservedWindowSpan => concat!(
                "observed_coverage_bps = min(10000, ",
                "(max_position_close_or_open_ns - min_position_open_ns) * 10000",
                " / (run.backtest_end_ns - run.backtest_start_ns))",
                "; at least one position must be observed",
            ),
        }
    }

    /// Returns the canonical-result fields the rule reads, in canonical order.
    #[must_use]
    pub const fn source_paths(self) -> &'static [&'static str] {
        match self {
            Self::ObservedWindowSpan => &[
                "positions[].ts_closed",
                "positions[].ts_opened",
                "run.backtest_end_ns",
                "run.backtest_start_ns",
            ],
        }
    }

    /// Returns the digest a frozen policy must carry to select this rule.
    ///
    /// # Errors
    ///
    /// Returns an error when the frozen definition cannot be encoded.
    pub fn definition_digest(self) -> Result<String, ProtectedEconomicCatalogFaultV1> {
        definition_digest(
            COVERAGE_DEFINITION_DIGEST_DOMAIN_V1,
            &DefinitionV1 {
                semantic_id: self.semantic_id(),
                unit: BASIS_POINTS_UNIT,
                decimal_scale: 0,
                formula: self.formula(),
                source_paths: self.source_paths(),
            },
        )
    }

    /// Resolves the coverage rule one frozen policy reference selects.
    ///
    /// # Errors
    ///
    /// Returns an error when the identity is not published or the digest disagrees with the
    /// published definition.
    pub fn resolve(
        reference: &ProtectedEconomicPolicyReferenceV1,
    ) -> Result<Self, ProtectedEconomicCatalogFaultV1> {
        let rule = Self::ALL
            .into_iter()
            .find(|member| member.semantic_id() == reference.identity)
            .ok_or_else(|| ProtectedEconomicCatalogFaultV1::UnknownCoverageRule {
                identity: reference.identity.clone(),
            })?;

        if rule.definition_digest()? != reference.digest {
            return Err(ProtectedEconomicCatalogFaultV1::DefinitionDigestMismatch {
                identity: reference.identity.clone(),
            });
        }
        Ok(rule)
    }
}

/// The exact pair of computations one frozen policy bundle selects.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtectedEconomicComputationV1 {
    pub metric: ProtectedEconomicMetricV1,
    pub coverage_rule: ProtectedEconomicCoverageRuleV1,
}

impl ProtectedEconomicComputationV1 {
    /// Resolves both computations one frozen bundle selects, or nothing.
    ///
    /// # Errors
    ///
    /// Returns the first reference the catalog does not publish exactly as frozen.
    pub fn resolve(
        policy: &ProtectedEconomicPolicyBundleV1,
    ) -> Result<Self, ProtectedEconomicCatalogFaultV1> {
        Ok(Self {
            metric: ProtectedEconomicMetricV1::resolve(
                &policy.metric,
                &policy.unit,
                policy.decimal_scale,
            )?,
            coverage_rule: ProtectedEconomicCoverageRuleV1::resolve(&policy.coverage_policy)?,
        })
    }
}

fn definition_digest(
    domain: &str,
    definition: &DefinitionV1,
) -> Result<String, ProtectedEconomicCatalogFaultV1> {
    #[derive(Serialize)]
    struct Envelope<'a> {
        domain: &'a str,
        value: &'a DefinitionV1,
    }

    let bytes = serde_json::to_vec(&Envelope {
        domain,
        value: definition,
    })
    .map_err(|_| ProtectedEconomicCatalogFaultV1::DefinitionUnavailable)?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn reference(identity: &str, digest: &str) -> ProtectedEconomicPolicyReferenceV1 {
        ProtectedEconomicPolicyReferenceV1 {
            identity: identity.to_owned(),
            digest: digest.to_owned(),
        }
    }

    fn metric_reference() -> ProtectedEconomicPolicyReferenceV1 {
        let metric = ProtectedEconomicMetricV1::NetReturnBasisPoints;
        reference(metric.semantic_id(), &metric.definition_digest().unwrap())
    }

    fn coverage_reference() -> ProtectedEconomicPolicyReferenceV1 {
        let rule = ProtectedEconomicCoverageRuleV1::ObservedWindowSpan;
        reference(rule.semantic_id(), &rule.definition_digest().unwrap())
    }

    #[rstest]
    fn published_definitions_are_stable_and_domain_separated() {
        let metric = ProtectedEconomicMetricV1::NetReturnBasisPoints;
        let coverage = ProtectedEconomicCoverageRuleV1::ObservedWindowSpan;
        let metric_digest = metric.definition_digest().unwrap();
        assert_eq!(metric_digest, metric.definition_digest().unwrap());
        assert!(metric_digest.starts_with("sha256:"));
        assert_ne!(metric_digest, coverage.definition_digest().unwrap());
        assert_eq!(metric.unit(), BASIS_POINTS_UNIT);
        assert_eq!(metric.decimal_scale(), 4);
    }

    #[rstest]
    fn a_frozen_reference_selects_the_published_computation() {
        let metric =
            ProtectedEconomicMetricV1::resolve(&metric_reference(), BASIS_POINTS_UNIT, 4).unwrap();
        assert_eq!(metric, ProtectedEconomicMetricV1::NetReturnBasisPoints);
        let rule = ProtectedEconomicCoverageRuleV1::resolve(&coverage_reference()).unwrap();
        assert_eq!(rule, ProtectedEconomicCoverageRuleV1::ObservedWindowSpan);
    }

    #[rstest]
    fn an_unpublished_identity_selects_nothing() {
        assert_eq!(
            ProtectedEconomicMetricV1::resolve(
                &reference("net-return", &metric_reference().digest),
                BASIS_POINTS_UNIT,
                4
            ),
            Err(ProtectedEconomicCatalogFaultV1::UnknownMetric {
                identity: "net-return".to_owned()
            })
        );
        assert_eq!(
            ProtectedEconomicCoverageRuleV1::resolve(&reference("coverage", "sha256:00")),
            Err(ProtectedEconomicCatalogFaultV1::UnknownCoverageRule {
                identity: "coverage".to_owned()
            })
        );
    }

    #[rstest]
    fn a_reframed_definition_selects_nothing() {
        let metric = ProtectedEconomicMetricV1::NetReturnBasisPoints;
        assert_eq!(
            ProtectedEconomicMetricV1::resolve(
                &reference(metric.semantic_id(), &format!("sha256:{}", "a".repeat(64))),
                BASIS_POINTS_UNIT,
                4
            ),
            Err(ProtectedEconomicCatalogFaultV1::DefinitionDigestMismatch {
                identity: metric.semantic_id().to_owned()
            })
        );
        assert_eq!(
            ProtectedEconomicMetricV1::resolve(&metric_reference(), "percent", 4),
            Err(ProtectedEconomicCatalogFaultV1::UnitMismatch {
                identity: metric.semantic_id().to_owned(),
                frozen: "percent".to_owned(),
                published: BASIS_POINTS_UNIT,
            })
        );
        assert_eq!(
            ProtectedEconomicMetricV1::resolve(&metric_reference(), BASIS_POINTS_UNIT, 2),
            Err(ProtectedEconomicCatalogFaultV1::DecimalScaleMismatch {
                identity: metric.semantic_id().to_owned(),
                frozen: 2,
                published: 4,
            })
        );
    }

    #[rstest]
    fn every_published_member_resolves_from_its_own_definition() {
        for metric in ProtectedEconomicMetricV1::ALL {
            let selected = ProtectedEconomicMetricV1::resolve(
                &reference(metric.semantic_id(), &metric.definition_digest().unwrap()),
                metric.unit(),
                metric.decimal_scale(),
            )
            .unwrap();
            assert_eq!(selected, metric);
            assert!(!metric.formula().is_empty());
            assert!(!metric.source_paths().is_empty());
        }

        for rule in ProtectedEconomicCoverageRuleV1::ALL {
            let selected = ProtectedEconomicCoverageRuleV1::resolve(&reference(
                rule.semantic_id(),
                &rule.definition_digest().unwrap(),
            ))
            .unwrap();
            assert_eq!(selected, rule);
        }
    }
}
