//! `SampleFactV2`: the row fact of a PIT window custody.
//!
//! A V1 sample fact names the snapshot its row came from, and its root slot hashes that snapshot's
//! fact digest, so the same bar retrieved twice sits in two slots and no correction ever advances a
//! correction head. A custody row belongs to a cross-section version instead: V2 replaces the
//! snapshot fields with the version identity and the row's canonical digest, and its root slot
//! hashes only the series and the event-effective instant, so one bar's corrections across
//! retrievals form one chain.
//!
//! V2 also states its own two chains. The series head advances once per event-effective instant,
//! its sequence by one and its event strictly later; a slot's correction head advances by the
//! cross-section's correction sequence, one at a time, each published strictly later. V1 takes a
//! row's series sequence from its correction sequence, which cannot chain the bars of a source that
//! publishes no corrections. V1 bytes are never reinterpreted: V2 has its own domains, and a V1
//! decoder refuses V2 bytes by their schema.

use super::{
    Decoder, Identity, SERIES_ID_DOMAIN, SampleFactUnavailable, nonzero, put_optional_identity,
    put_u16, put_u64, put_var, series_projection_bytes, sha256,
};
use crate::owner::source_binding::BindingDigest;

const FACT_DIGEST_DOMAIN_V2: &[u8] = b"market-data.sample-fact.v2\0";
const SAMPLE_ID_DOMAIN_V2: &[u8] = b"market-data.sample.identity.v2\0";
const SLOT_ID_DOMAIN_V2: &[u8] = b"market-data.sample-slot.identity.v2\0";
const EVENT_ID_DOMAIN_V2: &[u8] = b"market-data.sample-event.identity.v2\0";

/// One custody row, as the custody that holds it states it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SampleRowInputV2 {
    /// The cross-section version the row is a member of.
    pub(crate) cross_section_version: Identity,
    /// The digest of the row's canonical bytes within that version.
    pub(crate) canonical_row_digest: Identity,
    pub(crate) instrument: Vec<u8>,
    /// Channel and data-kind codes, as V1 encodes them.
    pub(crate) channel: u8,
    pub(crate) data_kind: u8,
    pub(crate) field_semantic: Vec<u8>,
    pub(crate) timeframe_identity: Identity,
    pub(crate) value_semantic: Vec<u8>,
    pub(crate) unit: Vec<u8>,
    pub(crate) value_mantissa: i128,
    pub(crate) value_scale: u8,
    pub(crate) event_effective: u64,
    /// The instant the Source Binding's availability rule makes the row visible.
    pub(crate) available: u64,
    /// The instant the row's cross-section version was published.
    pub(crate) publication: u64,
    /// The cross-section version's correction sequence; its first version is 1.
    pub(crate) correction_sequence: u64,
    pub(crate) source_binding_identity: BindingDigest,
    pub(crate) source_binding_lineage_root: BindingDigest,
    pub(crate) source_binding_lineage_version: u64,
    pub(crate) source_frontier_digest: BindingDigest,
    pub(crate) correction_stream: Vec<u8>,
    pub(crate) correction_frontier_digest: BindingDigest,
    pub(crate) instrument_master_digest: BindingDigest,
    pub(crate) market_semantics_identity: BindingDigest,
}

/// Canonical immutable row fact of one PIT window custody.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct SampleFactV2 {
    bytes: Box<[u8]>,
    series_identity: Identity,
    slot_identity: Identity,
    series_predecessor: Identity,
    correction_predecessor: Option<Identity>,
    series_sequence: u64,
    correction_sequence: u64,
    event_effective: u64,
    publication: u64,
    owner_event_identity: [u8; 16],
    fact_digest: Identity,
    sample_identity: Identity,
    /// The row the bytes state, read back from them.
    row: SampleRowInputV2,
}

impl SampleFactV2 {
    /// The row this fact states: the one it was prepared from, or the one its bytes decode to.
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "read by the custody view seal (T0-5 C5)")
    )]
    pub(crate) const fn row(&self) -> &SampleRowInputV2 {
        &self.row
    }

    pub(crate) fn canonical_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub(crate) const fn series_identity(&self) -> Identity {
        self.series_identity
    }

    pub(crate) const fn slot_identity(&self) -> Identity {
        self.slot_identity
    }

    pub(crate) const fn series_predecessor(&self) -> Identity {
        self.series_predecessor
    }

    pub(crate) const fn correction_predecessor(&self) -> Option<Identity> {
        self.correction_predecessor
    }

    pub(crate) const fn series_sequence(&self) -> u64 {
        self.series_sequence
    }

    pub(crate) const fn correction_sequence(&self) -> u64 {
        self.correction_sequence
    }

    pub(crate) const fn event_effective(&self) -> u64 {
        self.event_effective
    }

    pub(crate) const fn owner_event_identity(&self) -> [u8; 16] {
        self.owner_event_identity
    }

    pub(crate) const fn fact_digest(&self) -> Identity {
        self.fact_digest
    }

    pub(crate) const fn sample_identity(&self) -> Identity {
        self.sample_identity
    }
}

