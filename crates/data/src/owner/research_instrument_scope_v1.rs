//! The instrument scope a Research request states.
//!
//! A Research request names the instruments it studies, and neither R&D nor Market Data chooses
//! them. R&D validates the scope and binds its identity into the frozen Research Intent; Market Data
//! evaluates it as the fixed-member selection rule of the Intent's initial PIT request. Both read
//! the same canonical bytes, so this module is the one codec for them: the canonical bytes and the
//! identity are always computed here, never taken from a caller.
//!
//! Canonical bytes: schema `u16LE = 1`, the member count `u8`, then each identity in ascending byte
//! order, each prefixed by its length as `u16LE`. Identity: SHA-256 over
//! `rd.research-instrument-scope.v1\0` followed by those bytes.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::source_binding::BindingDigest;

/// Schema version of the scope's canonical bytes and wire form.
pub const RESEARCH_INSTRUMENT_SCOPE_SCHEMA_V1: u16 = 1;

/// The most instruments one scope may name, matching the member counts the universe vertical
/// admits.
pub const RESEARCH_INSTRUMENT_SCOPE_MAX_MEMBERS_V1: usize = 2;

/// The longest identity a scope may name, in UTF-8 bytes.
pub const RESEARCH_INSTRUMENT_SCOPE_MAX_IDENTITY_BYTES_V1: usize = 1024;

/// The selection-rule prefix of the fixed-member rule, which the scope's canonical bytes follow.
pub const FIXED_MEMBER_SELECTION_RULE_PREFIX_V1: [u8; 3] = [0, 1, 3];

const SCOPE_DOMAIN: &[u8] = b"rd.research-instrument-scope.v1\0";

/// Why a scope was refused.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum ResearchInstrumentScopeErrorV1 {
    /// The scope states a schema this codec does not know.
    #[error("the instrument scope states an unknown schema")]
    UnknownSchema,
    /// The scope names no instrument, or more than the bounded maximum.
    #[error("the instrument scope names no instrument or too many")]
    MemberCount,
    /// The identities repeat or are not in ascending byte order.
    #[error("the instrument scope identities are duplicated or unordered")]
    NotAscending,
    /// An identity is empty, padded, holds a control character, or is too long.
    #[error("an instrument scope identity is not a canonical identity")]
    InvalidIdentity,
    /// The bytes end early, run on, or hold an identity that is not UTF-8.
    #[error("the instrument scope bytes are malformed")]
    Malformed,
    /// The selection rule is not the fixed-member rule.
    #[error("the selection rule is not the fixed-member rule")]
    NotFixedMemberRule,
}

/// The scope as it travels on the wire: `{"schema_version": 1, "identities": [...]}`.
///
/// It is unvalidated; [`ResearchInstrumentScopeV1::from_wire`] is the only way to a scope.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ResearchInstrumentScopeWireV1 {
    /// The scope schema; only [`RESEARCH_INSTRUMENT_SCOPE_SCHEMA_V1`] is admitted.
    pub schema_version: u16,
    /// Canonical Instrument Master identities, ascending by bytes.
    pub identities: Vec<String>,
}

/// A validated instrument scope with its canonical bytes and identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResearchInstrumentScopeV1 {
    identities: Vec<String>,
    canonical_bytes: Vec<u8>,
    identity: BindingDigest,
}

impl ResearchInstrumentScopeV1 {
    /// Validates the wire form.
    ///
    /// # Errors
    ///
    /// Returns the refusal for an unknown schema, and every refusal of [`Self::from_identities`].
    pub fn from_wire(
        wire: ResearchInstrumentScopeWireV1,
    ) -> Result<Self, ResearchInstrumentScopeErrorV1> {
        if wire.schema_version != RESEARCH_INSTRUMENT_SCOPE_SCHEMA_V1 {
            return Err(ResearchInstrumentScopeErrorV1::UnknownSchema);
        }
        Self::from_identities(wire.identities)
    }

