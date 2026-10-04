//! The strategy catalog: an authored strategy as an immutable, content-addressed statement.
//!
//! A strategy is what an author decides about one single-threshold program - the channel, the
//! threshold, the comparison, both sides and the exits - and nothing about which Research request
//! runs it. `docs/owners/rd.md` puts the binding to a Research request in the run: each backtest
//! run opens its own Research goal and freezes the Design under it, so one statement can be run
//! any number of times, and the one-freeze-per-request rule of the bounded feature program freeze
//! is never met by a second statement.
//!
//! That is also why a strategy is not named by its Design. A Design's identity hashes its
//! canonical bytes, which carry the Research request and Intent the Design answers
//! (`StrategyDesignV2::research_request_identity`), so the same statement makes a different
//! Design under every request. The strategy is named by its statement instead: the
//! domain-separated SHA-256 of the statement's canonical bytes.

use std::fmt::Display;

use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use vibe_data::owner::source_binding::BindingDigest;

use crate::{
    bounded_feature_program_derivation_v1::BoundedFeatureProgramMeaningV1,
    bounded_feature_program_v1::BoundedFeaturePredicateV1,
    single_threshold_authoring_v1::{
        SingleThresholdAuthoringErrorV1, SingleThresholdAuthoringRequestV1,
        SingleThresholdChannelV1, SingleThresholdOutcomeV1, author_single_threshold_program_v1,
        canonical_threshold_of_v1,
    },
    strategy_authoring_v1::{
        AuthoringExpressionV1, StrategyAuthoringDocumentV1, StrategyAuthoringErrorV1,
        author_strategy_document_v1,
    },
    strategy_design_v2::StrategyDesignV2,
};

/// Domain separation for a strategy's identity, so no other digest of the same bytes collides
/// with it.
const STRATEGY_IDENTITY_DOMAIN_V1: &[u8] = b"strategy.catalog.single-threshold-statement.v1\0";
/// Domain separation for an authored document's identity, so a document and a single-threshold
/// statement never share one.
const AUTHORED_STRATEGY_IDENTITY_DOMAIN_V1: &[u8] = b"strategy.catalog.authored-document.v1\0";

/// Everything an author decides about one single-threshold strategy: the authoring request
/// without the three Research identities a run supplies.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SingleThresholdStrategySpecV1 {
    /// The one channel read, which is also the decision clock.
    pub channel: SingleThresholdChannelV1,
    /// See [`SingleThresholdAuthoringRequestV1::threshold`].
    pub threshold: String,
    /// How the channel is compared against the threshold.
    pub comparison: BoundedFeaturePredicateV1,
    /// What to propose when the comparison holds.
    pub when_true: SingleThresholdOutcomeV1,
    /// What to propose otherwise.
    pub otherwise: SingleThresholdOutcomeV1,
    /// See [`SingleThresholdAuthoringRequestV1::stop_loss_fraction`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop_loss_fraction: Option<String>,
    /// See [`SingleThresholdAuthoringRequestV1::take_profit_fraction`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub take_profit_fraction: Option<String>,
    /// See [`SingleThresholdAuthoringRequestV1::max_holding_bars`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_holding_bars: Option<u32>,
    /// The statement this strategy can be wrong about.
    pub falsifier: String,
}

impl SingleThresholdStrategySpecV1 {
    /// The authoring request that states this strategy for one Research request and Intent, read
    /// at `universe_timeframe`.
    #[must_use]
    pub fn authoring_request(
        &self,
        research_request_identity: BindingDigest,
        intent_identity: BindingDigest,
        intent_digest: BindingDigest,
        universe_timeframe: &str,
    ) -> SingleThresholdAuthoringRequestV1 {
        let spec = self.clone();
        SingleThresholdAuthoringRequestV1 {
            research_request_identity,
            intent_identity,
            intent_digest,
            universe_timeframe: universe_timeframe.to_owned(),
            channel: spec.channel,
            threshold: spec.threshold,
            comparison: spec.comparison,
            when_true: spec.when_true,
            otherwise: spec.otherwise,
            stop_loss_fraction: spec.stop_loss_fraction,
            take_profit_fraction: spec.take_profit_fraction,
            max_holding_bars: spec.max_holding_bars,
            falsifier: spec.falsifier,
        }
    }
}

/// A strategy's identity: the domain-separated SHA-256 of its statement's canonical bytes.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct StrategyIdentityV1([u8; 32]);

