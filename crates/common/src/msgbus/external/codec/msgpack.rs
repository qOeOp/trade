use anyhow::Context;
use bytes::Bytes;
use serde::{Serialize, de::DeserializeOwned};

use super::PayloadCodecError;

pub(super) fn deserialize<T>(payload: &[u8], type_name: &str) -> anyhow::Result<T>
where
    T: DeserializeOwned,
{
    rmp_serde::from_slice(payload).with_context(|| format!("failed to decode MsgPack {type_name}"))
}

pub(super) fn serialize<T>(message: &T, type_name: &str) -> Result<Bytes, PayloadCodecError>
where
    T: Serialize,
{
    rmp_serde::to_vec_named(message)
        .map(Bytes::from)
        .map_err(|e| {
            PayloadCodecError::Failed(format!("MsgPack serialization failed for {type_name}: {e}"))
        })
}
