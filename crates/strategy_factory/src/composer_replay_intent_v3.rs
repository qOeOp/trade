//! Exact current Research Intent selected for a Composer-backed Replay, and the TrialFamily state
//! it is composed against.
//!
//! A successor Intent is not itself an appended TrialFamily attempt. It must bind the current
//! Census Frontier and the last completed attempt, while the initial Intent is eligible only
//! before any attempt has been appended.
//!
//! Which TrialFamily state a Replay binds follows the legacy Replay's own rule: a Replay of the
//! family's formation Intent binds the family as it formed (its V1 census frontier), and only a
//! successor binds the V2 census. An attempt is one Replay recorded after its Result
//! (`docs/architecture/strategy-factory.md`, value-stream handoffs), so a family's first Replay
//! cannot be composed against a V2 census, which holds at least one attempt.

use std::fmt::Display;

#[cfg(feature = "composer-v3-replay")]
use sqlx::{Postgres, Transaction};
use vibe_data::owner::source_binding::BindingDigest;

#[cfg(feature = "composer-v3-replay")]
use crate::{
    develop_composer_postgres_v2::SealedDevelopComposerReadbackV2,
    successor_intent_postgres::load_by_intent_in_transaction,
    trial_family_postgres::{
        load_trial_family_by_family_in_transaction,
        load_trial_family_census_v2_at_frontier_in_transaction,
        load_trial_family_census_v2_by_family_in_transaction,
        trial_family_head_schema_in_transaction,
    },
};
use crate::{
    exploratory_replay::ExploratoryReplayOwnerError,
    trial_family::{
        TrialFamilyCensusReadbackV2, TrialFamilyError, TrialFamilyReadbackV1, verify_census_v2,
        verify_family,
    },
};

pub(crate) struct ComposerReplayIntentV3 {
    identity: String,
    digest: String,
}

impl ComposerReplayIntentV3 {
    pub(crate) fn identity(&self) -> &str {
        &self.identity
    }

    pub(crate) fn digest(&self) -> &str {
        &self.digest
    }
}

/// The refusal of a successor Replay while its family has no V2 census to bind. Only an admitted
/// R&D Decision composition appends an attempt (`docs/owners/rd.md`, "same-cut Decision and
/// Selection composition", TARGET / NOT_ADMITTED), so until it exists a successor Replay has
/// nothing to compose against.
#[cfg(feature = "composer-v3-replay")]
pub(crate) const SUCCESSOR_CENSUS_AWAITS_DECISION_COMPOSITION_V3: &str =
    "SUCCESSOR_CENSUS_AWAITS_DECISION_COMPOSITION";

/// The TrialFamily state a Composer-backed Replay is composed against.
#[cfg_attr(
    not(feature = "composer-v3-replay"),
    expect(
        dead_code,
        reason = "constructed only by the Composer-backed Replay family-cut loader, which that feature carries"
    )
)]
pub(crate) enum ComposerReplayFamilyCutV3 {
    /// A Replay of the family's formation Intent: the family as it formed, with its V1 census
    /// frontier.
    FirstGeneration(Box<TrialFamilyReadbackV1>),
    /// A Replay of a successor Intent: the V2 census the successor was admitted against.
    Successor(Box<TrialFamilyCensusReadbackV2>),
}

impl ComposerReplayFamilyCutV3 {
    pub(crate) fn legacy_family(&self) -> &TrialFamilyReadbackV1 {
        match self {
            Self::FirstGeneration(family) => family,
            Self::Successor(census) => &census.legacy_family,
        }
    }

    pub(crate) fn frontier_identity(&self) -> &str {
        match self {
            Self::FirstGeneration(family) => family.census_frontier().frontier_identity(),
            Self::Successor(census) => census.census_frontier.frontier_identity(),
        }
    }

    pub(crate) fn frontier_digest(&self) -> &str {
        match self {
            Self::FirstGeneration(family) => family.census_frontier().frontier_digest(),
            Self::Successor(census) => census.census_frontier.frontier_digest(),
        }
    }

    pub(crate) fn frontier_trial_family_identity(&self) -> &str {
        match self {
            Self::FirstGeneration(family) => family.census_frontier().trial_family_identity(),
            Self::Successor(census) => census.census_frontier.trial_family_identity(),
        }
    }