impl StrategyIdentityV1 {
    /// The 32 digest bytes.
    #[must_use]
    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Reads the wire form, `sha256:` and 64 lower-case hex digits, refusing any other spelling.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        let hex = text.strip_prefix("sha256:")?;

        if hex.len() != 64
            || !hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return None;
        }
        let mut bytes = [0_u8; 32];
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16).ok()?;
        }
        Some(Self(bytes))
    }

    /// Wraps stored digest bytes.
    #[must_use]
    pub const fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}

impl Display for StrategyIdentityV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("sha256:")?;
        for byte in self.0 {
            write!(formatter, "{byte:02x}")?;
        }
        Ok(())
    }
}

/// A strategy the catalog holds: a single-threshold statement or an authoring-language document.
///
/// The two are told apart by their closed shapes, not by a tag: a document names its `language`
/// and a single-threshold statement its `channel`, and each refuses the other's fields. So a
/// single-threshold statement keeps the bytes, and the identity, it had before documents existed.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(untagged)]
pub enum StrategyStatementV1 {
    SingleThreshold(Box<SingleThresholdStrategySpecV1>),
    Authored(StrategyAuthoringDocumentV1),
}

/// Why a statement was not admitted, under the refusal its family names.
#[derive(Clone, Debug, Eq, thiserror::Error, PartialEq)]
pub enum StrategyStatementErrorV1 {
    #[error(transparent)]
    SingleThreshold(#[from] SingleThresholdAuthoringErrorV1),
    #[error(transparent)]
    Authored(#[from] StrategyAuthoringErrorV1),
}

impl StrategyStatementErrorV1 {
    /// The refusal's stable name.
    #[must_use]
    pub const fn code(&self) -> &'static str {
        match self {
            Self::SingleThreshold(refusal) => refusal.code(),
            Self::Authored(refusal) => refusal.code,
        }
    }
}

impl StrategyStatementV1 {
    /// The statement this strategy can be wrong about, whichever family it is.
    #[must_use]
    pub fn falsifier(&self) -> &str {
        match self {
            Self::SingleThreshold(spec) => &spec.falsifier,
            Self::Authored(document) => &document.falsifier,
        }
    }

    /// Compiles the statement for one Research request and Intent into its `design` and
    /// `meaning`, whichever family it is, its universe-member roles read at `timeframe`: the bar
    /// label Market Data declares for the run's execution timeframe.
    ///
    /// # Errors
    ///
    /// Returns the family's own refusal.
    pub fn author(
        &self,
        research_request_identity: BindingDigest,
        intent_identity: BindingDigest,
        intent_digest: BindingDigest,
        timeframe: &str,
    ) -> Result<(StrategyDesignV2, BoundedFeatureProgramMeaningV1), StrategyStatementErrorV1> {
        Ok(match self {
            Self::SingleThreshold(spec) => {
                author_single_threshold_program_v1(&spec.authoring_request(
                    research_request_identity,
                    intent_identity,
                    intent_digest,
                    timeframe,
                ))?
            }
            Self::Authored(document) => author_strategy_document_v1(
                document,
                research_request_identity,
                intent_identity,
                intent_digest,
                timeframe,
            )?,
        })
    }
}

/// A statement the catalog admits: its canonical bytes and the identity they hash to.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CanonicalStrategyStatementV1 {
    identity: StrategyIdentityV1,
    statement: StrategyStatementV1,
    canonical_bytes: Vec<u8>,
}

impl CanonicalStrategyStatementV1 {
    #[must_use]
    pub const fn identity(&self) -> StrategyIdentityV1 {
        self.identity
    }

    #[must_use]
    pub const fn statement(&self) -> &StrategyStatementV1 {
        &self.statement
    }

    /// The bytes the catalog stores and reads back exactly.
    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }
}

/// The bar label admission authors at. No authoring refusal depends on the label: a run's own
/// label is checked by Market Data when the run binds its roles.
const STAND_IN_TIMEFRAME: &str = "24H";

