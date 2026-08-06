use anyhow::Context;
use bytes::Bytes;
use serde::{Serialize, de::DeserializeOwned};

use super::PayloadCodecError;

pub(super) fn deserialize<T>(payload: &[u8], type_name: &str) -> anyhow::Result<T>
where
    T: DeserializeOwned,
{
    serde_json::from_slice(payload).with_context(|| format!("failed to decode JSON {type_name}"))
}

pub(super) fn serialize<T>(message: &T, type_name: &str) -> Result<Bytes, PayloadCodecError>
where
    T: Serialize,
{
    serde_json::to_vec(message).map(Bytes::from).map_err(|e| {
        PayloadCodecError::Failed(format!("JSON serialization failed for {type_name}: {e}"))
    })
}