/// The heads a new row fact extends: the latest fact of its series, and the latest fact of the
/// slot it lands in when that slot already holds one.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct SampleHeadsV2<'a> {
    pub(crate) series: Option<&'a SampleFactV2>,
    pub(crate) slot: Option<&'a SampleFactV2>,
}

/// The series identity of a row: the V1 derivation, so one series is one series in both schemas.
pub(crate) fn series_identity_v2(
    row: &SampleRowInputV2,
) -> Result<Identity, SampleFactUnavailable> {
    let bytes = series_projection_bytes(
        &row.instrument,
        row.channel,
        row.data_kind,
        &row.field_semantic,
        row.timeframe_identity,
        &row.value_semantic,
        &row.unit,
        row.value_scale,
        row.source_binding_lineage_root,
        &row.correction_stream,
        row.market_semantics_identity,
    )?;
    let identity = sha256(SERIES_ID_DOMAIN, &bytes);
    nonzero(identity)?;
    Ok(identity)
}

/// The root slot of an event-effective instant in a series; it names no snapshot.
pub(crate) fn root_slot_identity_v2(series: Identity, event_effective: u64) -> Identity {
    let mut bytes = Vec::with_capacity(40);
    bytes.extend_from_slice(&series);
    put_u64(&mut bytes, event_effective);
    sha256(SLOT_ID_DOMAIN_V2, &bytes)
}

fn event_identity_v2(row: &SampleRowInputV2) -> Result<[u8; 16], SampleFactUnavailable> {
    let mut bytes = Vec::new();
    put_u16(&mut bytes, 2);
    put_u16(&mut bytes, 0);
    bytes.extend_from_slice(&row.cross_section_version);
    bytes.extend_from_slice(&row.canonical_row_digest);
    put_u64(&mut bytes, row.event_effective);
    put_u64(&mut bytes, row.available);
    put_u64(&mut bytes, row.publication);
    put_u64(&mut bytes, row.correction_sequence);
    put_var(&mut bytes, &row.correction_stream)?;
    let digest = sha256(EVENT_ID_DOMAIN_V2, &bytes);
    let mut identity = [0; 16];
    identity.copy_from_slice(&digest[..16]);

    if identity == [0; 16] {
        return Err(SampleFactUnavailable::ZeroIdentity);
    }
    Ok(identity)
}