/// Admits a statement into the catalog: authors it, and names it by its canonical bytes.
///
/// A statement is admitted only if it authors, so the catalog never holds a strategy a run would
/// refuse at authoring. The Research identities and the bar timeframe a run supplies are not part
/// of the statement, so authoring uses fixed stand-ins; they reach neither the canonical bytes nor
/// the identity.
///
/// Every value a statement can spell more than one way is brought to its one spelling before it
/// is hashed, so one strategy has one identity:
///
/// - a single-threshold threshold is rewritten to its one decimal spelling at the channel's scale
///   (`100.00` and `100` are one statement), and an exit fraction with a trailing zero is refused
///   by name rather than rewritten;
/// - a document's inputs, definitions and states, whose order states nothing, are sorted by name,
///   its rules keep their order, which is their priority, and each decimal literal is written
///   without trailing zeros.
///
/// # Errors
///
/// Returns the family's refusal under its own name.
pub fn canonical_strategy_statement_v1(
    statement: &StrategyStatementV1,
) -> Result<CanonicalStrategyStatementV1, StrategyStatementErrorV1> {
    let canonical = match statement {
        StrategyStatementV1::SingleThreshold(spec) => {
            StrategyStatementV1::SingleThreshold(Box::new(SingleThresholdStrategySpecV1 {
                threshold: canonical_threshold_of_v1(&spec.channel, &spec.threshold)?,
                ..(**spec).clone()
            }))
        }
        StrategyStatementV1::Authored(document) => {
            StrategyStatementV1::Authored(canonical_document(document))
        }
    };
    let stand_in = BindingDigest::from_untrusted_bytes([0x5a; 32]);
    canonical.author(stand_in, stand_in, stand_in, STAND_IN_TIMEFRAME)?;
    let canonical_bytes =
        serde_json::to_vec(&canonical).expect("a strategy statement serialises to JSON");
    Ok(CanonicalStrategyStatementV1 {
        identity: identity_of(&canonical, &canonical_bytes),
        statement: canonical,
        canonical_bytes,
    })
}

/// The identity a stored statement's bytes hash to under its family's domain, or `None` for bytes
/// that are not a statement, which is how a stored statement proves it is the one its identity
/// names.
#[must_use]
pub fn stored_strategy_identity_v1(canonical_bytes: &[u8]) -> Option<StrategyIdentityV1> {
    let statement = serde_json::from_slice::<StrategyStatementV1>(canonical_bytes).ok()?;
    Some(identity_of(&statement, canonical_bytes))
}

fn identity_of(statement: &StrategyStatementV1, canonical_bytes: &[u8]) -> StrategyIdentityV1 {
    let domain = match statement {
        StrategyStatementV1::SingleThreshold(_) => STRATEGY_IDENTITY_DOMAIN_V1,
        StrategyStatementV1::Authored(_) => AUTHORED_STRATEGY_IDENTITY_DOMAIN_V1,
    };
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(canonical_bytes);
    StrategyIdentityV1(hasher.finalize().into())
}

/// A document in its one spelling.
fn canonical_document(document: &StrategyAuthoringDocumentV1) -> StrategyAuthoringDocumentV1 {
    let mut canonical = document.clone();
    canonical.inputs.sort_by(|a, b| a.name.cmp(&b.name));
    canonical.definitions.sort_by(|a, b| a.name.cmp(&b.name));
    canonical.states.sort_by(|a, b| a.name.cmp(&b.name));
    let literal = |operand: &mut String| *operand = canonical_literal(operand);

    for definition in &mut canonical.definitions {
        match &mut definition.expr {
            AuthoringExpressionV1::Add { a, b }
            | AuthoringExpressionV1::Sub { a, b }
            | AuthoringExpressionV1::Mul { a, b }
            | AuthoringExpressionV1::Compare { a, b, .. } => {
                literal(a);
                literal(b);
            }
            _ => {}
        }
    }
    canonical
}

