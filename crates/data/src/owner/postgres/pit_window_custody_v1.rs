//! PIT window custody (slice T0-4a): the custody record, its cross-section versions and row facts,
//! committed once in one read-committed transaction that also mints the Owner clock it needs.
//!
//! The commit follows the Instrument Master V2 snapshot admission:
//!
//! 1. it loads the Source Binding and the Universe Selection record the request names;
//! 2. it takes the clock-state lock before the head's row lock, as every clock writer does, and
//!    fixes the minting cut: the head's, or the next Owner clock's when a row was retrieved after
//!    the head - computed here, admitted only in step 6;
//! 3. under that lock it selects the members' Instrument Master facts at the minting cut and
//!    derives every identity through
//!    [`authority`](crate::owner::pit_window_custody_v1::authority), refusing before any write;
//! 4. it locks the chain and the identity, and returns the stored receipt when the identity is
//!    already held with the same bytes, or refuses it as another meaning; a successor is decided
//!    against its chain head;
//! 5. it places every instant the minting cut decides and refuses a row retrieved after the cut
//!    or before its bar closed, and a version not available at the cut;
//! 6. it admits the minted clock, writes the custody, its versions, their `SampleFactV2` row facts
//!    prepared on the chain's own heads, and the chain head, and commits.
//!
//! Nothing outside this transaction can observe a partial custody: every refusal returns before
//! the commit, and the transaction rolls back when dropped.

use std::{
    collections::{BTreeMap, BTreeSet},
    fmt::Debug,
    sync::Arc,
};

use sqlx::{Postgres, Row, Transaction};

use super::{
    MarketDataClockAdmission, MarketDataOwnerPostgres, admit_clock, digest_from_bytes,
    load_current_clock_for_update, load_instrument_facts, load_source, lock_clock_state,
    lock_digests, next_owner_clock_admission_v1,
    universe_selection::recover_universe_selection_in_transaction_v1,
};
use crate::owner::{
    instrument_master::{
        InstrumentMasterError, InstrumentMasterFactV1,
        authority::{ObservationClockV1, observable_at, select_facts_observed},
    },
    pit_window_custody_v1::{
        PitWindowCustodyCommitV1, PitWindowCustodyReceiptV1, PitWindowCustodyRefusalV1,
        UntrustedPitWindowCustodyRequestV1,
        authority::{
            ChainPositionV1, CustodyBindingV1, CustodyFactSpanV1, CustodyInputsV1,
            CustodyInstrumentV1, CustodyMemberFactV1, CustodyMembershipV1, CustodyMintingClockV1,
            DerivedCustodyV1, StoredChainV1, StoredVersionV1, check_request_shape_v1,
            custody_digest_v1, derive_custody_v1, kind_from_tag, kind_tag,
        },
        schedule::{PitWindowScheduleFactV1, decode_window_schedule_v1, mint_window_schedules_v1},
        sealed,
    },
    sample_fact::v2::{
        SampleFactV2, SampleHeadsV2, decode_sample_fact_v2, prepare_sample_fact_v2,
        root_slot_identity_v2, series_identity_v2,
    },
    source_binding::{
        BindingDigest, SourceBindingOwnerReadback, UntrustedSourceBindingLocator,
        authority::derive_market_semantics_compatibility_identity_v1,
    },
    universe_selection::{UniverseSelectionErrorV1, UntrustedUniverseSelectionLocatorV1},
};

use PitWindowCustodyRefusalV1 as Refused;

