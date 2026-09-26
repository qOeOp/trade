//! The identities of the READY Candidate lineages that Qualification acceptance consumes.
//!
//! One acceptance entry mints each lineage through R&D; the Qualification entries that consume it
//! run in other processes and cannot be handed what it minted. Both sides therefore compute the same
//! identities from the same `(fixture_key, lineage)`, and a consumer reads exactly the lineage it
//! names instead of selecting whichever matching one is newest. A consumer that finds no row for its
//! identities knows the lineage was never minted, rather than silently taking another one.
//!
//! `fixture_key` names the minting fixture, so two fixtures that mint the same lineage never share
//! its identities, and a consumer that changes a lineage's state never meets another consumer's.

use sha2::{Digest, Sha256};

use crate::CandidateIntakeStatusV1;

const READY_LINEAGE_ACCEPTANCE_DOMAIN_V1: &[u8] = b"qualification.ready-lineage-acceptance.v1\0";

/// The fixture key of the ordered Owner chain's READY entry, which mints every lineage the chain's
/// Qualification entries consume.
pub const ORDERED_CHAIN_READY_FIXTURE_KEY_V1: &str = "iteration_decision_postgres::positive_assessment_ready_decision_commit_retry_resolve_and_tamper_are_atomic";

/// One Candidate lineage, named by the Qualification outcome it is minted for. A Candidate reserves
/// holdout and seals one protected request set exactly once, so each outcome needs its own.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReadyLineageV1 {
    /// Consumed by the Origin (`schema_version=1`) protected attempt entries.
    Origin,
    /// Driven to `QUALIFIED` by the protected-evaluation entries.
    EconomicPass,
    /// Driven to `INELIGIBLE` by the protected-evaluation entries.
    EconomicFailure,
    /// Driven to `ASSESSMENT_INVALID` by the protected-evaluation entries.
    AllNotApplicable,
    /// A single preregistered time window, which Qualification closes `NOT_ADMITTED` at intake.
    InadequatePlan,
}

impl ReadyLineageV1 {
    /// The name the lineage's review request identity carries.
    pub const fn review_slug(self) -> &'static str {
        match self {
            Self::Origin => "ready",
            Self::EconomicPass => "economic-pass",
            Self::EconomicFailure => "economic-failure",
            Self::AllNotApplicable => "all-not-applicable",
            Self::InadequatePlan => "inadequate-plan",
        }
    }

    /// The status Qualification's intake gives the lineage's Candidate.
    pub const fn expected_intake_status(self) -> CandidateIntakeStatusV1 {
        match self {
            Self::InadequatePlan => CandidateIntakeStatusV1::NotAdmitted,
            _ => CandidateIntakeStatusV1::Admitted,
        }
    }
}

/// The identities of one lineage under one fixture key.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReadyLineageAcceptanceIdentityV1 {
    suffix: String,
    review_request_identity: String,
}

impl ReadyLineageAcceptanceIdentityV1 {
    /// The suffix every identity the minting fixture writes for this lineage ends with.
    pub fn suffix(&self) -> &str {
        &self.suffix
    }

    /// The review request identity of the lineage's Candidate intake.
    pub fn review_request_identity(&self) -> &str {
        &self.review_request_identity
    }
}

/// The identities of `lineage` under `fixture_key`. The same inputs always give the same
/// identities, and distinct keys or lineages give distinct ones.
pub fn ready_lineage_acceptance_identity_v1(
    fixture_key: &str,
    lineage: ReadyLineageV1,
) -> ReadyLineageAcceptanceIdentityV1 {
    let mut digest = Sha256::new();
    digest.update(READY_LINEAGE_ACCEPTANCE_DOMAIN_V1);
    digest.update((fixture_key.len() as u64).to_le_bytes());
    digest.update(fixture_key.as_bytes());
    digest.update(lineage.review_slug().as_bytes());
    let suffix = digest.finalize()[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    ReadyLineageAcceptanceIdentityV1 {
        review_request_identity: format!("qualification-review-{}-{suffix}", lineage.review_slug()),
        suffix,
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::{
        ORDERED_CHAIN_READY_FIXTURE_KEY_V1, ReadyLineageV1, ready_lineage_acceptance_identity_v1,
    };

    const LINEAGES: [ReadyLineageV1; 5] = [
        ReadyLineageV1::Origin,
        ReadyLineageV1::EconomicPass,
        ReadyLineageV1::EconomicFailure,
        ReadyLineageV1::AllNotApplicable,
        ReadyLineageV1::InadequatePlan,
    ];

    #[rstest]
    fn the_same_key_and_lineage_always_give_the_same_identities() {
        for lineage in LINEAGES {
            assert_eq!(
                ready_lineage_acceptance_identity_v1(ORDERED_CHAIN_READY_FIXTURE_KEY_V1, lineage),
                ready_lineage_acceptance_identity_v1(ORDERED_CHAIN_READY_FIXTURE_KEY_V1, lineage),
            );
        }
    }

    #[rstest]
    fn distinct_keys_or_lineages_never_share_an_identity() {
        let identities = ["fixture-a", "fixture-b"]
            .into_iter()
            .flat_map(|key| {
                LINEAGES.map(|lineage| {
                    ready_lineage_acceptance_identity_v1(key, lineage)
                        .review_request_identity()
                        .to_owned()
                })
            })
            .collect::<std::collections::BTreeSet<_>>();

        assert_eq!(identities.len(), 2 * LINEAGES.len());
    }

    /// The review request identity keeps the shape the chain has always written, so every reader
    /// that recognises a lineage by its name still does.
    #[rstest]
    fn the_review_request_identity_names_its_lineage() {
        for lineage in LINEAGES {
            let identity = ready_lineage_acceptance_identity_v1("fixture", lineage);

            assert_eq!(
                identity.review_request_identity(),
                format!(
                    "qualification-review-{}-{}",
                    lineage.review_slug(),
                    identity.suffix()
                )
            );
            assert_eq!(identity.suffix().len(), 24);
            assert!(
                identity
                    .suffix()
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit())
            );
        }
    }
}