    /// Verifies the family, and for a successor the whole V2 census, as their own Owner readbacks.
    pub(crate) fn verify(&self) -> Result<(), TrialFamilyError> {
        match self {
            Self::FirstGeneration(family) => verify_family(family),
            Self::Successor(census) => verify_census_v2(census),
        }
    }
}

/// Which TrialFamily state a Composer-backed Replay binds.
#[cfg(feature = "composer-v3-replay")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FamilyCutChoiceV3 {
    FirstGeneration,
    Successor,
}

/// Chooses the TrialFamily state a Composer-backed Replay of `composer_intent` binds, the one rule
/// the commit and the historical readback both take.
///
/// A Replay of the family's formation Intent binds the family as it formed; any other Intent is a
/// successor and binds the V2 census. With `frontier` absent the choice is for a new Replay, which a
/// first generation may make only while the family has no attempt (`head_schema` 1) and a
/// successor only once one exists. With `frontier` present it re-derives an existing Replay's
/// choice, and a first generation's recorded frontier must be the family's formation frontier.
#[cfg(feature = "composer-v3-replay")]
fn choose_family_cut_v3(
    family: &TrialFamilyReadbackV1,
    composer_intent: BindingDigest,
    head_schema: u64,
    frontier: Option<(&str, &str)>,
) -> Result<FamilyCutChoiceV3, ExploratoryReplayOwnerError> {
    let formation = parse_named_sha256(
        family.initial_intent_member().fact_identity(),
        "rd-research-intent-v2-",
    )? == composer_intent;

    if !formation {
        return if head_schema == 1 {
            Err(unavailable(SUCCESSOR_CENSUS_AWAITS_DECISION_COMPOSITION_V3))
        } else {
            Ok(FamilyCutChoiceV3::Successor)
        };
    }
    let formed = family.census_frontier();

    match frontier {
        Some((identity, digest))
            if formed.frontier_identity() != identity || formed.frontier_digest() != digest =>
        {
            Err(unavailable(
                "Composer Replay first-generation census frontier mismatch",
            ))
        }
        None if head_schema != 1 => Err(unavailable(
            "initial Intent is not the current TrialFamily attempt",
        )),
        _ => Ok(FamilyCutChoiceV3::FirstGeneration),
    }
}

/// Reads the TrialFamily state a Composer-backed Replay of `composer` binds, as
/// [`choose_family_cut_v3`] chooses it.
///
/// With `frontier` absent it is the current state a new Replay composes against. With `frontier`
/// present it is the state an existing Replay recorded, re-read for its historical readback, which
/// a later attempt does not change: the family as it formed is re-derived from its root, whatever
/// its head has become.
///
/// # Errors
///
/// `Unavailable` when the family or its census cannot be read, and the refusals
/// [`choose_family_cut_v3`] names.
#[cfg(feature = "composer-v3-replay")]
pub(crate) async fn load_composer_replay_family_cut_v3(
    transaction: &mut Transaction<'_, Postgres>,
    trial_family_identity: &str,
    composer: &SealedDevelopComposerReadbackV2,
    frontier: Option<(&str, &str)>,
) -> Result<ComposerReplayFamilyCutV3, ExploratoryReplayOwnerError> {
    let family = load_trial_family_by_family_in_transaction(transaction, trial_family_identity)
        .await
        .map_err(unavailable)?;
    let head_schema = trial_family_head_schema_in_transaction(transaction, trial_family_identity)
        .await
        .map_err(unavailable)?;

    match choose_family_cut_v3(&family, composer.intent_identity(), head_schema, frontier)? {
        FamilyCutChoiceV3::FirstGeneration => {
            Ok(ComposerReplayFamilyCutV3::FirstGeneration(Box::new(family)))
        }
        FamilyCutChoiceV3::Successor => {
            let census = match frontier {
                Some((identity, digest)) => {
                    Box::pin(load_trial_family_census_v2_at_frontier_in_transaction(
                        transaction,
                        trial_family_identity,
                        identity,
                        digest,
                    ))
                    .await
                }
                None => {
                    load_trial_family_census_v2_by_family_in_transaction(
                        transaction,
                        trial_family_identity,
                    )
                    .await
                }
            }
            .map_err(unavailable)?;
            Ok(ComposerReplayFamilyCutV3::Successor(Box::new(census)))
        }
    }
}