/// The custody's four tables. Every one is append-only except the chain head, which a successor
/// moves; none is readable by `PUBLIC`.
pub(super) const SCHEMA_V1: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_window_custodies_v1 (custody_identity BYTEA PRIMARY KEY CHECK (octet_length(custody_identity)=32), custody_digest BYTEA NOT NULL CHECK (octet_length(custody_digest)=32), chain_root BYTEA NOT NULL CHECK (octet_length(chain_root)=32), chain_version BIGINT NOT NULL CHECK (chain_version>0), predecessor_identity BYTEA REFERENCES market_data_private.pit_window_custodies_v1(custody_identity), minting_cut_ns BIGINT NOT NULL CHECK (minting_cut_ns>0), rule_digest BYTEA NOT NULL CHECK (octet_length(rule_digest)=32), basis_digest BYTEA NOT NULL CHECK (octet_length(basis_digest)=32), canonical_bytes BYTEA NOT NULL, evidence_digest BYTEA NOT NULL CHECK (octet_length(evidence_digest)=32), minting_clock_identity TEXT NOT NULL CHECK (octet_length(minting_clock_identity)>0), minting_clock_epoch TEXT NOT NULL CHECK (octet_length(minting_clock_epoch)>0), minting_clock_sequence BIGINT NOT NULL CHECK (minting_clock_sequence>0), minting_restart_continuity_digest BYTEA NOT NULL CHECK (octet_length(minting_restart_continuity_digest)=32), minting_uncertainty_bound BIGINT NOT NULL CHECK (minting_uncertainty_bound>=0), minting_skew_bound BIGINT NOT NULL CHECK (minting_skew_bound>0), UNIQUE (chain_root, chain_version), CHECK ((chain_version=1)=(predecessor_identity IS NULL)), CHECK ((chain_version=1)=(chain_root=custody_identity)))",
    "REVOKE ALL ON TABLE market_data_private.pit_window_custodies_v1 FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_window_custody_heads_v1 (chain_root BYTEA PRIMARY KEY REFERENCES market_data_private.pit_window_custodies_v1(custody_identity), head_identity BYTEA NOT NULL REFERENCES market_data_private.pit_window_custodies_v1(custody_identity), head_version BIGINT NOT NULL CHECK (head_version>0))",
    "REVOKE ALL ON TABLE market_data_private.pit_window_custody_heads_v1 FROM PUBLIC",
    // A version identity names no custody, so two roots may hold the same version; it is keyed by
    // its custody, and unique within its chain.
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_window_cross_section_versions_v1 (custody_identity BYTEA NOT NULL REFERENCES market_data_private.pit_window_custodies_v1(custody_identity), chain_root BYTEA NOT NULL CHECK (octet_length(chain_root)=32), version_identity BYTEA NOT NULL CHECK (octet_length(version_identity)=32), timeframe_identity BYTEA NOT NULL CHECK (octet_length(timeframe_identity)=32), event_ns BIGINT NOT NULL CHECK (event_ns>=0), kind SMALLINT NOT NULL CHECK (kind IN (1,2,3)), correction_sequence BIGINT NOT NULL CHECK (correction_sequence>0), predecessor_version BYTEA CHECK (octet_length(predecessor_version)=32), availability_ns BIGINT NOT NULL CHECK (availability_ns>=0), publication_ns BIGINT NOT NULL CHECK (publication_ns>=0), PRIMARY KEY (custody_identity, version_identity), UNIQUE (chain_root, version_identity), CHECK ((kind=1)=(predecessor_version IS NULL)))",
    "REVOKE ALL ON TABLE market_data_private.pit_window_cross_section_versions_v1 FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_window_custody_rows_v1 (custody_identity BYTEA NOT NULL, chain_root BYTEA NOT NULL CHECK (octet_length(chain_root)=32), sample_identity BYTEA NOT NULL CHECK (octet_length(sample_identity)=32), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest)=32), version_identity BYTEA NOT NULL, member_ordinal SMALLINT NOT NULL CHECK (member_ordinal>=0), field TEXT NOT NULL, fact_bytes BYTEA NOT NULL, retrieval_ns BIGINT NOT NULL CHECK (retrieval_ns>=0), retrieval_route TEXT NOT NULL CHECK (octet_length(retrieval_route) BETWEEN 1 AND 128), PRIMARY KEY (custody_identity, sample_identity), UNIQUE (chain_root, sample_identity), FOREIGN KEY (custody_identity, version_identity) REFERENCES market_data_private.pit_window_cross_section_versions_v1(custody_identity, version_identity))",
    "REVOKE ALL ON TABLE market_data_private.pit_window_custody_rows_v1 FROM PUBLIC",
    // The window schedule a root custody mints for each member (T0-4b). It is not a BAR schedule
    // fact: it never joins, or advances, an instrument's `bar_schedule_*` chain.
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_window_schedule_facts_v1 (schedule_identity BYTEA PRIMARY KEY CHECK (octet_length(schedule_identity)=32), chain_root BYTEA NOT NULL REFERENCES market_data_private.pit_window_custody_heads_v1(chain_root), custody_identity BYTEA NOT NULL REFERENCES market_data_private.pit_window_custodies_v1(custody_identity), member_ordinal SMALLINT NOT NULL CHECK (member_ordinal>=0), instrument TEXT NOT NULL CHECK (octet_length(instrument)>0), timeframe_identity BYTEA NOT NULL CHECK (octet_length(timeframe_identity)=32), interval_ns BIGINT NOT NULL CHECK (interval_ns>0), phase_ns BIGINT NOT NULL CHECK (phase_ns>=0 AND phase_ns<interval_ns), window_start_ns BIGINT NOT NULL CHECK (window_start_ns>=0), window_end_ns_exclusive BIGINT NOT NULL CHECK (window_end_ns_exclusive>window_start_ns), im_key BYTEA NOT NULL CHECK (octet_length(im_key)=32), ms_identity BYTEA NOT NULL CHECK (octet_length(ms_identity)=32), cut_ns BIGINT NOT NULL CHECK (cut_ns>0), canonical_bytes BYTEA NOT NULL, UNIQUE (chain_root, member_ordinal), CHECK (chain_root=custody_identity))",
    "REVOKE ALL ON TABLE market_data_private.pit_window_schedule_facts_v1 FROM PUBLIC",
];

#[track_caller]
fn store_error(cause: &impl Debug) -> Refused {
    crate::owner::storage_diagnostic::refused_by_store_at(cause);
    Refused::StoreUnavailable
}

fn to_i64(value: u64) -> Result<i64, Refused> {
    i64::try_from(value).map_err(|_| Refused::InvalidRequest)
}

fn to_u64(value: i64) -> Result<u64, Refused> {
    u64::try_from(value).map_err(|_| Refused::StoreUnavailable)
}

fn digest(bytes: &[u8]) -> Result<BindingDigest, Refused> {
    digest_from_bytes(bytes).map_err(|_| Refused::StoreUnavailable)
}

