//! Canonical, effect-free Replay execution policy V2 kernel.
//!
//! This module owns only the policy value and its binary grammar. It deliberately does not select a
//! policy, resolve an Owner fact, compose a Replay request, or provide a default.

use sha2::{Digest, Sha256};
use thiserror::Error;
use vibe_backtest_owner_contracts::{
    CanonicalDigestV2, ContentIdentityV2, OpaqueIdentityV2, ReplayWindowV2, VersionedIdentityV2,
};

/// Replay execution policy schema version.
pub const REPLAY_EXECUTION_POLICY_SCHEMA_VERSION_V2: u16 = 2;

/// Identity of the exact schema, canonical grammar, and parser implemented by this module.
pub const REPLAY_EXECUTION_POLICY_GRAMMAR_PARSER_ID_V2: &str =
    "rd.replay-execution-policy.fixed-record-le.v2";

/// Stable descriptor whose digest binds the exact policy grammar and parser contract.
pub const REPLAY_EXECUTION_POLICY_GRAMMAR_PARSER_DESCRIPTOR_V2: &str = concat!(
    "id=rd.replay-execution-policy.fixed-record-le.v2\n",
    "total=canonical input byte length <=16384; cursor addition, u32-to-usize conversion, and ",
    "every declared text length must not overflow; every declared text length must be <=16384 ",
    "and fit in the remaining input\n",
    "header=exact magic bytes 52 50 45 32 (ASCII RPE2),schema:u16le exactly 2,",
    "field_count:u16le exactly 17\n",
    "record=field_tag:u8,wire_kind:u8,value; exactly 17 records\n",
    "wire_kind=1:versioned_identity(text identity,text version);2:u64le;",
    "3:window(u64le start,u64le exclusive_end);4:content_identity(text identity,text digest);",
    "all other wire-kind enum values rejected; each field requires its declared wire kind\n",
    "text=u32le encoded-byte length followed by exactly that many bytes; length counts encoded ",
    "bytes; bytes must be valid UTF-8\n",
    "opaque_identity=UTF-8 encoded-byte length 1..=256; decoded value must equal Rust str::trim; ",
    "the rejected leading/trailing Unicode White_Space scalars are U+0009..U+000D,U+0020,",
    "U+0085,U+00A0,U+1680,U+2000..U+200A,U+2028,U+2029,U+202F,U+205F,U+3000; ",
    "no normalization or other character restriction\n",
    "canonical_digest=exactly 71 ASCII bytes: lowercase algorithm sha256 or blake3, then colon, ",
    "then exactly 64 lowercase hexadecimal bytes [0-9a-f]; all other algorithms, widths, cases, ",
    "or characters rejected\n",
    "window=start_event_ns < end_event_ns_exclusive\n",
    "fields=1:runtime_kernel:v;2:simulator:v;3:cost:v;4:slippage:v;",
    "5:capacity:v;6:runner_operational_profile:v;7:diagnostic_policy:v;",
    "8:deterministic_seed:u64;9:window:window;10:calendar:v;11:session:v;",
    "12:time_zone:v;13:correction_rule:v;14:market_semantics:v;",
    "15:replay_configuration:c;16:corporate_action_cut:c;",
    "17:historical_membership_cut:c\n",
    "field_kinds=v:wire-kind 1 with two opaque_identity values;u64:wire-kind 2;",
    "window:wire-kind 3;c:wire-kind 4 with opaque_identity then canonical_digest\n",
    "constraints=field tags exactly 1..17 in listed order; no maps or lists; unknown, duplicate, ",
    "missing, or reordered fields rejected; trailing bytes rejected; accepting then re-encoding ",
    "must reproduce every input byte exactly\n",
);

/// Independently frozen SHA-256 of the exact grammar/parser descriptor.
pub const REPLAY_EXECUTION_POLICY_GRAMMAR_PARSER_DIGEST_V2: [u8; 32] = [
    115, 95, 189, 134, 43, 39, 33, 97, 136, 227, 16, 45, 162, 186, 0, 134, 81, 189, 82, 202, 128,
    188, 148, 64, 57, 245, 220, 142, 112, 185, 12, 185,
];