/// A decimal literal without trailing zeros after its point, and without the point when nothing
/// follows it; a name is left as written.
fn canonical_literal(operand: &str) -> String {
    if operand.starts_with(|character: char| character.is_ascii_lowercase())
        || !operand.contains('.')
    {
        return operand.to_owned();
    }
    let trimmed = operand.trim_end_matches('0').trim_end_matches('.');
    if trimmed == "-0" || trimmed.is_empty() {
        "0".to_owned()
    } else {
        trimmed.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    /// Research T0's document keeps the catalog identity a deployment answered for it, so a change
    /// to the language that does not change an OHLC document cannot move the id it is stored under.
    #[rstest]
    fn research_t0_keeps_its_catalog_identity() {
        let document = serde_json::from_str(include_str!(
            "../test_data/strategy_authoring_v1/t0-daily-trend.json"
        ))
        .expect("the T0 document parses");
        let canonical = canonical_strategy_statement_v1(&StrategyStatementV1::Authored(document))
            .expect("T0 is a statement");

        assert_eq!(
            canonical.identity().to_string(),
            "sha256:dae7fb403a3a16c17f3c3b7eeafd252b281dd06969d4a0cf3ef85f2868388a4a"
        );
    }

    /// Admits a single-threshold statement.
    fn canonical_strategy_spec_v1(
        spec: &SingleThresholdStrategySpecV1,
    ) -> Result<CanonicalStrategyStatementV1, StrategyStatementErrorV1> {
        canonical_strategy_statement_v1(&StrategyStatementV1::SingleThreshold(Box::new(
            spec.clone(),
        )))
    }

    /// The threshold a single-threshold statement was admitted with.
    fn threshold_of(canonical: &CanonicalStrategyStatementV1) -> &str {
        match canonical.statement() {
            StrategyStatementV1::SingleThreshold(spec) => &spec.threshold,
            StrategyStatementV1::Authored(_) => panic!("a single-threshold statement"),
        }
    }

    fn spec() -> SingleThresholdStrategySpecV1 {
        SingleThresholdStrategySpecV1 {
            channel: SingleThresholdChannelV1::ExactInstrument {
                role_semantic_id: "research.input.close.daily.v1".to_owned(),
                instrument: "BTCUSDT-PERP.BINANCE".to_owned(),
                field_semantic_id: "MARKET_DATA.BAR.CLOSE.PRICE.V1".to_owned(),
                timeframe: "1D".to_owned(),
                unit: "PRICE".to_owned(),
                scale: 2,
            },
            threshold: "100".to_owned(),
            comparison: BoundedFeaturePredicateV1::Greater,
            when_true: SingleThresholdOutcomeV1 {
                position_intent_semantic_id: "kernel.position.enter.v1".to_owned(),
                target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
                target_position_units: 1,
                target_weight_micros: 0,
            },
            otherwise: SingleThresholdOutcomeV1 {
                position_intent_semantic_id: "kernel.position.exit.v1".to_owned(),
                target_variant_semantic_id: "kernel.target.position.v1".to_owned(),
                target_position_units: 0,
                target_weight_micros: 0,
            },
            stop_loss_fraction: Some("0.02".to_owned()),
            take_profit_fraction: None,
            max_holding_bars: Some(5),
            falsifier: "the close never crosses the threshold in the admitted window".to_owned(),
        }
    }

    /// One statement, one identity: the same statement always hashes to the same id, and any
    /// change to what the author decided makes a different one.
    #[rstest]
    fn a_strategy_is_named_by_its_statement() {
        let base = canonical_strategy_spec_v1(&spec()).expect("the statement authors");
        assert_eq!(
            canonical_strategy_spec_v1(&spec()).expect("the statement authors"),
            base
        );

        let mut changed = spec();
        changed.max_holding_bars = Some(6);
        assert_ne!(
            canonical_strategy_spec_v1(&changed)
                .expect("the statement authors")
                .identity(),
            base.identity()
        );
    }

    /// A threshold is hashed at its one spelling: trailing zeros name the same strategy, a different
    /// value names another, and a value finer than the channel's scale is refused by name.
    #[rstest]
    fn a_threshold_spelled_two_ways_is_one_strategy() {
        let short = canonical_strategy_spec_v1(&spec()).expect("authors");
        let padded = canonical_strategy_spec_v1(&SingleThresholdStrategySpecV1 {
            threshold: "100.00".to_owned(),
            ..spec()
        })
        .expect("authors");
        assert_eq!(padded.identity(), short.identity());
        assert_eq!(threshold_of(&padded), "100");
        assert_ne!(
            canonical_strategy_spec_v1(&SingleThresholdStrategySpecV1 {
                threshold: "100.01".to_owned(),
                ..spec()
            })
            .expect("authors")
            .identity(),
            short.identity(),
        );
        assert_eq!(
            canonical_strategy_spec_v1(&SingleThresholdStrategySpecV1 {
                threshold: "100.001".to_owned(),
                ..spec()
            })
            .map(|_| ())
            .unwrap_err()
            .code(),
            "THRESHOLD_FINER_THAN_CHANNEL_SCALE",
        );
    }

    /// The identity does not depend on any Research request: the statement is authored under
    /// different Research identities into different Designs, and still has one identity.
    #[rstest]
    fn the_identity_is_independent_of_the_research_a_run_supplies() {
        use crate::strategy_plan_v2::{StrategyDesignPreparationV2, prepare_strategy_design_v2};

        let design_identity = |seed: u8| {
            let digest = BindingDigest::from_untrusted_bytes([seed; 32]);
            let (design, _) = author_single_threshold_program_v1(
                &spec().authoring_request(digest, digest, digest, "1D"),
            )
            .expect("the statement authors");
            let StrategyDesignPreparationV2::Prepared {
                design_identity, ..
            } = prepare_strategy_design_v2(&design)
            else {
                panic!("an authored Design canonicalizes");
            };
            design_identity
        };

        assert_ne!(
            design_identity(1),
            design_identity(2),
            "the Design changes with the Research"
        );
        let canonical = canonical_strategy_spec_v1(&spec()).expect("the statement authors");
        let text = std::str::from_utf8(canonical.canonical_bytes()).expect("JSON is UTF-8");

        for identity in [
            "research_request_identity",
            "intent_identity",
            "intent_digest",
        ] {
            assert!(
                !text.contains(identity),
                "{identity} is not part of the statement"
            );
        }
    }

    /// A statement the family would not author is refused under the author's own name, so the
    /// catalog never holds one.
    #[rstest]
    fn a_statement_the_family_refuses_is_not_admitted() {
        let mut refused = spec();
        refused.max_holding_bars = Some(0);

        assert_eq!(
            canonical_strategy_spec_v1(&refused),
            Err(StrategyStatementErrorV1::SingleThreshold(
                SingleThresholdAuthoringErrorV1::MaxHoldingBarsZero
            ))
        );
    }

    fn t0() -> StrategyAuthoringDocumentV1 {
        serde_json::from_str(include_str!(
            "../test_data/strategy_authoring_v1/t0-daily-trend.json"
        ))
        .expect("the T0 document parses")
    }

    /// An authored document is a strategy the catalog holds: it is admitted by authoring, named
    /// under its own domain, and named once whatever order its definitions are written in or
    /// however a literal spells its trailing zeros.
    #[rstest]
    fn an_authored_document_is_one_strategy_however_it_is_spelled() {
        let document = t0();
        let admitted =
            canonical_strategy_statement_v1(&StrategyStatementV1::Authored(document.clone()))
                .expect("T0 is admitted");
        let mut respelled = document;
        respelled.definitions.reverse();
        respelled.inputs.reverse();
        for definition in &mut respelled.definitions {
            if let AuthoringExpressionV1::Mul { b, .. } = &mut definition.expr {
                *b = "2.00".to_owned();
            }
        }
        let again = canonical_strategy_statement_v1(&StrategyStatementV1::Authored(respelled))
            .expect("the respelled T0 is admitted");

        assert_eq!(again.identity(), admitted.identity());
        assert_eq!(again.canonical_bytes(), admitted.canonical_bytes());
        assert_eq!(
            stored_strategy_identity_v1(admitted.canonical_bytes()),
            Some(admitted.identity()),
            "the stored bytes prove their identity"
        );
        let single = canonical_strategy_spec_v1(&spec()).expect("authors");
        assert_ne!(single.identity(), admitted.identity());
        assert_eq!(
            serde_json::from_slice::<StrategyStatementV1>(admitted.canonical_bytes()).ok(),
            Some(admitted.statement().clone()),
            "a stored document reads back as a document"
        );
    }

    /// The wire identity reads back exactly, and only in its one spelling.
    #[rstest]
    fn the_identity_has_one_wire_spelling() {
        let identity = canonical_strategy_spec_v1(&spec())
            .expect("the statement authors")
            .identity();
        let text = identity.to_string();

        assert_eq!(StrategyIdentityV1::parse(&text), Some(identity));
        assert_eq!(StrategyIdentityV1::parse(&text.to_uppercase()), None);
        assert_eq!(StrategyIdentityV1::parse(&text["sha256:".len()..]), None);
        assert_eq!(StrategyIdentityV1::parse(&format!("{text}0")), None);
    }

    /// The statement is exactly the authoring request without its three Research identities:
    /// a request serialised without them reads as a statement, and states the same request back.
    #[rstest]
    fn a_statement_is_the_authoring_request_without_its_research() {
        let digest = BindingDigest::from_untrusted_bytes([7; 32]);
        let request = spec().authoring_request(digest, digest, digest, "1D");
        let mut wire = serde_json::to_value(&request).expect("the request serialises");
        let object = wire.as_object_mut().expect("a JSON object");

        for identity in [
            "research_request_identity",
            "intent_identity",
            "intent_digest",
        ] {
            object.remove(identity).expect("the request carries it");
        }
        let read: SingleThresholdStrategySpecV1 =
            serde_json::from_value(wire).expect("the rest reads as a statement");

        assert_eq!(read, spec());
        assert_eq!(
            read.authoring_request(digest, digest, digest, "1D"),
            request
        );
    }
}