#[cfg(feature = "composer-v3-replay")]
pub(crate) async fn resolve_composer_replay_intent_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    cut: &ComposerReplayFamilyCutV3,
    composer: &SealedDevelopComposerReadbackV2,
) -> Result<ComposerReplayIntentV3, ExploratoryReplayOwnerError> {
    let census = match cut {
        ComposerReplayFamilyCutV3::FirstGeneration(family) => {
            let initial = family.initial_intent_member();
            return Ok(ComposerReplayIntentV3 {
                identity: initial.fact_identity().to_owned(),
                digest: initial.fact_digest().to_owned(),
            });
        }
        ComposerReplayFamilyCutV3::Successor(census) => census,
    };

    let successor_identity = format!(
        "rd-successor-research-intent-v1-{}",
        hex(composer.intent_identity())
    );
    let successor = load_by_intent_in_transaction(transaction, &successor_identity)
        .await
        .map_err(unavailable)?
        .ok_or_else(|| unavailable("Composer successor Intent custody is unavailable"))?;
    let intent = successor.intent();
    let predecessor = census.latest_intent_binding().map_err(unavailable)?;
    if intent.intent_identity() != successor_identity
        || intent.trial_family_identity() != census.legacy_family.root().trial_family_identity()
        || intent.trial_family_policy_digest() != census.legacy_family.root().policy_digest()
        || intent.census_frontier_identity() != census.census_frontier.frontier_identity()
        || intent.census_frontier_digest() != census.census_frontier.frontier_digest()
        || intent.predecessor_intent_identity() != predecessor.intent_identity
        || intent.predecessor_intent_digest() != predecessor.intent_digest
    {
        return Err(unavailable(
            "Composer successor Intent is not current for TrialFamily",
        ));
    }
    Ok(ComposerReplayIntentV3 {
        identity: intent.intent_identity().to_owned(),
        digest: intent.intent_digest().to_owned(),
    })
}

pub(crate) fn parse_named_sha256(
    value: &str,
    prefix: &str,
) -> Result<BindingDigest, ExploratoryReplayOwnerError> {
    let suffix = value
        .strip_prefix(prefix)
        .ok_or_else(|| unavailable("canonical named SHA-256 identity is unavailable"))?;
    let bytes = decode_hex(suffix)?;
    Ok(BindingDigest::from_untrusted_bytes(bytes))
}

fn decode_hex(value: &str) -> Result<[u8; 32], ExploratoryReplayOwnerError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(unavailable("canonical digest is unavailable"));
    }
    let mut bytes = [0_u8; 32];
    for (output, pair) in bytes.iter_mut().zip(value.as_bytes().chunks_exact(2)) {
        let nibble = |byte| match byte {
            b'0'..=b'9' => byte - b'0',
            b'a'..=b'f' => byte - b'a' + 10,
            _ => unreachable!("canonical hexadecimal was checked above"),
        };
        *output = (nibble(pair[0]) << 4) | nibble(pair[1]);
    }
    Ok(bytes)
}