    /// Validates `identities` and derives the canonical bytes and identity.
    ///
    /// # Errors
    ///
    /// Returns [`ResearchInstrumentScopeErrorV1::MemberCount`] for no identity or more than
    /// [`RESEARCH_INSTRUMENT_SCOPE_MAX_MEMBERS_V1`], [`ResearchInstrumentScopeErrorV1::InvalidIdentity`]
    /// for an identity that is empty, has leading or trailing whitespace, holds a control
    /// character or exceeds [`RESEARCH_INSTRUMENT_SCOPE_MAX_IDENTITY_BYTES_V1`], and
    /// [`ResearchInstrumentScopeErrorV1::NotAscending`] when the identities repeat or are not in
    /// ascending byte order.
    pub fn from_identities(
        identities: Vec<String>,
    ) -> Result<Self, ResearchInstrumentScopeErrorV1> {
        if identities.is_empty() || identities.len() > RESEARCH_INSTRUMENT_SCOPE_MAX_MEMBERS_V1 {
            return Err(ResearchInstrumentScopeErrorV1::MemberCount);
        }

        for identity in &identities {
            if identity.is_empty()
                || identity.len() > RESEARCH_INSTRUMENT_SCOPE_MAX_IDENTITY_BYTES_V1
                || identity.trim() != identity
                || identity.chars().any(char::is_control)
            {
                return Err(ResearchInstrumentScopeErrorV1::InvalidIdentity);
            }
        }

        // Strictly ascending is both the uniqueness test and the canonical order, so one set of
        // instruments has exactly one scope identity.
        if identities
            .windows(2)
            .any(|pair| pair[0].as_bytes() >= pair[1].as_bytes())
        {
            return Err(ResearchInstrumentScopeErrorV1::NotAscending);
        }

        let canonical_bytes = encode(&identities);
        let identity = digest(&canonical_bytes);
        Ok(Self {
            identities,
            canonical_bytes,
            identity,
        })
    }

    /// Decodes and validates canonical bytes.
    ///
    /// # Errors
    ///
    /// Returns [`ResearchInstrumentScopeErrorV1::UnknownSchema`] for another schema,
    /// [`ResearchInstrumentScopeErrorV1::Malformed`] when the bytes end early, run on past the last
    /// identity, or hold an identity that is not UTF-8, and every refusal of
    /// [`Self::from_identities`].
    pub fn from_canonical_bytes(bytes: &[u8]) -> Result<Self, ResearchInstrumentScopeErrorV1> {
        let mut reader = Reader { rest: bytes };
        let schema = u16::from_le_bytes(reader.take_array()?);
        if schema != RESEARCH_INSTRUMENT_SCOPE_SCHEMA_V1 {
            return Err(ResearchInstrumentScopeErrorV1::UnknownSchema);
        }

        let [count] = reader.take_array()?;
        let mut identities = Vec::with_capacity(usize::from(count));
        for _ in 0..count {
            let length = usize::from(u16::from_le_bytes(reader.take_array()?));
            let identity = std::str::from_utf8(reader.take(length)?)
                .map_err(|_| ResearchInstrumentScopeErrorV1::Malformed)?;
            identities.push(identity.to_owned());
        }

        if !reader.rest.is_empty() {
            return Err(ResearchInstrumentScopeErrorV1::Malformed);
        }

        // Re-validating also re-encodes, and the result equals `bytes` because the encoding is a
        // function of the validated identities alone.
        Self::from_identities(identities)
    }

    /// Decodes the scope a fixed-member selection rule carries.
    ///
    /// # Errors
    ///
    /// Returns [`ResearchInstrumentScopeErrorV1::NotFixedMemberRule`] when `rule` does not start
    /// with [`FIXED_MEMBER_SELECTION_RULE_PREFIX_V1`], and every refusal of
    /// [`Self::from_canonical_bytes`] for the bytes after it.
    pub fn from_fixed_member_selection_rule(
        rule: &[u8],
    ) -> Result<Self, ResearchInstrumentScopeErrorV1> {
        let scope = rule
            .strip_prefix(&FIXED_MEMBER_SELECTION_RULE_PREFIX_V1)
            .ok_or(ResearchInstrumentScopeErrorV1::NotFixedMemberRule)?;
        Self::from_canonical_bytes(scope)
    }