const POLICY_MAGIC_V2: [u8; 4] = *b"RPE2";
const POLICY_FIELD_COUNT_V2: u16 = 17;
const MAX_POLICY_CANONICAL_BYTES_V2: usize = 16 * 1024;
const POLICY_DIGEST_DOMAIN_V2: &[u8] = b"rd.replay-execution-policy.v2\0";

/// One frozen row in the canonical policy field order and width table.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ReplayExecutionPolicyFieldV2 {
    /// One-based field tag and canonical ordinal.
    pub tag: u8,
    /// Policy-owned `ReplayRequestDtoV2` choice.
    pub name: &'static str,
    /// Exact canonical value encoding.
    pub width: &'static str,
}

/// Complete canonical order and width table for policy-owned Replay V2 request choices.
pub const REPLAY_EXECUTION_POLICY_FIELDS_V2: [ReplayExecutionPolicyFieldV2; 17] = [
    field(1, "runtime_kernel", "u32 bytes + u32 bytes"),
    field(2, "simulator", "u32 bytes + u32 bytes"),
    field(3, "cost", "u32 bytes + u32 bytes"),
    field(4, "slippage", "u32 bytes + u32 bytes"),
    field(5, "capacity", "u32 bytes + u32 bytes"),
    field(6, "runner_operational_profile", "u32 bytes + u32 bytes"),
    field(7, "diagnostic_policy", "u32 bytes + u32 bytes"),
    field(8, "deterministic_seed", "u64 little-endian"),
    field(9, "window", "u64 little-endian + u64 little-endian"),
    field(10, "calendar", "u32 bytes + u32 bytes"),
    field(11, "session", "u32 bytes + u32 bytes"),
    field(12, "time_zone", "u32 bytes + u32 bytes"),
    field(13, "correction_rule", "u32 bytes + u32 bytes"),
    field(14, "market_semantics", "u32 bytes + u32 bytes"),
    field(15, "replay_configuration", "u32 bytes + u32 bytes"),
    field(16, "corporate_action_cut", "u32 bytes + u32 bytes"),
    field(17, "historical_membership_cut", "u32 bytes + u32 bytes"),
];

const fn field(tag: u8, name: &'static str, width: &'static str) -> ReplayExecutionPolicyFieldV2 {
    ReplayExecutionPolicyFieldV2 { tag, name, width }
}

/// Complete TrialFamily-owned execution choices used by Replay V2 request composition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReplayExecutionPolicyV2 {
    pub runtime_kernel: VersionedIdentityV2,
    pub simulator: VersionedIdentityV2,
    pub cost: VersionedIdentityV2,
    pub slippage: VersionedIdentityV2,
    pub capacity: VersionedIdentityV2,
    pub runner_operational_profile: VersionedIdentityV2,
    pub diagnostic_policy: VersionedIdentityV2,
    pub deterministic_seed: u64,
    pub window: ReplayWindowV2,
    pub calendar: VersionedIdentityV2,
    pub session: VersionedIdentityV2,
    pub time_zone: VersionedIdentityV2,
    pub correction_rule: VersionedIdentityV2,
    pub market_semantics: VersionedIdentityV2,
    pub replay_configuration: ContentIdentityV2,
    pub corporate_action_cut: ContentIdentityV2,
    pub historical_membership_cut: ContentIdentityV2,
}

