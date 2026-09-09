//! Canonical typed wire codec for one Strategy Factory V2 plugin invocation.

use sha2::{Digest, Sha256};
use strategy_factory_program_sdk::lifecycle_v1;
use thiserror::Error;
use vibe_data::owner::source_binding::BindingDigest;

use crate::strategy_design_v2::{PluginManifestV2, PortContractV2, ValueTypeV2};

pub const PLUGIN_FRAME_HEADER_BYTES_V2: usize = 96;
pub const PLUGIN_FRAME_CODEC_V2: u16 = 2;
pub const PLUGIN_FRAME_ABI_V2: u16 = 2;
pub const PLUGIN_FRAME_ABI_V3: u16 = 3;
pub const PLUGIN_STATE_ORDINAL_V2: u16 = u16::MAX;
const ENTRY_HEADER_BYTES: usize = 8;
const INPUT_MAGIC: [u8; 4] = *b"SFPI";
const OUTPUT_MAGIC: [u8; 4] = *b"SFPO";
const PLUGIN_STATE_SET_DOMAIN: &[u8] = b"strategy.plugin.state-set.v2\0";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PluginFrameKindV2 {
    Input,
    Output,
}

impl PluginFrameKindV2 {
    const fn magic(self) -> [u8; 4] {
        match self {
            Self::Input => INPUT_MAGIC,
            Self::Output => OUTPUT_MAGIC,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PluginOutputAvailabilityV3 {
    Ready,
    Warming,
}

impl PluginOutputAvailabilityV3 {
    const fn tag(self) -> u8 {
        match self {
            Self::Ready => 0,
            Self::Warming => 1,
        }
    }

    const fn from_tag(tag: u8) -> Option<Self> {
        match tag {
            0 => Some(Self::Ready),
            1 => Some(Self::Warming),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TypedValueV2 {
    value_type: ValueTypeV2,
    bytes: Box<[u8]>,
}

impl TypedValueV2 {
    pub fn new(
        value_type: ValueTypeV2,
        bytes: impl Into<Box<[u8]>>,
    ) -> Result<Self, PluginWireV2Error> {
        let value = Self {
            value_type,
            bytes: bytes.into(),
        };
        validate_value(&value)?;
        Ok(value)
    }

    pub const fn value_type(&self) -> ValueTypeV2 {
        self.value_type
    }
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }
    pub fn i32(value: i32) -> Self {
        Self {
            value_type: ValueTypeV2::I32,
            bytes: value.to_le_bytes().into(),
        }
    }
    pub fn i64(value: i64) -> Self {
        Self {
            value_type: ValueTypeV2::I64,
            bytes: value.to_le_bytes().into(),
        }
    }
    pub fn u64(value: u64) -> Self {
        Self {
            value_type: ValueTypeV2::U64,
            bytes: value.to_le_bytes().into(),
        }
    }
    pub fn i128(value: i128) -> Self {
        Self {
            value_type: ValueTypeV2::I128,
            bytes: value.to_le_bytes().into(),
        }
    }
    pub fn digest(value: BindingDigest) -> Self {
        Self {
            value_type: ValueTypeV2::Digest32,
            bytes: (*value.as_bytes()).into(),
        }
    }
    pub fn stable_identity(value: [u8; 16]) -> Self {
        Self {
            value_type: ValueTypeV2::StableIdentity16,
            bytes: value.into(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PluginFrameV2 {
    pub kind: PluginFrameKindV2,
    pub output_availability: Option<PluginOutputAvailabilityV3>,
    pub manifest_digest: BindingDigest,
    pub module_identity: BindingDigest,
    pub invocation_identity: [u8; 16],
    pub values: Vec<TypedValueV2>,
    pub state: TypedValueV2,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum PluginWireV2Error {
    #[error("plugin frame has an invalid canonical header or length")]
    Header,
    #[error("plugin frame entry order or coverage does not match the manifest")]
    Coverage,
    #[error("plugin frame contains an invalid typed value")]
    Value,
    #[error("plugin frame entry exceeds its manifest byte bound")]
    Bound,
    #[error("plugin frame is not its unique canonical encoding")]
    NonCanonical,
}

impl PluginFrameV2 {
    pub fn encode(&self, manifest: &PluginManifestV2) -> Result<Vec<u8>, PluginWireV2Error> {
        let ports = ports(self.kind, manifest);
        if !supported_frame_abi(manifest.abi_version)
            || !valid_output_availability(manifest.abi_version, self.kind, self.output_availability)
            || self.values.len() != ports.len()
            || self.state.value_type != manifest.state.value_type
            || self.state.bytes.len() > manifest.state.max_bytes as usize
            || self.invocation_identity == [0; 16]
        {
            return Err(PluginWireV2Error::Coverage);
        }
        let mut body = Vec::new();
        if let Some(availability) = self.output_availability {
            body.push(availability.tag());
        }

        for (ordinal, (value, contract)) in self.values.iter().zip(ports).enumerate() {
            if value.value_type != contract.value_type
                || value.bytes.len() > contract.max_bytes as usize
            {
                return Err(PluginWireV2Error::Bound);
            }
            push_entry(&mut body, ordinal as u16, value)?;
        }
        push_entry(&mut body, PLUGIN_STATE_ORDINAL_V2, &self.state)?;
        let count = u16::try_from(self.values.len() + 1).map_err(|_| PluginWireV2Error::Header)?;
        let body_len = u32::try_from(body.len()).map_err(|_| PluginWireV2Error::Header)?;
        let mut output = vec![0; PLUGIN_FRAME_HEADER_BYTES_V2];
        output[..4].copy_from_slice(&self.kind.magic());
        output[4..6].copy_from_slice(&PLUGIN_FRAME_CODEC_V2.to_le_bytes());
        output[6..8].copy_from_slice(&manifest.abi_version.to_le_bytes());
        output[8..40].copy_from_slice(self.manifest_digest.as_bytes());
        output[40..72].copy_from_slice(self.module_identity.as_bytes());
        output[72..88].copy_from_slice(&self.invocation_identity);
        output[88..90].copy_from_slice(&count.to_le_bytes());
        output[92..96].copy_from_slice(&body_len.to_le_bytes());
        output.extend(body);
        Ok(output)
    }

    pub fn decode_exact(
        bytes: &[u8],
        kind: PluginFrameKindV2,
        manifest: &PluginManifestV2,
        manifest_digest: BindingDigest,
        module_identity: BindingDigest,
        invocation_identity: [u8; 16],
    ) -> Result<Self, PluginWireV2Error> {
        if bytes.len() < PLUGIN_FRAME_HEADER_BYTES_V2
            || !supported_frame_abi(manifest.abi_version)
            || bytes[..4] != kind.magic()
            || read_u16(bytes, 4)? != PLUGIN_FRAME_CODEC_V2
            || read_u16(bytes, 6)? != manifest.abi_version
            || bytes[8..40] != *manifest_digest.as_bytes()
            || bytes[40..72] != *module_identity.as_bytes()
            || bytes[72..88] != invocation_identity
            || bytes[90..92] != [0; 2]
        {
            return Err(PluginWireV2Error::Header);
        }
        let ports = ports(kind, manifest);
        if usize::from(read_u16(bytes, 88)?) != ports.len() + 1 {
            return Err(PluginWireV2Error::Coverage);
        }
        let body_len =
            usize::try_from(read_u32(bytes, 92)?).map_err(|_| PluginWireV2Error::Header)?;
        if PLUGIN_FRAME_HEADER_BYTES_V2.checked_add(body_len) != Some(bytes.len()) {
            return Err(PluginWireV2Error::Header);
        }
        let mut cursor = PLUGIN_FRAME_HEADER_BYTES_V2;
        let output_availability =
            if manifest.abi_version == PLUGIN_FRAME_ABI_V3 && kind == PluginFrameKindV2::Output {
                let tag = *bytes.get(cursor).ok_or(PluginWireV2Error::Header)?;
                cursor += 1;
                Some(PluginOutputAvailabilityV3::from_tag(tag).ok_or(PluginWireV2Error::Header)?)
            } else {
                None
            };
        let mut values = Vec::with_capacity(ports.len());
        for (ordinal, contract) in ports.iter().enumerate() {
            let (found_ordinal, value, next) = decode_entry(bytes, cursor)?;
            if found_ordinal != ordinal as u16 || value.value_type != contract.value_type {
                return Err(PluginWireV2Error::Coverage);
            }

            if value.bytes.len() > contract.max_bytes as usize {
                return Err(PluginWireV2Error::Bound);
            }
            values.push(value);
            cursor = next;
        }
        let (ordinal, state, next) = decode_entry(bytes, cursor)?;
        if ordinal != PLUGIN_STATE_ORDINAL_V2
            || state.value_type != manifest.state.value_type
            || state.bytes.len() > manifest.state.max_bytes as usize
            || next != bytes.len()
        {
            return Err(PluginWireV2Error::Coverage);
        }
        let frame = Self {
            kind,
            output_availability,
            manifest_digest,
            module_identity,
            invocation_identity,
            values,
            state,
        };

        if frame.encode(manifest)?.as_slice() != bytes {
            return Err(PluginWireV2Error::NonCanonical);
        }
        Ok(frame)
    }
}

const fn supported_frame_abi(abi_version: u16) -> bool {
    matches!(abi_version, PLUGIN_FRAME_ABI_V2 | PLUGIN_FRAME_ABI_V3)
}

const fn valid_output_availability(
    abi_version: u16,
    kind: PluginFrameKindV2,
    availability: Option<PluginOutputAvailabilityV3>,
) -> bool {
    matches!(
        (abi_version, kind, availability),
        (PLUGIN_FRAME_ABI_V3, PluginFrameKindV2::Output, Some(_))
            | (PLUGIN_FRAME_ABI_V2, _, None)
            | (PLUGIN_FRAME_ABI_V3, PluginFrameKindV2::Input, None)
    )
}

pub fn aggregate_plugin_state_set_digest_v2<'a>(
    states: impl IntoIterator<Item = (&'a str, BindingDigest, &'a [u8])>,
) -> BindingDigest {
    let mut hasher = Sha256::new();
    hasher.update(PLUGIN_STATE_SET_DOMAIN);
    for (semantic_id, module_identity, state) in states {
        hasher.update((semantic_id.len() as u32).to_le_bytes());
        hasher.update(semantic_id.as_bytes());
        hasher.update(module_identity.as_bytes());
        hasher.update((state.len() as u32).to_le_bytes());
        hasher.update(state);
    }
    BindingDigest::from_untrusted_bytes(hasher.finalize().into())
}

fn ports(kind: PluginFrameKindV2, manifest: &PluginManifestV2) -> &[PortContractV2] {
    match kind {
        PluginFrameKindV2::Input => &manifest.input_ports,
        PluginFrameKindV2::Output => &manifest.output_ports,
    }
}

fn push_entry(
    output: &mut Vec<u8>,
    ordinal: u16,
    value: &TypedValueV2,
) -> Result<(), PluginWireV2Error> {
    validate_value(value)?;
    output.extend(ordinal.to_le_bytes());
    output.push(type_tag(value.value_type));
    output.push(0);
    output.extend(
        u32::try_from(value.bytes.len())
            .map_err(|_| PluginWireV2Error::Value)?
            .to_le_bytes(),
    );
    output.extend(&value.bytes);
    Ok(())
}

fn decode_entry(
    bytes: &[u8],
    offset: usize,
) -> Result<(u16, TypedValueV2, usize), PluginWireV2Error> {
    let header = bytes
        .get(offset..offset + ENTRY_HEADER_BYTES)
        .ok_or(PluginWireV2Error::Coverage)?;
    if header[3] != 0 {
        return Err(PluginWireV2Error::NonCanonical);
    }
    let len = usize::try_from(read_u32(header, 4)?).map_err(|_| PluginWireV2Error::Value)?;
    let end = offset
        .checked_add(ENTRY_HEADER_BYTES)
        .and_then(|v| v.checked_add(len))
        .ok_or(PluginWireV2Error::Value)?;
    let payload = bytes
        .get(offset + ENTRY_HEADER_BYTES..end)
        .ok_or(PluginWireV2Error::Coverage)?;
    let value_type = decode_type_tag(header[2]).ok_or(PluginWireV2Error::Value)?;
    let value = TypedValueV2::new(value_type, payload)?;
    Ok((read_u16(header, 0)?, value, end))
}

fn validate_value(value: &TypedValueV2) -> Result<(), PluginWireV2Error> {
    let len = value.bytes.len();
    let valid = match value.value_type {
        ValueTypeV2::I32 => len == 4,
        ValueTypeV2::I64 | ValueTypeV2::U64 => len == 8,
        ValueTypeV2::I128 | ValueTypeV2::StableIdentity16 => len == 16,
        ValueTypeV2::Digest32 => len == 32,
        ValueTypeV2::Bytes => true,
        ValueTypeV2::PositionIntentV1
        | ValueTypeV2::TargetVariantV1
        | ValueTypeV2::ProtectionVariantV1 => {
            !value.bytes.is_empty()
                && core::str::from_utf8(&value.bytes).is_ok()
                && !value.bytes.contains(&0)
                && closed_semantic_is_supported(value.value_type, &value.bytes)
        }
    };
    valid.then_some(()).ok_or(PluginWireV2Error::Value)
}

fn closed_semantic_is_supported(value_type: ValueTypeV2, bytes: &[u8]) -> bool {
    let Ok(semantic_id) = core::str::from_utf8(bytes) else {
        return false;
    };

    match value_type {
        ValueTypeV2::PositionIntentV1 => [
            lifecycle_v1::HOLD_SEMANTIC_ID,
            lifecycle_v1::ENTER_SEMANTIC_ID,
            lifecycle_v1::ADD_SEMANTIC_ID,
            lifecycle_v1::REDUCE_SEMANTIC_ID,
            lifecycle_v1::EXIT_SEMANTIC_ID,
        ]
        .contains(&semantic_id),
        ValueTypeV2::TargetVariantV1 => [
            "kernel.target.keep.v1",
            lifecycle_v1::TARGET_POSITION_SEMANTIC_ID,
            lifecycle_v1::TARGET_WEIGHT_SEMANTIC_ID,
            lifecycle_v1::TARGET_REBALANCE_SEMANTIC_ID,
        ]
        .contains(&semantic_id),
        ValueTypeV2::ProtectionVariantV1 => [
            "kernel.protection.keep.v1",
            "kernel.protection.clear.v1",
            "kernel.protection.replace.v1",
            lifecycle_v1::TRAILING_ADJUST_SEMANTIC_ID,
        ]
        .contains(&semantic_id),
        _ => true,
    }
}

const fn type_tag(value: ValueTypeV2) -> u8 {
    match value {
        ValueTypeV2::I32 => 1,
        ValueTypeV2::I64 => 2,
        ValueTypeV2::U64 => 3,
        ValueTypeV2::I128 => 4,
        ValueTypeV2::Bytes => 5,
        ValueTypeV2::Digest32 => 6,
        ValueTypeV2::StableIdentity16 => 7,
        ValueTypeV2::PositionIntentV1 => 8,
        ValueTypeV2::TargetVariantV1 => 9,
        ValueTypeV2::ProtectionVariantV1 => 10,
    }
}
const fn decode_type_tag(value: u8) -> Option<ValueTypeV2> {
    match value {
        1 => Some(ValueTypeV2::I32),
        2 => Some(ValueTypeV2::I64),
        3 => Some(ValueTypeV2::U64),
        4 => Some(ValueTypeV2::I128),
        5 => Some(ValueTypeV2::Bytes),
        6 => Some(ValueTypeV2::Digest32),
        7 => Some(ValueTypeV2::StableIdentity16),
        8 => Some(ValueTypeV2::PositionIntentV1),
        9 => Some(ValueTypeV2::TargetVariantV1),
        10 => Some(ValueTypeV2::ProtectionVariantV1),
        _ => None,
    }
}
fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, PluginWireV2Error> {
    Ok(u16::from_le_bytes(
        bytes
            .get(offset..offset + 2)
            .and_then(|v| v.try_into().ok())
            .ok_or(PluginWireV2Error::Header)?,
    ))
}
fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, PluginWireV2Error> {
    Ok(u32::from_le_bytes(
        bytes
            .get(offset..offset + 4)
            .and_then(|v| v.try_into().ok())
            .ok_or(PluginWireV2Error::Header)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        bounded_feature_program_v1::BOUNDED_FEATURE_NUMERIC_FAILURE_V1,
        strategy_design_v2::PluginStateContractV2,
    };

    #[test]
    fn abi_three_retains_the_canonical_entry_layout_and_binds_the_header() {
        let manifest = PluginManifestV2 {
            semantic_id: "test.bfp.plugin.v1".to_owned(),
            abi_version: PLUGIN_FRAME_ABI_V3,
            input_ports: Vec::new(),
            output_ports: Vec::new(),
            state: PluginStateContractV2 {
                pre_port_id: "state.pre".to_owned(),
                post_port_id: "state.post".to_owned(),
                value_type: ValueTypeV2::Bytes,
                max_bytes: 8,
            },
            capability_ids: Vec::new(),
            max_fuel: 1,
            max_linear_memory_bytes: 65_536,
            max_invocations_per_event: 1,
            failure_semantic_id: BOUNDED_FEATURE_NUMERIC_FAILURE_V1.to_owned(),
        };
        let manifest_digest = BindingDigest::from_untrusted_bytes([1; 32]);
        let module_identity = BindingDigest::from_untrusted_bytes([2; 32]);
        let invocation_identity = [3; 16];
        let frame = PluginFrameV2 {
            kind: PluginFrameKindV2::Input,
            output_availability: None,
            manifest_digest,
            module_identity,
            invocation_identity,
            values: Vec::new(),
            state: TypedValueV2::new(ValueTypeV2::Bytes, []).expect("empty state is canonical"),
        };

        let bytes = frame.encode(&manifest).expect("ABI 3 frame");
        assert_eq!(&bytes[6..8], &PLUGIN_FRAME_ABI_V3.to_le_bytes());
        assert_eq!(
            PluginFrameV2::decode_exact(
                &bytes,
                PluginFrameKindV2::Input,
                &manifest,
                manifest_digest,
                module_identity,
                invocation_identity,
            ),
            Ok(frame)
        );

        let mut abi_two_header = bytes;
        abi_two_header[6..8].copy_from_slice(&PLUGIN_FRAME_ABI_V2.to_le_bytes());
        assert_eq!(
            PluginFrameV2::decode_exact(
                &abi_two_header,
                PluginFrameKindV2::Input,
                &manifest,
                manifest_digest,
                module_identity,
                invocation_identity,
            ),
            Err(PluginWireV2Error::Header)
        );
    }

    #[test]
    fn abi_three_output_prefixes_entries_with_canonical_availability() {
        let manifest = PluginManifestV2 {
            semantic_id: "test.bfp.plugin.v1".to_owned(),
            abi_version: PLUGIN_FRAME_ABI_V3,
            input_ports: Vec::new(),
            output_ports: Vec::new(),
            state: PluginStateContractV2 {
                pre_port_id: "state.pre".to_owned(),
                post_port_id: "state.post".to_owned(),
                value_type: ValueTypeV2::Bytes,
                max_bytes: 8,
            },
            capability_ids: Vec::new(),
            max_fuel: 1,
            max_linear_memory_bytes: 65_536,
            max_invocations_per_event: 1,
            failure_semantic_id: BOUNDED_FEATURE_NUMERIC_FAILURE_V1.to_owned(),
        };
        let manifest_digest = BindingDigest::from_untrusted_bytes([1; 32]);
        let module_identity = BindingDigest::from_untrusted_bytes([2; 32]);
        let invocation_identity = [3; 16];
        let frame = PluginFrameV2 {
            kind: PluginFrameKindV2::Output,
            output_availability: Some(PluginOutputAvailabilityV3::Warming),
            manifest_digest,
            module_identity,
            invocation_identity,
            values: Vec::new(),
            state: TypedValueV2::new(ValueTypeV2::Bytes, []).expect("empty state is canonical"),
        };

        let bytes = frame.encode(&manifest).expect("ABI 3 output frame");
        assert_eq!(bytes[PLUGIN_FRAME_HEADER_BYTES_V2], 1);
        assert_eq!(read_u16(&bytes, 88), Ok(1));
        assert_eq!(
            read_u32(&bytes, 92),
            Ok(u32::try_from(bytes.len() - PLUGIN_FRAME_HEADER_BYTES_V2)
                .expect("test frame length fits u32"))
        );
        assert_eq!(
            read_u16(&bytes, PLUGIN_FRAME_HEADER_BYTES_V2 + 1),
            Ok(PLUGIN_STATE_ORDINAL_V2)
        );
        assert_eq!(
            PluginFrameV2::decode_exact(
                &bytes,
                PluginFrameKindV2::Output,
                &manifest,
                manifest_digest,
                module_identity,
                invocation_identity,
            ),
            Ok(frame.clone())
        );

        let ready = PluginFrameV2 {
            output_availability: Some(PluginOutputAvailabilityV3::Ready),
            ..frame.clone()
        };
        assert_eq!(
            ready.encode(&manifest).expect("READY output frame")[PLUGIN_FRAME_HEADER_BYTES_V2],
            0
        );

        let mut unknown = bytes;
        unknown[PLUGIN_FRAME_HEADER_BYTES_V2] = 2;
        assert_eq!(
            PluginFrameV2::decode_exact(
                &unknown,
                PluginFrameKindV2::Output,
                &manifest,
                manifest_digest,
                module_identity,
                invocation_identity,
            ),
            Err(PluginWireV2Error::Header)
        );

        let missing = PluginFrameV2 {
            output_availability: None,
            ..frame.clone()
        };
        assert_eq!(missing.encode(&manifest), Err(PluginWireV2Error::Coverage));

        let contradictory = PluginFrameV2 {
            kind: PluginFrameKindV2::Input,
            ..frame
        };
        assert_eq!(
            contradictory.encode(&manifest),
            Err(PluginWireV2Error::Coverage)
        );
    }
}