    /// The fixed-member selection rule that selects exactly this scope: the prefix followed by the
    /// canonical bytes. Its rule identity is [`Self::identity`].
    #[must_use]
    pub fn fixed_member_selection_rule_bytes(&self) -> Vec<u8> {
        [
            FIXED_MEMBER_SELECTION_RULE_PREFIX_V1.as_slice(),
            &self.canonical_bytes,
        ]
        .concat()
    }

    /// The wire form of this scope.
    #[must_use]
    pub fn to_wire(&self) -> ResearchInstrumentScopeWireV1 {
        ResearchInstrumentScopeWireV1 {
            schema_version: RESEARCH_INSTRUMENT_SCOPE_SCHEMA_V1,
            identities: self.identities.clone(),
        }
    }

    /// The canonical Instrument Master identities, ascending by bytes.
    #[must_use]
    pub fn identities(&self) -> &[String] {
        &self.identities
    }

    /// The canonical bytes.
    #[must_use]
    pub fn canonical_bytes(&self) -> &[u8] {
        &self.canonical_bytes
    }

    /// SHA-256 over the scope domain and the canonical bytes.
    #[must_use]
    pub const fn identity(&self) -> BindingDigest {
        self.identity
    }
}

fn encode(identities: &[String]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(
        3 + identities
            .iter()
            .map(|identity| 2 + identity.len())
            .sum::<usize>(),
    );
    bytes.extend_from_slice(&RESEARCH_INSTRUMENT_SCOPE_SCHEMA_V1.to_le_bytes());
    // Validation bounds the count by the member maximum and each length by the identity maximum,
    // so neither conversion can fail.
    bytes.push(u8::try_from(identities.len()).expect("the member count is bounded"));
    for identity in identities {
        bytes.extend_from_slice(
            &u16::try_from(identity.len())
                .expect("the identity length is bounded")
                .to_le_bytes(),
        );
        bytes.extend_from_slice(identity.as_bytes());
    }
    bytes
}

fn digest(bytes: &[u8]) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(SCOPE_DOMAIN);
    hasher.update(bytes);
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

struct Reader<'a> {
    rest: &'a [u8],
}