impl ReplayExecutionPolicyV2 {
    /// Encodes this policy under the exact V2 grammar.
    pub fn canonical_bytes(&self) -> Result<Vec<u8>, ReplayExecutionPolicyErrorV2> {
        validate_window(&self.window)?;

        let mut bytes = Vec::with_capacity(1024);
        bytes.extend_from_slice(&POLICY_MAGIC_V2);
        bytes.extend_from_slice(&REPLAY_EXECUTION_POLICY_SCHEMA_VERSION_V2.to_le_bytes());
        bytes.extend_from_slice(&POLICY_FIELD_COUNT_V2.to_le_bytes());

        encode_versioned(&mut bytes, FieldTagV2::RuntimeKernel, &self.runtime_kernel)?;
        encode_versioned(&mut bytes, FieldTagV2::Simulator, &self.simulator)?;
        encode_versioned(&mut bytes, FieldTagV2::Cost, &self.cost)?;
        encode_versioned(&mut bytes, FieldTagV2::Slippage, &self.slippage)?;
        encode_versioned(&mut bytes, FieldTagV2::Capacity, &self.capacity)?;
        encode_versioned(
            &mut bytes,
            FieldTagV2::RunnerOperationalProfile,
            &self.runner_operational_profile,
        )?;
        encode_versioned(
            &mut bytes,
            FieldTagV2::DiagnosticPolicy,
            &self.diagnostic_policy,
        )?;
        encode_header(&mut bytes, FieldTagV2::DeterministicSeed, WireKindV2::U64);
        bytes.extend_from_slice(&self.deterministic_seed.to_le_bytes());
        encode_header(&mut bytes, FieldTagV2::Window, WireKindV2::Window);
        bytes.extend_from_slice(&self.window.start_event_ns.to_le_bytes());
        bytes.extend_from_slice(&self.window.end_event_ns_exclusive.to_le_bytes());
        encode_versioned(&mut bytes, FieldTagV2::Calendar, &self.calendar)?;
        encode_versioned(&mut bytes, FieldTagV2::Session, &self.session)?;
        encode_versioned(&mut bytes, FieldTagV2::TimeZone, &self.time_zone)?;
        encode_versioned(
            &mut bytes,
            FieldTagV2::CorrectionRule,
            &self.correction_rule,
        )?;
        encode_versioned(
            &mut bytes,
            FieldTagV2::MarketSemantics,
            &self.market_semantics,
        )?;
        encode_content(
            &mut bytes,
            FieldTagV2::ReplayConfiguration,
            &self.replay_configuration,
        )?;
        encode_content(
            &mut bytes,
            FieldTagV2::CorporateActionCut,
            &self.corporate_action_cut,
        )?;
        encode_content(
            &mut bytes,
            FieldTagV2::HistoricalMembershipCut,
            &self.historical_membership_cut,
        )?;

        if bytes.len() > MAX_POLICY_CANONICAL_BYTES_V2 {
            return Err(ReplayExecutionPolicyErrorV2::LengthOverflow);
        }
        Ok(bytes)
    }

    /// Parses only the unique canonical V2 encoding.
    pub fn parse_canonical(bytes: &[u8]) -> Result<Self, ReplayExecutionPolicyErrorV2> {
        if bytes.len() > MAX_POLICY_CANONICAL_BYTES_V2 {
            return Err(ReplayExecutionPolicyErrorV2::LengthOverflow);
        }

        let mut parser = ParserV2::new(bytes);
        if parser.take(4)? != POLICY_MAGIC_V2 {
            return Err(ReplayExecutionPolicyErrorV2::InvalidMagic);
        }
        let schema_version = parser.read_u16()?;
        if schema_version != REPLAY_EXECUTION_POLICY_SCHEMA_VERSION_V2 {
            return Err(ReplayExecutionPolicyErrorV2::UnsupportedSchemaVersion {
                actual: schema_version,
            });
        }
        let field_count = parser.read_u16()?;
        if field_count > POLICY_FIELD_COUNT_V2 {
            return Err(ReplayExecutionPolicyErrorV2::UnknownFieldCount {
                actual: field_count,
            });
        }

        let mut decoded = DecodedPolicyV2::default();
        let mut seen = 0_u32;
        for ordinal in 0..field_count {
            let raw_tag = parser.read_u8()?;
            let tag = FieldTagV2::try_from(raw_tag)
                .map_err(|()| ReplayExecutionPolicyErrorV2::UnknownField { tag: raw_tag })?;
            let bit = 1_u32 << (raw_tag - 1);
            if seen & bit != 0 {
                return Err(ReplayExecutionPolicyErrorV2::DuplicateField { tag: raw_tag });
            }
            seen |= bit;

            let expected = REPLAY_EXECUTION_POLICY_FIELDS_V2[usize::from(ordinal)].tag;
            if raw_tag != expected {
                return Err(ReplayExecutionPolicyErrorV2::NonCanonicalFieldOrder {
                    expected,
                    actual: raw_tag,
                });
            }

            let raw_kind = parser.read_u8()?;
            let kind = WireKindV2::try_from(raw_kind)
                .map_err(|()| ReplayExecutionPolicyErrorV2::InvalidWireKind { actual: raw_kind })?;
            decoded.decode_field(tag, kind, &mut parser)?;
        }

        if field_count != POLICY_FIELD_COUNT_V2 {
            return Err(ReplayExecutionPolicyErrorV2::MissingField {
                tag: field_count.saturating_add(1) as u8,
            });
        }
        if !parser.is_finished() {
            return Err(ReplayExecutionPolicyErrorV2::TrailingBytes);
        }

        let policy = decoded.finish()?;
        validate_window(&policy.window)?;
        if policy.canonical_bytes()?.as_slice() != bytes {
            return Err(ReplayExecutionPolicyErrorV2::NonCanonicalEncoding);
        }
        Ok(policy)
    }