/// One stored custody record, as the receipt and a rejoin read it.
struct StoredCustodyV1 {
    identity: BindingDigest,
    custody_digest: BindingDigest,
    chain_root: BindingDigest,
    chain_version: u64,
    predecessor: Option<BindingDigest>,
    minting_cut_ns: u64,
    rule_digest: BindingDigest,
    canonical_bytes: Vec<u8>,
}

impl StoredCustodyV1 {
    fn from_row(row: &sqlx::postgres::PgRow) -> Result<Self, Refused> {
        let bytes = |column: &str| -> Result<Vec<u8>, Refused> {
            row.try_get(column).map_err(|cause| store_error(&cause))
        };
        let predecessor: Option<Vec<u8>> = row
            .try_get("predecessor_identity")
            .map_err(|cause| store_error(&cause))?;
        Ok(Self {
            identity: digest(&bytes("custody_identity")?)?,
            custody_digest: digest(&bytes("custody_digest")?)?,
            chain_root: digest(&bytes("chain_root")?)?,
            chain_version: to_u64(
                row.try_get("chain_version")
                    .map_err(|cause| store_error(&cause))?,
            )?,
            predecessor: predecessor.as_deref().map(digest).transpose()?,
            minting_cut_ns: to_u64(
                row.try_get("minting_cut_ns")
                    .map_err(|cause| store_error(&cause))?,
            )?,
            rule_digest: digest(&bytes("rule_digest")?)?,
            canonical_bytes: bytes("canonical_bytes")?,
        })
    }

    const fn receipt(&self) -> PitWindowCustodyReceiptV1 {
        PitWindowCustodyReceiptV1::from_owner_custody(
            self.identity,
            self.custody_digest,
            self.chain_root,
            self.chain_version,
            self.rule_digest,
            self.minting_cut_ns,
        )
    }
}

async fn load_custody(
    transaction: &mut Transaction<'_, Postgres>,
    identity: BindingDigest,
) -> Result<Option<StoredCustodyV1>, Refused> {
    let row = sqlx::query(
        "SELECT custody_identity,custody_digest,chain_root,chain_version,predecessor_identity,minting_cut_ns,rule_digest,canonical_bytes FROM market_data_private.pit_window_custodies_v1 WHERE custody_identity=$1",
    )
    .bind(identity.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|cause| store_error(&cause))?;
    row.as_ref().map(StoredCustodyV1::from_row).transpose()
}

async fn load_chain_custodies(
    transaction: &mut Transaction<'_, Postgres>,
    chain_root: BindingDigest,
) -> Result<Vec<StoredCustodyV1>, Refused> {
    let rows = sqlx::query(
        "SELECT custody_identity,custody_digest,chain_root,chain_version,predecessor_identity,minting_cut_ns,rule_digest,canonical_bytes FROM market_data_private.pit_window_custodies_v1 WHERE chain_root=$1 ORDER BY chain_version",
    )
    .bind(chain_root.as_bytes().as_slice())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|cause| store_error(&cause))?;
    rows.iter().map(StoredCustodyV1::from_row).collect()
}

/// A stored identity rejoins only with the very bytes it is the identity of.
fn rejoin(
    stored: &StoredCustodyV1,
    canonical_bytes: &[u8],
    derived: &DerivedCustodyV1,
) -> Result<PitWindowCustodyReceiptV1, Refused> {
    if stored.canonical_bytes == canonical_bytes && stored.rule_digest == derived.rule_digest {
        Ok(stored.receipt())
    } else {
        Err(Refused::IdentityConflict)
    }
}

/// The binding the request names, as stored, with whether its locator is exactly the request's.
async fn load_binding(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &UntrustedSourceBindingLocator,
) -> Result<Option<CustodyBindingV1>, Refused> {
    let Some(stored) = load_source(transaction, locator.binding_id, false)
        .await
        .map_err(|cause| store_error(&cause))?
    else {
        return Ok(None);
    };
    let commit = stored.commit();
    let fact = commit.fact();
    let proposal = fact.proposal();
    Ok(Some(CustodyBindingV1 {
        admitted_under_locator: commit.receipt().locator() == locator
            && SourceBindingOwnerReadback::from_verified(&stored).is_admitted(),
        binding_id: fact.binding_id(),
        fact_digest: fact.digest(),
        lineage_root: fact.lineage_root(),
        lineage_version: fact.lineage_version(),
        availability_rule: fact.availability_rule().cloned(),
        bar_timeframes: fact.bar_timeframes().to_vec(),
        market_semantics_identity: derive_market_semantics_compatibility_identity_v1(
            &proposal.semantics,
        ),
        source_frontier_digest: fact.source_frontier().digest,
        correction_stream: fact.correction_frontier().stream_identity.clone(),
        correction_frontier_digest: fact.correction_frontier().digest,
    }))
}