/// Prepares the row fact `row` makes on `heads`.
///
/// A slot with no head is a new bar: the row takes the root slot, correction sequence 1, and the
/// next series position, and its event must follow the series head's. A slot with a head is a
/// correction of that bar: the row keeps the bar's series position, and its correction sequence and
/// publication must each follow the slot head's.
pub(crate) fn prepare_sample_fact_v2(
    row: &SampleRowInputV2,
    heads: SampleHeadsV2<'_>,
) -> Result<SampleFactV2, SampleFactUnavailable> {
    nonzero(row.cross_section_version)?;
    nonzero(row.canonical_row_digest)?;
    let series_identity = series_identity_v2(row)?;
    let root_slot = root_slot_identity_v2(series_identity, row.event_effective);
    for head in [heads.series, heads.slot].into_iter().flatten() {
        if head.series_identity != series_identity {
            return Err(SampleFactUnavailable::PredecessorMismatch);
        }
    }

    let (slot_identity, series_predecessor, series_sequence, correction_predecessor) =
        match heads.slot {
            None => {
                if row.correction_sequence != 1 {
                    return Err(SampleFactUnavailable::CorrectionSequenceNotNext);
                }

                if let Some(series) = heads.series
                    && row.event_effective <= series.event_effective
                {
                    return Err(SampleFactUnavailable::EventNotAfterSeriesHead);
                }
                let (predecessor, sequence) = heads.series.map_or(([0; 32], 1), |series| {
                    (series.sample_identity, series.series_sequence + 1)
                });
                (root_slot, predecessor, sequence, None)
            }
            Some(slot) => {
                if slot.slot_identity != root_slot || slot.event_effective != row.event_effective {
                    return Err(SampleFactUnavailable::PredecessorMismatch);
                }

                if row.correction_sequence != slot.correction_sequence + 1 {
                    return Err(SampleFactUnavailable::CorrectionSequenceNotNext);
                }

                if row.publication <= slot.publication {
                    return Err(SampleFactUnavailable::PublicationNotAfterCorrection);
                }
                (
                    slot.slot_identity,
                    slot.series_predecessor,
                    slot.series_sequence,
                    Some(slot.sample_identity),
                )
            }
        };
    let owner_event_identity = event_identity_v2(row)?;

    let mut bytes = Vec::new();
    put_u16(&mut bytes, 2);
    put_u16(&mut bytes, 0);
    bytes.extend_from_slice(&series_identity);
    bytes.extend_from_slice(&slot_identity);
    bytes.extend_from_slice(&series_predecessor);
    put_optional_identity(&mut bytes, correction_predecessor);
    put_u64(&mut bytes, series_sequence);
    put_u64(&mut bytes, row.correction_sequence);
    bytes.extend_from_slice(&row.cross_section_version);
    bytes.extend_from_slice(&row.canonical_row_digest);
    bytes.extend_from_slice(&owner_event_identity);
    put_var(&mut bytes, &row.instrument)?;
    bytes.push(row.channel);
    bytes.push(row.data_kind);
    put_var(&mut bytes, &row.field_semantic)?;
    bytes.extend_from_slice(&row.timeframe_identity);
    put_var(&mut bytes, &row.value_semantic)?;
    put_var(&mut bytes, &row.unit)?;
    put_var(&mut bytes, &row.value_mantissa.to_le_bytes())?;
    bytes.push(row.value_scale);
    put_u64(&mut bytes, row.event_effective);
    put_u64(&mut bytes, row.available);
    put_u64(&mut bytes, row.publication);
    bytes.extend_from_slice(row.source_binding_identity.as_bytes());
    bytes.extend_from_slice(row.source_binding_lineage_root.as_bytes());
    put_u64(&mut bytes, row.source_binding_lineage_version);
    bytes.extend_from_slice(row.source_frontier_digest.as_bytes());
    put_var(&mut bytes, &row.correction_stream)?;
    bytes.extend_from_slice(row.correction_frontier_digest.as_bytes());
    bytes.extend_from_slice(row.instrument_master_digest.as_bytes());
    bytes.extend_from_slice(row.market_semantics_identity.as_bytes());
    let fact_digest = sha256(FACT_DIGEST_DOMAIN_V2, &bytes);
    let sample_identity = sha256(SAMPLE_ID_DOMAIN_V2, &fact_digest);
    nonzero(fact_digest)?;
    nonzero(sample_identity)?;
    Ok(SampleFactV2 {
        bytes: bytes.into_boxed_slice(),
        series_identity,
        slot_identity,
        series_predecessor,
        correction_predecessor,
        series_sequence,
        correction_sequence: row.correction_sequence,
        event_effective: row.event_effective,
        publication: row.publication,
        owner_event_identity,
        fact_digest,
        sample_identity,
        row: row.clone(),
    })
}