    /// Computes the architecture-defined SHA-256 policy digest.
    pub fn policy_digest(&self) -> Result<[u8; 32], ReplayExecutionPolicyErrorV2> {
        let mut hasher = Sha256::new();
        hasher.update(POLICY_DIGEST_DOMAIN_V2);
        hasher.update(self.canonical_bytes()?);
        Ok(hasher.finalize().into())
    }
}

/// Computes the 32-byte identity digest of the exact grammar/parser descriptor.
#[must_use]
pub fn replay_execution_policy_grammar_parser_digest_v2() -> [u8; 32] {
    Sha256::digest(REPLAY_EXECUTION_POLICY_GRAMMAR_PARSER_DESCRIPTOR_V2.as_bytes()).into()
}

/// Strict canonical policy codec failures.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ReplayExecutionPolicyErrorV2 {
    #[error("Replay execution policy magic is invalid")]
    InvalidMagic,
    #[error("unsupported Replay execution policy schema version {actual}")]
    UnsupportedSchemaVersion { actual: u16 },
    #[error("Replay execution policy declares unsupported field count {actual}")]
    UnknownFieldCount { actual: u16 },
    #[error("Replay execution policy contains unknown field tag {tag}")]
    UnknownField { tag: u8 },
    #[error("Replay execution policy duplicates field tag {tag}")]
    DuplicateField { tag: u8 },
    #[error(
        "Replay execution policy field order is noncanonical: expected {expected}, got {actual}"
    )]
    NonCanonicalFieldOrder { expected: u8, actual: u8 },
    #[error("Replay execution policy wire-kind enum value {actual} is invalid")]
    InvalidWireKind { actual: u8 },
    #[error("Replay execution policy field {tag} has wire kind {actual}, expected {expected}")]
    UnexpectedWireKind { tag: u8, expected: u8, actual: u8 },
    #[error("Replay execution policy is missing field tag {tag}")]
    MissingField { tag: u8 },
    #[error("Replay execution policy bytes are truncated")]
    Truncated,
    #[error("Replay execution policy length exceeds the canonical bound")]
    LengthOverflow,
    #[error("Replay execution policy text is not valid UTF-8")]
    InvalidUtf8,
    #[error("Replay execution policy field {field} contains an invalid identity or digest")]
    InvalidComponent { field: &'static str },
    #[error("Replay execution policy window start must precede its exclusive end")]
    InvalidReplayWindow,
    #[error("Replay execution policy contains trailing bytes")]
    TrailingBytes,
    #[error("Replay execution policy bytes are not the unique canonical encoding")]
    NonCanonicalEncoding,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
enum WireKindV2 {
    VersionedIdentity = 1,
    U64 = 2,
    Window = 3,
    ContentIdentity = 4,
}

impl TryFrom<u8> for WireKindV2 {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::VersionedIdentity),
            2 => Ok(Self::U64),
            3 => Ok(Self::Window),
            4 => Ok(Self::ContentIdentity),
            _ => Err(()),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
enum FieldTagV2 {
    RuntimeKernel = 1,
    Simulator = 2,
    Cost = 3,
    Slippage = 4,
    Capacity = 5,
    RunnerOperationalProfile = 6,
    DiagnosticPolicy = 7,
    DeterministicSeed = 8,
    Window = 9,
    Calendar = 10,
    Session = 11,
    TimeZone = 12,
    CorrectionRule = 13,
    MarketSemantics = 14,
    ReplayConfiguration = 15,
    CorporateActionCut = 16,
    HistoricalMembershipCut = 17,
}

impl TryFrom<u8> for FieldTagV2 {
    type Error = ();

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::RuntimeKernel),
            2 => Ok(Self::Simulator),
            3 => Ok(Self::Cost),
            4 => Ok(Self::Slippage),
            5 => Ok(Self::Capacity),
            6 => Ok(Self::RunnerOperationalProfile),
            7 => Ok(Self::DiagnosticPolicy),
            8 => Ok(Self::DeterministicSeed),
            9 => Ok(Self::Window),
            10 => Ok(Self::Calendar),
            11 => Ok(Self::Session),
            12 => Ok(Self::TimeZone),
            13 => Ok(Self::CorrectionRule),
            14 => Ok(Self::MarketSemantics),
            15 => Ok(Self::ReplayConfiguration),
            16 => Ok(Self::CorporateActionCut),
            17 => Ok(Self::HistoricalMembershipCut),
            _ => Err(()),
        }
    }
}