pub(crate) fn hex(value: BindingDigest) -> String {
    value
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn unavailable(error: impl Display) -> ExploratoryReplayOwnerError {
    ExploratoryReplayOwnerError::Unavailable(error.to_string())
}

#[cfg(all(test, feature = "sealed-source-intake-composer-acceptance"))]
mod family_cut_tests {
    use rstest::rstest;

    use super::*;
    use crate::trial_family::{
        TrialFamilyIndependenceDispositionV1, TrialFamilyPolicyV1, form_initial_family,
    };

    const FORMATION: [u8; 32] = [0x5a; 32];

    /// A family formed for the Intent named by `FORMATION`, before any attempt.
    fn family() -> TrialFamilyReadbackV1 {
        form_initial_family(
            &format!(
                "rd-research-intent-v2-{}",
                hex(BindingDigest::from_untrusted_bytes(FORMATION))
            ),
            &format!("sha256:{}", "1".repeat(64)),
            TrialFamilyPolicyV1 {
                trial_budget: 2,
                stop_rule: "stop after the bounded falsifier".to_owned(),
                pit_rule_identity: "pit-rule-v1".to_owned(),
                cost_model_identity: "cost-model-v1".to_owned(),
                slippage_model_identity: "slippage-model-v1".to_owned(),
                capacity_model_identity: "capacity-model-v1".to_owned(),
                semantic_predecessor_frontier: vec![],
                protected_feedback_frontier: "qualification-frontier-v1".to_owned(),
                independence_disposition: TrialFamilyIndependenceDispositionV1::Independent,
                independence_basis_identity: "independence-basis-v1".to_owned(),
                frozen_falsifier_binding: TrialFamilyPolicyV1::expected_falsifier_binding(
                    "Does the bounded signal survive exact costs?",
                )
                .unwrap(),
                replay_execution_policy_v2: None,
                replay_policy_catalog_v3: None,
                decision_policy_v1: None,
            },
            1,
        )
        .expect("a family forms")
    }

    fn formation() -> BindingDigest {
        BindingDigest::from_untrusted_bytes(FORMATION)
    }

    fn successor() -> BindingDigest {
        BindingDigest::from_untrusted_bytes([0x6b; 32])
    }

    fn refusal(choice: Result<FamilyCutChoiceV3, ExploratoryReplayOwnerError>) -> String {
        match choice {
            Err(ExploratoryReplayOwnerError::Unavailable(reason)) => reason,
            other => panic!("expected a refusal but the choice was {other:?}"),
        }
    }

    /// A new Replay of the family's formation Intent binds the family as it formed, and its cut
    /// names the formation (V1) census frontier, while the family has no attempt.
    #[rstest]
    fn a_first_generation_replay_binds_the_formation_frontier() {
        let family = family();
        let formed = family.census_frontier().clone();

        assert_eq!(
            choose_family_cut_v3(&family, formation(), 1, None).unwrap(),
            FamilyCutChoiceV3::FirstGeneration
        );
        let cut = ComposerReplayFamilyCutV3::FirstGeneration(Box::new(family));
        cut.verify().expect("the formed family verifies");
        assert_eq!(cut.frontier_identity(), formed.frontier_identity());
        assert_eq!(cut.frontier_digest(), formed.frontier_digest());
        assert_eq!(
            cut.frontier_trial_family_identity(),
            cut.legacy_family().root().trial_family_identity()
        );
    }

    /// Once the family has an attempt, a new Replay of its formation Intent is refused: the
    /// initial Intent is eligible only before any attempt.
    #[rstest]
    fn a_first_generation_replay_after_an_attempt_is_refused() {
        assert_eq!(
            refusal(choose_family_cut_v3(&family(), formation(), 2, None)),
            "initial Intent is not the current TrialFamily attempt"
        );
    }

    /// An existing first-generation Replay re-reads exactly the frontier it recorded, whatever the
    /// family's head has become; a recorded frontier that is not the formation frontier is refused.
    #[rstest]
    #[case::identity_tampered(true, false)]
    #[case::digest_tampered(false, true)]
    fn a_first_generation_readback_refuses_a_frontier_that_is_not_the_formation_frontier(
        #[case] tamper_identity: bool,
        #[case] tamper_digest: bool,
    ) {
        let family = family();
        let formed = family.census_frontier().clone();
        let identity = if tamper_identity {
            format!("{}-tampered", formed.frontier_identity())
        } else {
            formed.frontier_identity().to_owned()
        };
        let digest = if tamper_digest {
            format!("sha256:{}", "e".repeat(64))
        } else {
            formed.frontier_digest().to_owned()
        };

        for head_schema in [1, 2] {
            assert_eq!(
                choose_family_cut_v3(
                    &family,
                    formation(),
                    head_schema,
                    Some((formed.frontier_identity(), formed.frontier_digest())),
                )
                .unwrap(),
                FamilyCutChoiceV3::FirstGeneration,
                "the recorded formation frontier re-reads at head schema {head_schema}"
            );
            assert_eq!(
                refusal(choose_family_cut_v3(
                    &family,
                    formation(),
                    head_schema,
                    Some((&identity, &digest)),
                )),
                "Composer Replay first-generation census frontier mismatch"
            );
        }
    }

    /// A successor binds the V2 census, and while the family has none it is refused by name.
    #[rstest]
    fn a_successor_binds_the_v2_census_and_waits_for_decision_composition_without_one() {
        assert_eq!(
            choose_family_cut_v3(&family(), successor(), 2, None).unwrap(),
            FamilyCutChoiceV3::Successor
        );
        assert_eq!(
            refusal(choose_family_cut_v3(&family(), successor(), 1, None)),
            SUCCESSOR_CENSUS_AWAITS_DECISION_COMPOSITION_V3
        );
    }
}
