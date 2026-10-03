//! PIT window custody (slice T0-4a): the custody record, its cross-section versions and row facts,
//! committed once in one read-committed transaction that also mints the Owner clock it needs.
//!
//! The commit follows the Instrument Master V2 snapshot admission:
//!
//! 1. it loads the basis the request names - Source Binding, Universe Selection record, the
//!    members' Instrument Master facts at the clock head - and derives every identity through
//!    [`authority`](crate::owner::pit_window_custody_v1::authority), refusing before any write;
//! 2. it locks the chain and the identity, and returns the stored receipt when the identity is
//!    already held with the same bytes, or refuses it as another meaning, before any clock is
//!    minted;
//! 3. a successor is decided against its chain head;
//! 4. it takes the clock-state lock before the head's row lock, as every clock writer does, mints
//!    the next Owner clock only when a row was retrieved after the head, refuses a row retrieved
//!    after the cut it mints at, and admits that clock in the same transaction;
//! 5. it writes the custody, its versions, their `SampleFactV2` row facts prepared on the chain's
//!    own heads, and the chain head, and commits.
//!
//! Nothing outside this transaction can observe a partial custody: every refusal returns before
//! the commit, and the transaction rolls back when dropped.

use std::{collections::BTreeMap, fmt::Debug, sync::Arc};

use sqlx::{Postgres, Row, Transaction};