fn encode_header(bytes: &mut Vec<u8>, tag: FieldTagV2, kind: WireKindV2) {
    bytes.push(tag as u8);
    bytes.push(kind as u8);
}

fn encode_versioned(
    bytes: &mut Vec<u8>,
    tag: FieldTagV2,
    value: &VersionedIdentityV2,
) -> Result<(), ReplayExecutionPolicyErrorV2> {
    encode_header(bytes, tag, WireKindV2::VersionedIdentity);
    encode_text(bytes, value.identity.as_str())?;
    encode_text(bytes, value.version.as_str())
}

fn encode_content(
    bytes: &mut Vec<u8>,
    tag: FieldTagV2,
    value: &ContentIdentityV2,
) -> Result<(), ReplayExecutionPolicyErrorV2> {
    encode_header(bytes, tag, WireKindV2::ContentIdentity);
    encode_text(bytes, value.identity.as_str())?;
    encode_text(bytes, value.digest.as_str())
}

fn encode_text(bytes: &mut Vec<u8>, value: &str) -> Result<(), ReplayExecutionPolicyErrorV2> {
    let length =
        u32::try_from(value.len()).map_err(|_| ReplayExecutionPolicyErrorV2::LengthOverflow)?;
    bytes.extend_from_slice(&length.to_le_bytes());
    bytes.extend_from_slice(value.as_bytes());
    Ok(())
}

fn validate_window(window: &ReplayWindowV2) -> Result<(), ReplayExecutionPolicyErrorV2> {
    if window.start_event_ns >= window.end_event_ns_exclusive {
        return Err(ReplayExecutionPolicyErrorV2::InvalidReplayWindow);
    }
    Ok(())
}

#[derive(Default)]
struct DecodedPolicyV2 {
    runtime_kernel: Option<VersionedIdentityV2>,
    simulator: Option<VersionedIdentityV2>,
    cost: Option<VersionedIdentityV2>,
    slippage: Option<VersionedIdentityV2>,
    capacity: Option<VersionedIdentityV2>,
    runner_operational_profile: Option<VersionedIdentityV2>,
    diagnostic_policy: Option<VersionedIdentityV2>,
    deterministic_seed: Option<u64>,
    window: Option<ReplayWindowV2>,
    calendar: Option<VersionedIdentityV2>,
    session: Option<VersionedIdentityV2>,
    time_zone: Option<VersionedIdentityV2>,
    correction_rule: Option<VersionedIdentityV2>,
    market_semantics: Option<VersionedIdentityV2>,
    replay_configuration: Option<ContentIdentityV2>,
    corporate_action_cut: Option<ContentIdentityV2>,
    historical_membership_cut: Option<ContentIdentityV2>,
}