async fn load_membership(
    transaction: &mut Transaction<'_, Postgres>,
    locator: &UntrustedUniverseSelectionLocatorV1,
) -> Result<Vec<CustodyMembershipV1>, Refused> {
    let readback = recover_universe_selection_in_transaction_v1(transaction, locator)
        .await
        .map_err(|e| match e {
            UniverseSelectionErrorV1::UnknownIdentity
            | UniverseSelectionErrorV1::RequestConflict => Refused::InvalidRequest,
            _ => Refused::StoreUnavailable,
        })?;
    Ok(readback
        .record()
        .membership()
        .iter()
        .map(|record| CustodyMembershipV1 {
            instrument: record.instrument().to_vec(),
            included: record.included(),
            effective_from_ns: record.effective_from_ns(),
            effective_until_ns: record.effective_until_ns(),
        })
        .collect())
}

/// What the Instrument Master selects for each member at the window's first and last instants,
/// observed at the minting cut on `clock`, the Owner clock the custody is minted under; and every
/// other fact of the member observable there that the selected one does not supersede.
async fn load_instruments(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedPitWindowCustodyRequestV1,
    clock: &MarketDataClockAdmission,
) -> Result<Vec<CustodyInstrumentV1>, Refused> {
    let observation = ObservationClockV1::from_owner_head(
        &clock.clock_identity,
        &clock.clock_epoch,
        clock.monotonic_sequence,
    )
    .ok_or(Refused::StoreUnavailable)?;
    let facts = load_instrument_facts(transaction, &request.members, false)
        .await
        .map_err(|cause| store_error(&cause))?;
    let cut = clock.decision_cut;
    let select = |member: &String, effective: u64| match select_facts_observed(
        &facts,
        std::slice::from_ref(member),
        i128::from(effective),
        i128::from(cut),
        cut,
        observation,
    ) {
        Ok(mut selected) => Ok(selected.pop()),
        Err(InstrumentMasterError::UnknownIdentity) => Ok(None),
        Err(_) => Err(Refused::StoreUnavailable),
    };
    let last = request.window_end_ns_exclusive - 1;
    request
        .members
        .iter()
        .map(|member| {
            let at_start = select(member, request.window_start_ns)?;
            let at_end = select(member, last)?.map(|fact| fact.digest());
            // The facts the selected one supersedes are its ancestors; every other observable
            // fact of the member is a rival for some part of the window.
            let mut superseded = BTreeSet::new();
            let mut cursor = at_start
                .as_ref()
                .and_then(InstrumentMasterFactV1::predecessor_fact_digest);

            while let Some(digest) = cursor {
                if !superseded.insert(digest) {
                    return Err(Refused::StoreUnavailable);
                }
                cursor = facts
                    .iter()
                    .find(|fact| fact.digest() == digest)
                    .and_then(InstrumentMasterFactV1::predecessor_fact_digest);
            }
            let others = facts
                .iter()
                .filter(|fact| {
                    fact.canonical_identity() == member.as_str()
                        && at_start
                            .as_ref()
                            .is_none_or(|selected| selected.digest() != fact.digest())
                        && !superseded.contains(&fact.digest())
                        && observable_at(fact, i128::from(cut), cut, observation)
                })
                .map(|fact| CustodyFactSpanV1 {
                    effective_from: fact.effective_from(),
                    effective_until: fact.effective_until(),
                })
                .collect();
            Ok(CustodyInstrumentV1 {
                at_start: at_start.map(|fact| CustodyMemberFactV1 {
                    fact_digest: fact.digest(),
                    class: fact.instrument_class(),
                    time_zone: fact.time_zone_identity().to_owned(),
                    market_semantics_identity: fact.market_semantics_identity(),
                    effective_until: fact.effective_until(),
                }),
                at_end,
                others,
            })
        })
        .collect()
}

/// The chain a successor extends, read at its head with the head's row locked.
async fn load_chain_for_update(
    transaction: &mut Transaction<'_, Postgres>,
    chain_root: BindingDigest,
) -> Result<StoredChainV1, Refused> {
    let head = sqlx::query(
        "SELECT h.head_identity,h.head_version,c.basis_digest FROM market_data_private.pit_window_custody_heads_v1 h JOIN market_data_private.pit_window_custodies_v1 c ON c.custody_identity=h.head_identity WHERE h.chain_root=$1 FOR UPDATE OF h",
    )
    .bind(chain_root.as_bytes().as_slice())
    .fetch_optional(&mut **transaction)
    .await
    .map_err(|cause| store_error(&cause))?
    // A claim naming no chain names nothing a successor could extend.
    .ok_or(Refused::InvalidRequest)?;
    let head_identity: Vec<u8> = head
        .try_get("head_identity")
        .map_err(|cause| store_error(&cause))?;
    let head_version: i64 = head
        .try_get("head_version")
        .map_err(|cause| store_error(&cause))?;
    let basis: Vec<u8> = head
        .try_get("basis_digest")
        .map_err(|cause| store_error(&cause))?;
    let rows = sqlx::query(
        "SELECT version_identity,timeframe_identity,event_ns,kind,correction_sequence,predecessor_version,publication_ns FROM market_data_private.pit_window_cross_section_versions_v1 WHERE chain_root=$1",
    )
    .bind(chain_root.as_bytes().as_slice())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|cause| store_error(&cause))?;
    let versions = rows
        .iter()
        .map(|row| {
            let bytes = |column: &str| -> Result<Vec<u8>, Refused> {
                row.try_get(column).map_err(|cause| store_error(&cause))
            };
            let number = |column: &str| -> Result<u64, Refused> {
                to_u64(row.try_get(column).map_err(|cause| store_error(&cause))?)
            };
            let kind: i16 = row.try_get("kind").map_err(|cause| store_error(&cause))?;
            let predecessor: Option<Vec<u8>> = row
                .try_get("predecessor_version")
                .map_err(|cause| store_error(&cause))?;
            Ok(StoredVersionV1 {
                identity: digest(&bytes("version_identity")?)?,
                timeframe_identity: digest(&bytes("timeframe_identity")?)?,
                event_ns: number("event_ns")?,
                kind: u8::try_from(kind)
                    .ok()
                    .and_then(kind_from_tag)
                    .ok_or(Refused::StoreUnavailable)?,
                correction_sequence: number("correction_sequence")?,
                predecessor: predecessor.as_deref().map(digest).transpose()?,
                publication_ns: number("publication_ns")?,
            })
        })
        .collect::<Result<Vec<_>, Refused>>()?;
    Ok(StoredChainV1 {
        chain_root,
        head_identity: digest(&head_identity)?,
        head_version: to_u64(head_version)?,
        head_basis_digest: digest(&basis)?,
        versions,
    })
}