/// Decodes stored V2 bytes and verifies them against `expected_fact_digest`.
///
/// The row is re-read from the bytes and its fact prepared again on the chain position the bytes
/// state, so a stored fact whose identities do not follow from its own row is refused.
pub(crate) fn decode_sample_fact_v2(
    bytes: &[u8],
    expected_fact_digest: Identity,
) -> Result<SampleFactV2, SampleFactUnavailable> {
    if sha256(FACT_DIGEST_DOMAIN_V2, bytes) != expected_fact_digest {
        return Err(SampleFactUnavailable::DigestMismatch);
    }
    let mut decoder = Decoder::new(bytes);
    decoder.schema(2)?;
    let series_identity = decoder.identity()?;
    let slot_identity = decoder.identity()?;
    let series_predecessor = decoder.identity()?;
    let correction_predecessor = decoder.optional_identity()?;
    let series_sequence = decoder.u64()?;
    let correction_sequence = decoder.u64()?;
    let cross_section_version = decoder.identity()?;
    let canonical_row_digest = decoder.identity()?;
    let owner_event_identity = decoder.identity16()?;
    let instrument = decoder.var()?.to_vec();
    let channel = decoder.u8()?;
    let data_kind = decoder.u8()?;
    let field_semantic = decoder.var()?.to_vec();
    let timeframe_identity = decoder.identity()?;
    let value_semantic = decoder.var()?.to_vec();
    let unit = decoder.var()?.to_vec();
    let value_mantissa = i128::from_le_bytes(
        decoder
            .var()?
            .try_into()
            .map_err(|_| SampleFactUnavailable::InvalidLength)?,
    );
    let value_scale = decoder.u8()?;
    let event_effective = decoder.u64()?;
    let available = decoder.u64()?;
    let publication = decoder.u64()?;
    let source_binding_identity = BindingDigest::from_untrusted_bytes(decoder.identity()?);
    let source_binding_lineage_root = BindingDigest::from_untrusted_bytes(decoder.identity()?);
    let source_binding_lineage_version = decoder.u64()?;
    let source_frontier_digest = BindingDigest::from_untrusted_bytes(decoder.identity()?);
    let correction_stream = decoder.var()?.to_vec();
    let correction_frontier_digest = BindingDigest::from_untrusted_bytes(decoder.identity()?);
    let instrument_master_digest = BindingDigest::from_untrusted_bytes(decoder.identity()?);
    let market_semantics_identity = BindingDigest::from_untrusted_bytes(decoder.identity()?);
    decoder.end()?;
    let row = SampleRowInputV2 {
        cross_section_version,
        canonical_row_digest,
        instrument,
        channel,
        data_kind,
        field_semantic,
        timeframe_identity,
        value_semantic,
        unit,
        value_mantissa,
        value_scale,
        event_effective,
        available,
        publication,
        correction_sequence,
        source_binding_identity,
        source_binding_lineage_root,
        source_binding_lineage_version,
        source_frontier_digest,
        correction_stream,
        correction_frontier_digest,
        instrument_master_digest,
        market_semantics_identity,
    };
    let series = series_identity_v2(&row)?;
    let expected_slot = root_slot_identity_v2(series, event_effective);
    if series != series_identity
        || slot_identity != expected_slot
        || event_identity_v2(&row)? != owner_event_identity
        || (correction_predecessor.is_none() != (correction_sequence == 1))
        || series_sequence == 0
        || (series_sequence == 1) != (series_predecessor == [0; 32])
    {
        return Err(SampleFactUnavailable::IdentityMismatch);
    }
    let sample_identity = sha256(SAMPLE_ID_DOMAIN_V2, &expected_fact_digest);
    Ok(SampleFactV2 {
        bytes: bytes.into(),
        series_identity,
        slot_identity,
        series_predecessor,
        correction_predecessor,
        series_sequence,
        correction_sequence,
        event_effective,
        publication,
        owner_event_identity,
        fact_digest: expected_fact_digest,
        sample_identity,
        row,
    })
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn d(byte: u8) -> BindingDigest {
        BindingDigest::from_untrusted_bytes([byte; 32])
    }

    fn row(
        event: u64,
        version: u8,
        correction_sequence: u64,
        publication: u64,
    ) -> SampleRowInputV2 {
        SampleRowInputV2 {
            cross_section_version: [version; 32],
            canonical_row_digest: [version.wrapping_add(100); 32],
            instrument: b"BTCUSDT-PERP.BINANCE".to_vec(),
            channel: 1,
            data_kind: 1,
            field_semantic: b"market.bar.close.price.v1".to_vec(),
            timeframe_identity: [7; 32],
            value_semantic: b"strategy-input.fixed-i128-le.v1".to_vec(),
            unit: b"price".to_vec(),
            value_mantissa: 6_500_000,
            value_scale: 2,
            event_effective: event,
            available: event + 1_000,
            publication,
            correction_sequence,
            source_binding_identity: d(11),
            source_binding_lineage_root: d(12),
            source_binding_lineage_version: 1,
            source_frontier_digest: d(13),
            correction_stream: b"correction-stream".to_vec(),
            correction_frontier_digest: d(14),
            instrument_master_digest: d(15),
            market_semantics_identity: d(16),
        }
    }

    #[rstest]
    fn a_new_bar_takes_the_root_slot_and_the_next_series_position() {
        let first = prepare_sample_fact_v2(&row(60, 1, 1, 61), SampleHeadsV2::default()).unwrap();
        assert_eq!(first.series_sequence(), 1);
        assert_eq!(first.series_predecessor(), [0; 32]);
        assert_eq!(first.correction_predecessor(), None);
        assert_eq!(
            first.slot_identity(),
            root_slot_identity_v2(first.series_identity(), 60)
        );
        let second = prepare_sample_fact_v2(
            &row(120, 2, 1, 121),
            SampleHeadsV2 {
                series: Some(&first),
                slot: None,
            },
        )
        .unwrap();
        assert_eq!(second.series_sequence(), 2);
        assert_eq!(second.series_predecessor(), first.sample_identity());
        assert_eq!(
            prepare_sample_fact_v2(
                &row(60, 3, 1, 121),
                SampleHeadsV2 {
                    series: Some(&second),
                    slot: None,
                },
            ),
            Err(SampleFactUnavailable::EventNotAfterSeriesHead)
        );
        assert_eq!(
            prepare_sample_fact_v2(&row(60, 1, 2, 61), SampleHeadsV2::default()),
            Err(SampleFactUnavailable::CorrectionSequenceNotNext)
        );
    }

    /// The same bar in two versions lands in one slot: the slot names no snapshot or version,
    /// so a correction chains onto the bar it corrects.
    #[rstest]
    fn a_correction_keeps_its_bar_slot_and_series_position() {
        let bar = prepare_sample_fact_v2(&row(60, 1, 1, 61), SampleHeadsV2::default()).unwrap();
        let later = prepare_sample_fact_v2(
            &row(120, 2, 1, 121),
            SampleHeadsV2 {
                series: Some(&bar),
                slot: None,
            },
        )
        .unwrap();
        let heads = SampleHeadsV2 {
            series: Some(&later),
            slot: Some(&bar),
        };
        let correction = prepare_sample_fact_v2(&row(60, 3, 2, 200), heads).unwrap();
        assert_eq!(correction.slot_identity(), bar.slot_identity());
        assert_eq!(correction.series_sequence(), bar.series_sequence());
        assert_eq!(correction.series_predecessor(), bar.series_predecessor());
        assert_eq!(
            correction.correction_predecessor(),
            Some(bar.sample_identity())
        );
        assert_ne!(correction.sample_identity(), bar.sample_identity());
        assert_eq!(
            prepare_sample_fact_v2(&row(60, 3, 3, 200), heads),
            Err(SampleFactUnavailable::CorrectionSequenceNotNext)
        );
        assert_eq!(
            prepare_sample_fact_v2(&row(60, 3, 2, 61), heads),
            Err(SampleFactUnavailable::PublicationNotAfterCorrection)
        );
        let mut other_series = row(60, 3, 2, 200);
        other_series.instrument = b"ETHUSDT-PERP.BINANCE".to_vec();
        assert_eq!(
            prepare_sample_fact_v2(&other_series, heads),
            Err(SampleFactUnavailable::PredecessorMismatch)
        );
    }

    #[rstest]
    fn stored_bytes_decode_only_to_the_fact_they_state() {
        let fact = prepare_sample_fact_v2(&row(60, 1, 1, 61), SampleHeadsV2::default()).unwrap();
        assert_eq!(
            decode_sample_fact_v2(fact.canonical_bytes(), fact.fact_digest()),
            Ok(fact.clone())
        );
        let mut tampered = fact.canonical_bytes().to_vec();
        let last = tampered.len() - 1;
        tampered[last] ^= 1;
        assert_eq!(
            decode_sample_fact_v2(&tampered, fact.fact_digest()),
            Err(SampleFactUnavailable::DigestMismatch)
        );
        // Bytes whose slot does not follow from their own row are refused even under their own
        // digest.
        let mut forged = fact.canonical_bytes().to_vec();
        forged[36] ^= 1;
        let forged_digest = sha256(FACT_DIGEST_DOMAIN_V2, &forged);
        assert_eq!(
            decode_sample_fact_v2(&forged, forged_digest),
            Err(SampleFactUnavailable::IdentityMismatch)
        );
    }

    /// A fact read back from its bytes states exactly the row it was prepared from.
    #[rstest]
    fn a_decoded_fact_states_the_row_it_was_prepared_from() {
        let prepared = row(60, 1, 1, 61);
        let fact = prepare_sample_fact_v2(&prepared, SampleHeadsV2::default()).unwrap();
        assert_eq!(fact.row(), &prepared);

        let decoded = decode_sample_fact_v2(fact.canonical_bytes(), fact.fact_digest()).unwrap();
        assert_eq!(decoded.row(), &prepared);
    }

    #[rstest]
    fn v1_and_v2_never_read_each_other() {
        let fact = prepare_sample_fact_v2(&row(60, 1, 1, 61), SampleHeadsV2::default()).unwrap();
        assert!(super::super::decode_fact(fact.canonical_bytes(), fact.fact_digest()).is_err());
    }
}