impl<'a> Reader<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8], ResearchInstrumentScopeErrorV1> {
        if self.rest.len() < length {
            return Err(ResearchInstrumentScopeErrorV1::Malformed);
        }
        let (taken, rest) = self.rest.split_at(length);
        self.rest = rest;
        Ok(taken)
    }

    fn take_array<const N: usize>(&mut self) -> Result<[u8; N], ResearchInstrumentScopeErrorV1> {
        self.take(N).map(|taken| {
            let mut array = [0; N];
            array.copy_from_slice(taken);
            array
        })
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn scope(
        identities: &[&str],
    ) -> Result<ResearchInstrumentScopeV1, ResearchInstrumentScopeErrorV1> {
        ResearchInstrumentScopeV1::from_identities(
            identities
                .iter()
                .map(|identity| (*identity).to_owned())
                .collect(),
        )
    }

    fn hex(bytes: &[u8]) -> String {
        use std::fmt::Write as _;

        bytes.iter().fold(String::new(), |mut out, byte| {
            write!(out, "{byte:02x}").expect("writing to a String cannot fail");
            out
        })
    }

    /// The bytes and identity Market Data recomputes from the same scope, pinned so neither side
    /// can drift from the contract alone.
    #[rstest]
    fn one_instrument_has_the_documented_bytes_and_identity() {
        let scope = scope(&["BTCUSDT-PERP.BINANCE"]).expect("one canonical identity is a scope");

        let mut expected = vec![1, 0, 1, 20, 0];
        expected.extend_from_slice(b"BTCUSDT-PERP.BINANCE");
        assert_eq!(scope.canonical_bytes(), expected);

        let mut hasher = Sha256::new();
        hasher.update(b"rd.research-instrument-scope.v1\0");
        hasher.update(&expected);
        let expected_identity: [u8; 32] = hasher.finalize().into();
        assert_eq!(scope.identity().as_bytes(), &expected_identity);
        assert_eq!(
            hex(scope.identity().as_bytes()),
            "95f00796838b19d3d0ce325b01108c187a4d478931f406d2b6b259dd8d44f1c2"
        );
    }

    #[rstest]
    fn two_instruments_encode_in_ascending_order_and_round_trip() {
        let scope = scope(&["BTCUSDT-PERP.BINANCE", "ETHUSDT-PERP.BINANCE"])
            .expect("two ascending identities are a scope");

        assert_eq!(scope.canonical_bytes()[..3], [1, 0, 2]);
        assert_eq!(
            ResearchInstrumentScopeV1::from_canonical_bytes(scope.canonical_bytes()),
            Ok(scope.clone())
        );
        assert_eq!(
            ResearchInstrumentScopeV1::from_wire(scope.to_wire()),
            Ok(scope.clone())
        );

        let rule = scope.fixed_member_selection_rule_bytes();
        assert_eq!(rule[..3], FIXED_MEMBER_SELECTION_RULE_PREFIX_V1);
        assert_eq!(&rule[3..], scope.canonical_bytes());
        assert_eq!(
            ResearchInstrumentScopeV1::from_fixed_member_selection_rule(&rule),
            Ok(scope)
        );
    }

    #[rstest]
    fn the_wire_form_is_the_documented_object() {
        let wire: ResearchInstrumentScopeWireV1 =
            serde_json::from_str(r#"{"schema_version":1,"identities":["BTCUSDT-PERP.BINANCE"]}"#)
                .expect("the documented object deserializes");
        let scope = ResearchInstrumentScopeV1::from_wire(wire).expect("it is a scope");

        assert_eq!(scope.identities(), ["BTCUSDT-PERP.BINANCE"]);
        assert_eq!(
            serde_json::to_string(&scope.to_wire()).expect("the wire form serializes"),
            r#"{"schema_version":1,"identities":["BTCUSDT-PERP.BINANCE"]}"#
        );
        assert!(
            serde_json::from_str::<ResearchInstrumentScopeWireV1>(
                r#"{"schema_version":1,"identities":[],"digest":"x"}"#
            )
            .is_err()
        );
    }

    #[rstest]
    #[case::empty_list(&[], ResearchInstrumentScopeErrorV1::MemberCount)]
    #[case::three(&["A", "B", "C"], ResearchInstrumentScopeErrorV1::MemberCount)]
    #[case::duplicated(&["A", "A"], ResearchInstrumentScopeErrorV1::NotAscending)]
    #[case::unordered(&["B", "A"], ResearchInstrumentScopeErrorV1::NotAscending)]
    #[case::empty_identity(&[""], ResearchInstrumentScopeErrorV1::InvalidIdentity)]
    #[case::leading_space(&[" A"], ResearchInstrumentScopeErrorV1::InvalidIdentity)]
    #[case::trailing_space(&["A "], ResearchInstrumentScopeErrorV1::InvalidIdentity)]
    #[case::control(&["A\u{7}B"], ResearchInstrumentScopeErrorV1::InvalidIdentity)]
    fn a_scope_that_is_not_canonical_is_refused_by_name(
        #[case] identities: &[&str],
        #[case] refusal: ResearchInstrumentScopeErrorV1,
    ) {
        assert_eq!(scope(identities), Err(refusal));
    }

    #[rstest]
    fn an_identity_is_bounded_at_1024_bytes() {
        let longest = "x".repeat(RESEARCH_INSTRUMENT_SCOPE_MAX_IDENTITY_BYTES_V1);
        assert!(scope(&[longest.as_str()]).is_ok());

        let longer = "x".repeat(RESEARCH_INSTRUMENT_SCOPE_MAX_IDENTITY_BYTES_V1 + 1);
        assert_eq!(
            scope(&[longer.as_str()]),
            Err(ResearchInstrumentScopeErrorV1::InvalidIdentity)
        );
    }

    #[rstest]
    fn an_unknown_schema_is_refused_on_the_wire_and_in_bytes() {
        assert_eq!(
            ResearchInstrumentScopeV1::from_wire(ResearchInstrumentScopeWireV1 {
                schema_version: 2,
                identities: vec!["A".to_owned()],
            }),
            Err(ResearchInstrumentScopeErrorV1::UnknownSchema)
        );
        assert_eq!(
            ResearchInstrumentScopeV1::from_canonical_bytes(&[2, 0, 1, 1, 0, b'A']),
            Err(ResearchInstrumentScopeErrorV1::UnknownSchema)
        );
    }

    #[rstest]
    #[case::truncated_count(&[1, 0])]
    #[case::truncated_length(&[1, 0, 1, 1])]
    #[case::truncated_identity(&[1, 0, 1, 2, 0, b'A'])]
    #[case::trailing_byte(&[1, 0, 1, 1, 0, b'A', 0])]
    #[case::not_utf8(&[1, 0, 1, 1, 0, 0xff])]
    fn malformed_bytes_are_refused(#[case] bytes: &[u8]) {
        assert_eq!(
            ResearchInstrumentScopeV1::from_canonical_bytes(bytes),
            Err(ResearchInstrumentScopeErrorV1::Malformed)
        );
    }

    /// Bytes that decode are still validated, so a rule cannot carry a scope the wire would refuse.
    #[rstest]
    fn decoded_bytes_are_validated_like_the_wire() {
        assert_eq!(
            ResearchInstrumentScopeV1::from_canonical_bytes(&[1, 0, 2, 1, 0, b'B', 1, 0, b'A']),
            Err(ResearchInstrumentScopeErrorV1::NotAscending)
        );
        assert_eq!(
            ResearchInstrumentScopeV1::from_canonical_bytes(&[1, 0, 0]),
            Err(ResearchInstrumentScopeErrorV1::MemberCount)
        );
    }

    #[rstest]
    fn another_selection_rule_is_refused() {
        for rule in [&[0, 1, 1][..], &[0, 1, 2, b'B'], &[], &[0, 1]] {
            assert_eq!(
                ResearchInstrumentScopeV1::from_fixed_member_selection_rule(rule),
                Err(ResearchInstrumentScopeErrorV1::NotFixedMemberRule)
            );
        }
    }

    /// Every identity in the vector file the Dashboard's validator is tested against too, so a
    /// rule changed here without the page (or there without here) turns one side red.
    #[rstest]
    fn identity_rules_match_the_shared_vectors() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(
            "../../product/rd-owner-client/fixtures/research_instrument_identity_vectors_v1.json",
        );
        let file: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(&path).expect("the shared instrument identity vectors"),
        )
        .expect("the vectors are JSON");
        let vectors = file["vectors"].as_array().expect("a vector list");
        assert!(
            vectors.len() > 40,
            "the vector list reads as {} entries",
            vectors.len()
        );

        for vector in vectors {
            let name = vector["name"].as_str().expect("a named vector");
            let mut identity = String::new();

            for part in vector["parts"].as_array().expect("identity parts") {
                if let Some(text) = part["text"].as_str() {
                    identity.push_str(text);
                } else {
                    let repeated = part["repeat"].as_str().expect("a repeated character");
                    let times = part["times"].as_u64().expect("a repeat count");
                    identity
                        .push_str(&repeated.repeat(usize::try_from(times).expect("a small count")));
                }
            }
            let admitted = vector["admitted"].as_bool().expect("an expected answer");
            let answer = ResearchInstrumentScopeV1::from_identities(vec![identity]);

            if admitted {
                assert!(
                    answer.is_ok(),
                    "{name}: expected admitted, but R&D answered {answer:?}"
                );
            } else {
                assert_eq!(
                    answer.map(|_| ()),
                    Err(ResearchInstrumentScopeErrorV1::InvalidIdentity),
                    "{name}: expected refused as an invalid identity",
                );
            }
        }
    }
}