impl DecodedPolicyV2 {
    fn decode_field(
        &mut self,
        tag: FieldTagV2,
        kind: WireKindV2,
        parser: &mut ParserV2<'_>,
    ) -> Result<(), ReplayExecutionPolicyErrorV2> {
        match tag {
            FieldTagV2::RuntimeKernel => {
                self.runtime_kernel = Some(parser.read_versioned(tag, kind, "runtime_kernel")?);
            }
            FieldTagV2::Simulator => {
                self.simulator = Some(parser.read_versioned(tag, kind, "simulator")?);
            }
            FieldTagV2::Cost => {
                self.cost = Some(parser.read_versioned(tag, kind, "cost")?);
            }
            FieldTagV2::Slippage => {
                self.slippage = Some(parser.read_versioned(tag, kind, "slippage")?);
            }
            FieldTagV2::Capacity => {
                self.capacity = Some(parser.read_versioned(tag, kind, "capacity")?);
            }
            FieldTagV2::RunnerOperationalProfile => {
                self.runner_operational_profile =
                    Some(parser.read_versioned(tag, kind, "runner_operational_profile")?);
            }
            FieldTagV2::DiagnosticPolicy => {
                self.diagnostic_policy =
                    Some(parser.read_versioned(tag, kind, "diagnostic_policy")?);
            }
            FieldTagV2::DeterministicSeed => {
                parser.require_kind(tag, kind, WireKindV2::U64)?;
                self.deterministic_seed = Some(parser.read_u64()?);
            }
            FieldTagV2::Window => {
                parser.require_kind(tag, kind, WireKindV2::Window)?;
                self.window = Some(ReplayWindowV2 {
                    start_event_ns: parser.read_u64()?,
                    end_event_ns_exclusive: parser.read_u64()?,
                });
            }
            FieldTagV2::Calendar => {
                self.calendar = Some(parser.read_versioned(tag, kind, "calendar")?);
            }
            FieldTagV2::Session => {
                self.session = Some(parser.read_versioned(tag, kind, "session")?);
            }
            FieldTagV2::TimeZone => {
                self.time_zone = Some(parser.read_versioned(tag, kind, "time_zone")?);
            }
            FieldTagV2::CorrectionRule => {
                self.correction_rule = Some(parser.read_versioned(tag, kind, "correction_rule")?);
            }
            FieldTagV2::MarketSemantics => {
                self.market_semantics =
                    Some(parser.read_versioned(tag, kind, "market_semantics")?);
            }
            FieldTagV2::ReplayConfiguration => {
                self.replay_configuration =
                    Some(parser.read_content(tag, kind, "replay_configuration")?);
            }
            FieldTagV2::CorporateActionCut => {
                self.corporate_action_cut =
                    Some(parser.read_content(tag, kind, "corporate_action_cut")?);
            }
            FieldTagV2::HistoricalMembershipCut => {
                self.historical_membership_cut =
                    Some(parser.read_content(tag, kind, "historical_membership_cut")?);
            }
        }
        Ok(())
    }

    fn finish(self) -> Result<ReplayExecutionPolicyV2, ReplayExecutionPolicyErrorV2> {
        Ok(ReplayExecutionPolicyV2 {
            runtime_kernel: required(self.runtime_kernel, FieldTagV2::RuntimeKernel)?,
            simulator: required(self.simulator, FieldTagV2::Simulator)?,
            cost: required(self.cost, FieldTagV2::Cost)?,
            slippage: required(self.slippage, FieldTagV2::Slippage)?,
            capacity: required(self.capacity, FieldTagV2::Capacity)?,
            runner_operational_profile: required(
                self.runner_operational_profile,
                FieldTagV2::RunnerOperationalProfile,
            )?,
            diagnostic_policy: required(self.diagnostic_policy, FieldTagV2::DiagnosticPolicy)?,
            deterministic_seed: required(self.deterministic_seed, FieldTagV2::DeterministicSeed)?,
            window: required(self.window, FieldTagV2::Window)?,
            calendar: required(self.calendar, FieldTagV2::Calendar)?,
            session: required(self.session, FieldTagV2::Session)?,
            time_zone: required(self.time_zone, FieldTagV2::TimeZone)?,
            correction_rule: required(self.correction_rule, FieldTagV2::CorrectionRule)?,
            market_semantics: required(self.market_semantics, FieldTagV2::MarketSemantics)?,
            replay_configuration: required(
                self.replay_configuration,
                FieldTagV2::ReplayConfiguration,
            )?,
            corporate_action_cut: required(
                self.corporate_action_cut,
                FieldTagV2::CorporateActionCut,
            )?,
            historical_membership_cut: required(
                self.historical_membership_cut,
                FieldTagV2::HistoricalMembershipCut,
            )?,
        })
    }
}

fn required<T>(value: Option<T>, tag: FieldTagV2) -> Result<T, ReplayExecutionPolicyErrorV2> {
    value.ok_or(ReplayExecutionPolicyErrorV2::MissingField { tag: tag as u8 })
}