/// The latest row fact of each series and of each slot the chain holds.
#[derive(Default)]
struct ChainHeadsV1 {
    series: BTreeMap<[u8; 32], SampleFactV2>,
    slots: BTreeMap<[u8; 32], SampleFactV2>,
}

impl ChainHeadsV1 {
    fn advance(&mut self, fact: SampleFactV2) {
        let later_in_series = self.series.get(&fact.series_identity()).is_none_or(|head| {
            (fact.event_effective(), fact.correction_sequence())
                >= (head.event_effective(), head.correction_sequence())
        });

        if later_in_series {
            self.series.insert(fact.series_identity(), fact.clone());
        }
        let later_in_slot = self
            .slots
            .get(&fact.slot_identity())
            .is_none_or(|head| fact.correction_sequence() > head.correction_sequence());

        if later_in_slot {
            self.slots.insert(fact.slot_identity(), fact);
        }
    }
}

async fn load_chain_heads(
    transaction: &mut Transaction<'_, Postgres>,
    chain_root: BindingDigest,
) -> Result<ChainHeadsV1, Refused> {
    let rows = sqlx::query(
        "SELECT fact_bytes,fact_digest FROM market_data_private.pit_window_custody_rows_v1 WHERE chain_root=$1",
    )
    .bind(chain_root.as_bytes().as_slice())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|cause| store_error(&cause))?;
    let mut heads = ChainHeadsV1::default();

    for row in rows {
        let bytes: Vec<u8> = row
            .try_get("fact_bytes")
            .map_err(|cause| store_error(&cause))?;
        let fact_digest: Vec<u8> = row
            .try_get("fact_digest")
            .map_err(|cause| store_error(&cause))?;
        let fact = decode_sample_fact_v2(&bytes, *digest(&fact_digest)?.as_bytes())
            .map_err(|_| Refused::StoreUnavailable)?;
        heads.advance(fact);
    }
    Ok(heads)
}