use super::{
    MarketDataOwnerPostgres, admit_clock, digest_from_bytes, load_current_clock_for_update,
    load_instrument_facts, load_owner_clock_head_v1, load_source, lock_clock_state, lock_digests,
    next_owner_clock_admission_v1,
    universe_selection::recover_universe_selection_in_transaction_v1,
};
use crate::owner::{
    instrument_master::{
        InstrumentMasterError,
        authority::{ObservationClockV1, select_facts_observed},
    },
    pit_window_custody_v1::{
        PitWindowCustodyCommitV1, PitWindowCustodyReceiptV1, PitWindowCustodyRefusalV1,
        UntrustedPitWindowCustodyRequestV1,
        authority::{
            ChainPositionV1, CustodyBindingV1, CustodyInputsV1, CustodyInstrumentV1,
            CustodyMemberFactV1, CustodyMembershipV1, DerivedCustodyV1, StoredChainV1,
            StoredVersionV1, check_request_shape_v1, custody_digest_v1, derive_custody_v1,
            kind_from_tag, kind_tag,
        },
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
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_window_custodies_v1 (custody_identity BYTEA PRIMARY KEY CHECK (octet_length(custody_identity)=32), custody_digest BYTEA NOT NULL CHECK (octet_length(custody_digest)=32), chain_root BYTEA NOT NULL CHECK (octet_length(chain_root)=32), chain_version BIGINT NOT NULL CHECK (chain_version>0), predecessor_identity BYTEA REFERENCES market_data_private.pit_window_custodies_v1(custody_identity), minting_cut_ns BIGINT NOT NULL CHECK (minting_cut_ns>0), rule_digest BYTEA NOT NULL CHECK (octet_length(rule_digest)=32), basis_digest BYTEA NOT NULL CHECK (octet_length(basis_digest)=32), canonical_bytes BYTEA NOT NULL, evidence_digest BYTEA NOT NULL CHECK (octet_length(evidence_digest)=32), UNIQUE (chain_root, chain_version), CHECK ((chain_version=1)=(predecessor_identity IS NULL)), CHECK ((chain_version=1)=(chain_root=custody_identity)))",
    "REVOKE ALL ON TABLE market_data_private.pit_window_custodies_v1 FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_window_custody_heads_v1 (chain_root BYTEA PRIMARY KEY REFERENCES market_data_private.pit_window_custodies_v1(custody_identity), head_identity BYTEA NOT NULL REFERENCES market_data_private.pit_window_custodies_v1(custody_identity), head_version BIGINT NOT NULL CHECK (head_version>0))",
    "REVOKE ALL ON TABLE market_data_private.pit_window_custody_heads_v1 FROM PUBLIC",
    // A version identity names no custody, so two roots may hold the same version; it is keyed by
    // its custody, and unique within its chain.
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_window_cross_section_versions_v1 (custody_identity BYTEA NOT NULL REFERENCES market_data_private.pit_window_custodies_v1(custody_identity), chain_root BYTEA NOT NULL CHECK (octet_length(chain_root)=32), version_identity BYTEA NOT NULL CHECK (octet_length(version_identity)=32), timeframe_identity BYTEA NOT NULL CHECK (octet_length(timeframe_identity)=32), event_ns BIGINT NOT NULL CHECK (event_ns>=0), kind SMALLINT NOT NULL CHECK (kind IN (1,2,3)), correction_sequence BIGINT NOT NULL CHECK (correction_sequence>0), predecessor_version BYTEA CHECK (octet_length(predecessor_version)=32), availability_ns BIGINT NOT NULL CHECK (availability_ns>=0), publication_ns BIGINT NOT NULL CHECK (publication_ns>=0), PRIMARY KEY (custody_identity, version_identity), UNIQUE (chain_root, version_identity), CHECK ((kind=1)=(predecessor_version IS NULL)))",
    "REVOKE ALL ON TABLE market_data_private.pit_window_cross_section_versions_v1 FROM PUBLIC",
    "CREATE TABLE IF NOT EXISTS market_data_private.pit_window_custody_rows_v1 (custody_identity BYTEA NOT NULL, chain_root BYTEA NOT NULL CHECK (octet_length(chain_root)=32), sample_identity BYTEA NOT NULL CHECK (octet_length(sample_identity)=32), fact_digest BYTEA NOT NULL CHECK (octet_length(fact_digest)=32), version_identity BYTEA NOT NULL, member_ordinal SMALLINT NOT NULL CHECK (member_ordinal>=0), field TEXT NOT NULL, fact_bytes BYTEA NOT NULL, retrieval_ns BIGINT NOT NULL CHECK (retrieval_ns>=0), retrieval_route TEXT NOT NULL CHECK (octet_length(retrieval_route) BETWEEN 1 AND 128), PRIMARY KEY (custody_identity, sample_identity), UNIQUE (chain_root, sample_identity), FOREIGN KEY (custody_identity, version_identity) REFERENCES market_data_private.pit_window_cross_section_versions_v1(custody_identity, version_identity))",
    "REVOKE ALL ON TABLE market_data_private.pit_window_custody_rows_v1 FROM PUBLIC",
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
/// observed at the Owner's clock head.
async fn load_instruments(
    transaction: &mut Transaction<'_, Postgres>,
    request: &UntrustedPitWindowCustodyRequestV1,
) -> Result<Vec<CustodyInstrumentV1>, Refused> {
    let head = load_owner_clock_head_v1(transaction)
        .await
        .map_err(|cause| store_error(&cause))?
        .ok_or(Refused::StoreUnavailable)?;
    let clock = ObservationClockV1::from_owner_head(
        &head.clock_identity,
        &head.clock_epoch,
        head.monotonic_sequence,
    )
    .ok_or(Refused::StoreUnavailable)?;
    let facts = load_instrument_facts(transaction, &request.members, false)
        .await
        .map_err(|cause| store_error(&cause))?;
    let cut = head.decision_cut;
    let select = |member: &String, effective: u64| match select_facts_observed(
        &facts,
        std::slice::from_ref(member),
        i128::from(effective),
        i128::from(cut),
        cut,
        clock,
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
            Ok(CustodyInstrumentV1 {
                at_start: at_start.map(|fact| CustodyMemberFactV1 {
                    fact_digest: fact.digest(),
                    class: fact.instrument_class(),
                    time_zone: fact.time_zone_identity().to_owned(),
                    market_semantics_identity: fact.market_semantics_identity(),
                    effective_until: fact.effective_until(),
                }),
                at_end,
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

    // 1. The basis, and everything derived from it, refused before any write.
    let binding = load_binding(&mut transaction, &request.source_binding).await?;
    let membership = load_membership(&mut transaction, &request.universe_selection).await?;
    let instruments = load_instruments(&mut transaction, &request).await?;
    let derived = derive_custody_v1(CustodyInputsV1 {
        request: &request,
        binding: binding.as_ref(),
        instruments: &instruments,
        membership: &membership,
    })?;

    // 2. The chain, and a rejoin, before any clock is minted.
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

            // 3. A new successor extends the head.
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

    // 4. The clock: the clock-state lock before the head's row lock, as every clock writer.
    lock_clock_state(&mut transaction)
        .await
        .map_err(|cause| store_error(&cause))?;
    let head = load_current_clock_for_update(&mut transaction)
        .await
        .map_err(|cause| store_error(&cause))?
        .ok_or(Refused::StoreUnavailable)?;
    let minted = if derived.max_retrieval_ns <= head.decision_cut {
        None
    } else {
        Some(next_owner_clock_admission_v1(Some(&head)).ok_or(Refused::StoreUnavailable)?)
    };
    let minting_cut = minted
        .as_ref()
        .map_or(head.decision_cut, |next| next.decision_cut);
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

    // 5. The custody, its versions and rows, and the chain head.
    let custody_digest = custody_digest_v1(identity, minting_cut, derived.evidence_digest);
    sqlx::query("INSERT INTO market_data_private.pit_window_custodies_v1(custody_identity,custody_digest,chain_root,chain_version,predecessor_identity,minting_cut_ns,rule_digest,basis_digest,canonical_bytes,evidence_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)")
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

    match &chain {
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