struct ParserV2<'a> {
    bytes: &'a [u8],
    cursor: usize,
}

impl<'a> ParserV2<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, cursor: 0 }
    }

    fn is_finished(&self) -> bool {
        self.cursor == self.bytes.len()
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], ReplayExecutionPolicyErrorV2> {
        let end = self
            .cursor
            .checked_add(length)
            .ok_or(ReplayExecutionPolicyErrorV2::LengthOverflow)?;
        let value = self
            .bytes
            .get(self.cursor..end)
            .ok_or(ReplayExecutionPolicyErrorV2::Truncated)?;
        self.cursor = end;
        Ok(value)
    }

    fn read_u8(&mut self) -> Result<u8, ReplayExecutionPolicyErrorV2> {
        Ok(self.take(1)?[0])
    }

    fn read_u16(&mut self) -> Result<u16, ReplayExecutionPolicyErrorV2> {
        let bytes: [u8; 2] = self
            .take(2)?
            .try_into()
            .map_err(|_| ReplayExecutionPolicyErrorV2::Truncated)?;
        Ok(u16::from_le_bytes(bytes))
    }

    fn read_u32(&mut self) -> Result<u32, ReplayExecutionPolicyErrorV2> {
        let bytes: [u8; 4] = self
            .take(4)?
            .try_into()
            .map_err(|_| ReplayExecutionPolicyErrorV2::Truncated)?;
        Ok(u32::from_le_bytes(bytes))
    }

    fn read_u64(&mut self) -> Result<u64, ReplayExecutionPolicyErrorV2> {
        let bytes: [u8; 8] = self
            .take(8)?
            .try_into()
            .map_err(|_| ReplayExecutionPolicyErrorV2::Truncated)?;
        Ok(u64::from_le_bytes(bytes))
    }

    fn read_text(&mut self) -> Result<String, ReplayExecutionPolicyErrorV2> {
        let length = usize::try_from(self.read_u32()?)
            .map_err(|_| ReplayExecutionPolicyErrorV2::LengthOverflow)?;
        if length > MAX_POLICY_CANONICAL_BYTES_V2 {
            return Err(ReplayExecutionPolicyErrorV2::LengthOverflow);
        }
        let bytes = self.take(length)?;
        let text =
            std::str::from_utf8(bytes).map_err(|_| ReplayExecutionPolicyErrorV2::InvalidUtf8)?;
        Ok(text.to_owned())
    }

    fn read_versioned(
        &mut self,
        tag: FieldTagV2,
        kind: WireKindV2,
        field: &'static str,
    ) -> Result<VersionedIdentityV2, ReplayExecutionPolicyErrorV2> {
        self.require_kind(tag, kind, WireKindV2::VersionedIdentity)?;
        let identity = OpaqueIdentityV2::try_from(self.read_text()?)
            .map_err(|_| ReplayExecutionPolicyErrorV2::InvalidComponent { field })?;
        let version = OpaqueIdentityV2::try_from(self.read_text()?)
            .map_err(|_| ReplayExecutionPolicyErrorV2::InvalidComponent { field })?;
        Ok(VersionedIdentityV2 { identity, version })
    }

    fn read_content(
        &mut self,
        tag: FieldTagV2,
        kind: WireKindV2,
        field: &'static str,
    ) -> Result<ContentIdentityV2, ReplayExecutionPolicyErrorV2> {
        self.require_kind(tag, kind, WireKindV2::ContentIdentity)?;
        let identity = OpaqueIdentityV2::try_from(self.read_text()?)
            .map_err(|_| ReplayExecutionPolicyErrorV2::InvalidComponent { field })?;
        let digest = CanonicalDigestV2::try_from(self.read_text()?)
            .map_err(|_| ReplayExecutionPolicyErrorV2::InvalidComponent { field })?;
        Ok(ContentIdentityV2 { identity, digest })
    }

    fn require_kind(
        &self,
        tag: FieldTagV2,
        actual: WireKindV2,
        expected: WireKindV2,
    ) -> Result<(), ReplayExecutionPolicyErrorV2> {
        if actual != expected {
            return Err(ReplayExecutionPolicyErrorV2::UnexpectedWireKind {
                tag: tag as u8,
                expected: expected as u8,
                actual: actual as u8,
            });
        }
        Ok(())
    }
}