/// Commits one custody, or rejoins the one already held under its identity.
async fn commit_custody_v1(
    owner: &MarketDataOwnerPostgres,
    request: UntrustedPitWindowCustodyRequestV1,
) -> Result<PitWindowCustodyReceiptV1, Refused> {
    check_request_shape_v1(&request)?;
    // Read committed, as every clock writer runs: each statement sees what was committed before
    // it, so the clock head read after the clock-state lock is the current one.
    let mut transaction = owner
        .pool
        .begin()
        .await
        .map_err(|cause| store_error(&cause))?;

    // 1. The basis the request names.
    let binding = load_binding(&mut transaction, &request.source_binding).await?;
    let membership = load_membership(&mut transaction, &request.universe_selection).await?;

    // 2. The minting cut: the clock-state lock before the head's row lock, as every clock writer
    //    takes them. The next clock is minted only when a row was retrieved after the head, and is
    //    admitted only after every refusal, so a rejoin or a refusal moves no clock.
    lock_clock_state(&mut transaction)
        .await
        .map_err(|cause| store_error(&cause))?;
    let head = load_current_clock_for_update(&mut transaction)
        .await
        .map_err(|cause| store_error(&cause))?
        .ok_or(Refused::StoreUnavailable)?;
    let max_retrieval_ns = request
        .cross_sections
        .iter()
        .flat_map(|version| &version.rows)
        .map(|row| row.retrieval_ns)
        .max()
        .unwrap_or(0);
    let minted = if max_retrieval_ns <= head.decision_cut {
        None
    } else {
        Some(next_owner_clock_admission_v1(Some(&head)).ok_or(Refused::StoreUnavailable)?)
    };
    let cut_clock = minted.as_ref().unwrap_or(&head);
    let minting_cut = cut_clock.decision_cut;

    // 3. The Instrument Master at the minting cut, under the clock lock, and everything derived
    //    from the basis, refused before any write.
    let instruments = load_instruments(&mut transaction, &request, cut_clock).await?;
    let derived = derive_custody_v1(CustodyInputsV1 {
        request: &request,
        binding: binding.as_ref(),
        instruments: &instruments,
        membership: &membership,
    })?;

    // 4. The chain, and a rejoin, before any clock is admitted.
    let (position, chain) = match derived.claimed_chain_root {
        None => {
            let (identity, bytes) = derived.identity_at(ChainPositionV1::ROOT);
            lock_digests(&mut transaction, identity, identity)
                .await
                .map_err(|cause| store_error(&cause))?;

            if let Some(stored) = load_custody(&mut transaction, identity).await? {
                return rejoin(&stored, &bytes, &derived);
            }
            (ChainPositionV1::ROOT, None)
        }
        Some(chain_root) => {
            lock_digests(&mut transaction, chain_root, chain_root)
                .await
                .map_err(|cause| store_error(&cause))?;

            // A successor rejoins the custody it already is, wherever the head has moved since.
            for stored in load_chain_custodies(&mut transaction, chain_root).await? {
                let Some(predecessor) = stored.predecessor else {
                    continue;
                };
                let (identity, bytes) = derived.identity_at(ChainPositionV1 {
                    predecessor: Some(predecessor),
                    chain_root,
                    chain_version: stored.chain_version,
                });

                if identity == stored.identity {
                    return rejoin(&stored, &bytes, &derived);
                }
            }

            // A new successor extends the head.
            let chain = load_chain_for_update(&mut transaction, chain_root).await?;
            derived.check_against_chain(&chain)?;
            (
                ChainPositionV1::successor_of(chain_root, chain.head_identity, chain.head_version)?,
                Some(chain),
            )
        }
    };
    let (identity, canonical_bytes) = derived.identity_at(position);
    let chain_root = derived.claimed_chain_root.unwrap_or(identity);
    lock_digests(&mut transaction, chain_root, identity)
        .await
        .map_err(|cause| store_error(&cause))?;

    if let Some(stored) = load_custody(&mut transaction, identity).await? {
        return rejoin(&stored, &canonical_bytes, &derived);
    }

    // 5. Every instant the minting cut decides, refused before any write.
    let resolved = derived.resolve_at_minting_cut(minting_cut, chain.as_ref())?;
    let mut heads = match &chain {
        Some(chain) => load_chain_heads(&mut transaction, chain.chain_root).await?,
        None => ChainHeadsV1::default(),
    };
    let mut prepared = Vec::with_capacity(derived.versions.len());

    for (version, instants) in derived.versions.iter().zip(&resolved) {
        let mut facts = Vec::with_capacity(version.rows.len());

        for (row, input) in version
            .rows
            .iter()
            .zip(derived.row_inputs(version, *instants))
        {
            let series = series_identity_v2(&input).map_err(|_| Refused::InvalidRequest)?;
            let slot = root_slot_identity_v2(series, input.event_effective);
            let fact = prepare_sample_fact_v2(
                &input,
                SampleHeadsV2 {
                    series: heads.series.get(&series),
                    slot: heads.slots.get(&slot),
                },
            )
            .map_err(|_| Refused::InvalidRequest)?;
            heads.advance(fact.clone());
            facts.push((row, fact));
        }
        prepared.push(facts);
    }

    if let Some(next) = &minted {
        admit_clock(&mut transaction, next)
            .await
            .map_err(|cause| store_error(&cause))?;
    }

    // 6. The minted clock, then the custody, its versions and rows, and the chain head. The record
    //    names the clock its minting cut is an instant of, under its digest.
    let minting_clock = minting_clock_v1(cut_clock);
    let custody_digest = custody_digest_v1(
        identity,
        minting_cut,
        derived.evidence_digest,
        &minting_clock,
    );
    sqlx::query("INSERT INTO market_data_private.pit_window_custodies_v1(custody_identity,custody_digest,chain_root,chain_version,predecessor_identity,minting_cut_ns,rule_digest,basis_digest,canonical_bytes,evidence_digest,minting_clock_identity,minting_clock_epoch,minting_clock_sequence,minting_restart_continuity_digest,minting_uncertainty_bound,minting_skew_bound) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)")
        .bind(identity.as_bytes().as_slice())
        .bind(custody_digest.as_bytes().as_slice())
        .bind(chain_root.as_bytes().as_slice())
        .bind(to_i64(position.chain_version)?)
        .bind(position.predecessor.map(|predecessor| predecessor.as_bytes().to_vec()))
        .bind(to_i64(minting_cut)?)
        .bind(derived.rule_digest.as_bytes().as_slice())
        .bind(derived.basis_digest.as_bytes().as_slice())
        .bind(canonical_bytes.as_slice())
        .bind(derived.evidence_digest.as_bytes().as_slice())
        .bind(minting_clock.identity.as_str())
        .bind(minting_clock.epoch.as_str())
        .bind(to_i64(minting_clock.sequence)?)
        .bind(minting_clock.restart_continuity_digest.as_bytes().as_slice())
        .bind(to_i64(minting_clock.uncertainty_bound)?)
        .bind(to_i64(minting_clock.skew_bound)?)
        .execute(&mut *transaction)
        .await
        .map_err(|cause| store_error(&cause))?;

    for ((version, (availability, publication)), facts) in
        derived.versions.iter().zip(&resolved).zip(&prepared)
    {
        sqlx::query("INSERT INTO market_data_private.pit_window_cross_section_versions_v1(custody_identity,chain_root,version_identity,timeframe_identity,event_ns,kind,correction_sequence,predecessor_version,availability_ns,publication_ns) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
            .bind(identity.as_bytes().as_slice())
            .bind(chain_root.as_bytes().as_slice())
            .bind(version.identity.as_bytes().as_slice())
            .bind(version.timeframe_identity.as_bytes().as_slice())
            .bind(to_i64(version.event_ns)?)
            .bind(i16::from(kind_tag(version.kind)))
            .bind(to_i64(version.correction_sequence)?)
            .bind(version.predecessor.map(|predecessor| predecessor.as_bytes().to_vec()))
            .bind(to_i64(*availability)?)
            .bind(to_i64(*publication)?)
            .execute(&mut *transaction)
            .await
            .map_err(|cause| store_error(&cause))?;

        for (row, fact) in facts {
            sqlx::query("INSERT INTO market_data_private.pit_window_custody_rows_v1(custody_identity,chain_root,sample_identity,fact_digest,version_identity,member_ordinal,field,fact_bytes,retrieval_ns,retrieval_route) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
                .bind(identity.as_bytes().as_slice())
                .bind(chain_root.as_bytes().as_slice())
                .bind(fact.sample_identity().as_slice())
                .bind(fact.fact_digest().as_slice())
                .bind(version.identity.as_bytes().as_slice())
                .bind(i16::from(row.member_ordinal))
                .bind(row.semantic.row_field())
                .bind(fact.canonical_bytes())
                .bind(to_i64(row.retrieval_ns)?)
                .bind(row.retrieval_route.as_str())
                .execute(&mut *transaction)
                .await
                .map_err(|cause| store_error(&cause))?;
        }
    }

    let moved = match &chain {
        None => sqlx::query("INSERT INTO market_data_private.pit_window_custody_heads_v1(chain_root,head_identity,head_version) VALUES($1,$1,1)")
            .bind(identity.as_bytes().as_slice())
            .execute(&mut *transaction)
            .await
            .map_err(|cause| store_error(&cause))?,
        Some(chain) => sqlx::query("UPDATE market_data_private.pit_window_custody_heads_v1 SET head_identity=$2,head_version=$3 WHERE chain_root=$1 AND head_identity=$4 AND head_version=$5")
            .bind(chain_root.as_bytes().as_slice())
            .bind(identity.as_bytes().as_slice())
            .bind(to_i64(position.chain_version)?)
            .bind(chain.head_identity.as_bytes().as_slice())
            .bind(to_i64(chain.head_version)?)
            .execute(&mut *transaction)
            .await
            .map_err(|cause| store_error(&cause))?,
    };

    // The head row was locked when the successor was decided, so exactly that row moves.
    if moved.rows_affected() != 1 {
        return Err(Refused::StoreUnavailable);
    }

    // A root mints its window schedules; a successor restates the root's basis, window and
    // timeframes exactly, so the root's schedules serve its whole chain and it mints none.
    if chain.is_none() {
        let schedules = mint_window_schedules_v1(&derived, identity, chain_root, minting_cut)
            .ok_or(Refused::StoreUnavailable)?;

        for schedule in &schedules {
            insert_window_schedule(&mut transaction, schedule).await?;
        }
    }
    transaction
        .commit()
        .await
        .map_err(|cause| store_error(&cause))?;
    Ok(PitWindowCustodyReceiptV1::from_owner_custody(
        identity,
        custody_digest,
        chain_root,
        position.chain_version,
        derived.rule_digest,
        minting_cut,
    ))
}

/// The Owner clock a custody minted at `clock`'s cut is minted under.
fn minting_clock_v1(clock: &MarketDataClockAdmission) -> CustodyMintingClockV1 {
    CustodyMintingClockV1 {
        identity: clock.clock_identity.clone(),
        epoch: clock.clock_epoch.clone(),
        sequence: clock.monotonic_sequence,
        restart_continuity_digest: clock.restart_continuity_digest,
        uncertainty_bound: clock.uncertainty_bound,
        skew_bound: clock.skew_bound,
    }
}

async fn insert_window_schedule(
    transaction: &mut Transaction<'_, Postgres>,
    schedule: &PitWindowScheduleFactV1,
) -> Result<(), Refused> {
    sqlx::query("INSERT INTO market_data_private.pit_window_schedule_facts_v1(schedule_identity,chain_root,custody_identity,member_ordinal,instrument,timeframe_identity,interval_ns,phase_ns,window_start_ns,window_end_ns_exclusive,im_key,ms_identity,cut_ns,canonical_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)")
        .bind(schedule.identity().as_bytes().as_slice())
        .bind(schedule.chain_root.as_bytes().as_slice())
        .bind(schedule.custody_identity.as_bytes().as_slice())
        .bind(i16::from(schedule.member_ordinal))
        .bind(schedule.instrument.as_str())
        .bind(schedule.timeframe_identity.as_bytes().as_slice())
        .bind(to_i64(schedule.interval_ns)?)
        .bind(to_i64(schedule.phase_ns)?)
        .bind(to_i64(schedule.window_start_ns)?)
        .bind(to_i64(schedule.window_end_ns_exclusive)?)
        .bind(schedule.instrument_master_key.as_bytes().as_slice())
        .bind(schedule.market_semantics_identity.as_bytes().as_slice())
        .bind(to_i64(schedule.cut_ns)?)
        .bind(schedule.canonical_bytes())
        .execute(&mut **transaction)
        .await
        .map_err(|cause| store_error(&cause))?;
    Ok(())
}

/// The window schedules of the chain rooted at `chain_root`, in member order, each verified
/// against its own bytes and stored columns. A successor's readback is its root's: the chain has
/// one set.
pub(in crate::owner) async fn read_pit_window_schedules_v1(
    transaction: &mut Transaction<'_, Postgres>,
    chain_root: BindingDigest,
) -> Result<Vec<PitWindowScheduleFactV1>, Refused> {
    let rows = sqlx::query(
        "SELECT schedule_identity,chain_root,custody_identity,member_ordinal,instrument,timeframe_identity,interval_ns,phase_ns,window_start_ns,window_end_ns_exclusive,im_key,ms_identity,cut_ns,canonical_bytes FROM market_data_private.pit_window_schedule_facts_v1 WHERE chain_root=$1 ORDER BY member_ordinal",
    )
    .bind(chain_root.as_bytes().as_slice())
    .fetch_all(&mut **transaction)
    .await
    .map_err(|cause| store_error(&cause))?;
    rows.iter()
        .map(|row| {
            let bytes = |column: &str| -> Result<Vec<u8>, Refused> {
                row.try_get(column).map_err(|cause| store_error(&cause))
            };
            let number = |column: &str| -> Result<u64, Refused> {
                to_u64(row.try_get(column).map_err(|cause| store_error(&cause))?)
            };
            let fact = decode_window_schedule_v1(
                &bytes("canonical_bytes")?,
                digest(&bytes("schedule_identity")?)?,
            )
            .ok_or(Refused::StoreUnavailable)?;
            let ordinal: i16 = row
                .try_get("member_ordinal")
                .map_err(|cause| store_error(&cause))?;
            let instrument: String = row
                .try_get("instrument")
                .map_err(|cause| store_error(&cause))?;
            let columns_agree = digest(&bytes("chain_root")?)? == fact.chain_root
                && fact.chain_root == chain_root
                && digest(&bytes("custody_identity")?)? == fact.custody_identity
                && i16::from(fact.member_ordinal) == ordinal
                && instrument == fact.instrument
                && digest(&bytes("timeframe_identity")?)? == fact.timeframe_identity
                && number("interval_ns")? == fact.interval_ns
                && number("phase_ns")? == fact.phase_ns
                && number("window_start_ns")? == fact.window_start_ns
                && number("window_end_ns_exclusive")? == fact.window_end_ns_exclusive
                && digest(&bytes("im_key")?)? == fact.instrument_master_key
                && digest(&bytes("ms_identity")?)? == fact.market_semantics_identity
                && number("cut_ns")? == fact.cut_ns;

            if columns_agree {
                Ok(fact)
            } else {
                Err(Refused::StoreUnavailable)
            }
        })
        .collect()
}

/// The durable custody intake. It retains the Owner and exposes no pool, writer or clock.
struct PitWindowCustodyPostgresV1 {
    owner: MarketDataOwnerPostgres,
}

impl Debug for PitWindowCustodyPostgresV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(PitWindowCustodyPostgresV1))
            .finish_non_exhaustive()
    }
}

