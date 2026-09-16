//! Exact current Research Intent selected for a Composer-backed Replay.
//!
//! A successor Intent is not itself an appended TrialFamily attempt. It must bind the current
//! Census Frontier and the last completed attempt, while the initial Intent is eligible only
//! before any attempt has been appended.

use std::fmt::Display;

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use sqlx::{Postgres, Transaction};
use vibe_data::owner::source_binding::BindingDigest;

use crate::exploratory_replay::ExploratoryReplayOwnerError;
#[cfg(feature = "sealed-source-intake-composer-acceptance")]
use crate::{
    develop_composer_postgres_v2::SealedDevelopComposerReadbackV2,
    successor_intent_postgres::load_by_intent_in_transaction,
    trial_family::TrialFamilyCensusReadbackV2,
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

#[cfg(feature = "sealed-source-intake-composer-acceptance")]
pub(crate) async fn resolve_composer_replay_intent_in_transaction(
    transaction: &mut Transaction<'_, Postgres>,
    census: &TrialFamilyCensusReadbackV2,
    composer: &SealedDevelopComposerReadbackV2,
) -> Result<ComposerReplayIntentV3, ExploratoryReplayOwnerError> {
    let initial = census.legacy_family.initial_intent_member();
    if parse_named_sha256(initial.fact_identity(), "rd-research-intent-v2-")?
        == composer.intent_identity()
    {
        if census.members.len() != 1 {
            return Err(unavailable(
                "initial Intent is not the current TrialFamily attempt",
            ));
        }
        return Ok(ComposerReplayIntentV3 {
            identity: initial.fact_identity().to_owned(),
            digest: initial.fact_digest().to_owned(),
        });
    }

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