impl sealed::Sealed for PitWindowCustodyPostgresV1 {}

#[async_trait::async_trait]
impl PitWindowCustodyCommitV1 for PitWindowCustodyPostgresV1 {
    async fn commit_pit_window_custody_v1(
        &self,
        request: UntrustedPitWindowCustodyRequestV1,
    ) -> Result<PitWindowCustodyReceiptV1, Refused> {
        Box::pin(commit_custody_v1(&self.owner, request)).await
    }
}

impl MarketDataOwnerPostgres {
    /// The custody intake over this Owner store, for its own proofs.
    #[cfg(test)]
    pub(super) fn pit_window_custody_commit_v1(&self) -> Arc<dyn PitWindowCustodyCommitV1> {
        Arc::new(PitWindowCustodyPostgresV1 {
            owner: Self {
                pool: self.pool.clone(),
            },
        })
    }
}

/// Opens the sole configured PIT window custody intake.
pub(in crate::owner) async fn pit_window_custody_commit_from_environment_v1()
-> Result<Arc<dyn PitWindowCustodyCommitV1>, Refused> {
    let url = std::env::var(
        crate::owner::instrument_master_v2_postgres::MARKET_DATA_OWNER_DATABASE_URL_ENV,
    )
    .map_err(|_| Refused::StoreUnavailable)?;

    if url.is_empty() || url.trim() != url {
        return Err(Refused::StoreUnavailable);
    }
    let owner = MarketDataOwnerPostgres::connect(&url).await.map_err(|e| {
        crate::owner::storage_diagnostic::refused_by_store(
            "pit_window_custody.environment.connect",
            &e,
        );
        Refused::StoreUnavailable
    })?;
    Ok(Arc::new(PitWindowCustodyPostgresV1 { owner }))
}
