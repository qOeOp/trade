//! Per-member values of a target-set vertical, bounded by the member counts the SDK admits.
//!
//! A fixed `[T; 2]` enforced the member count by its type, including when a durable value was
//! deserialized. This type carries the same bound as a checked invariant instead, so a smaller admitted
//! count needs no second representation: construction and deserialization both refuse a length outside
//! `TARGET_SET_MIN_MEMBER_COUNT..=TARGET_SET_MAX_MEMBER_COUNT`, and it serializes exactly as the array did.

use std::{
    fmt::Display,
    ops::{Deref, DerefMut},
};

use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
use strategy_factory_program_sdk::lifecycle_v2::{
    TARGET_SET_MAX_MEMBER_COUNT, TARGET_SET_MIN_MEMBER_COUNT,
};

/// A member count outside the admitted range.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct MemberCountOutOfRange(pub usize);

impl Display for MemberCountOutOfRange {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "target-set member count {} is outside {TARGET_SET_MIN_MEMBER_COUNT}..={TARGET_SET_MAX_MEMBER_COUNT}",
            self.0
        )
    }
}

impl std::error::Error for MemberCountOutOfRange {}

/// Whether `count` is a member count a target set may carry.
pub(crate) const fn is_admitted_member_count(count: usize) -> bool {
    count >= TARGET_SET_MIN_MEMBER_COUNT && count <= TARGET_SET_MAX_MEMBER_COUNT
}

/// One value per target-set member, in member order.
///
/// The type bounds the count only. Member order is the caller's invariant, exactly as it was for
/// the array this replaces: every constructor here builds values in canonical member order, and
/// in-place mutation through `DerefMut` can replace a member but must not reorder them.
#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct BoundedMembers<T>(Vec<T>);

impl<T> BoundedMembers<T> {
    pub(crate) fn new(values: Vec<T>) -> Result<Self, MemberCountOutOfRange> {
        if is_admitted_member_count(values.len()) {
            Ok(Self(values))
        } else {
            Err(MemberCountOutOfRange(values.len()))
        }
    }

    /// Applies `map` to every member, keeping member order. The count cannot change.
    pub(crate) fn map<U>(&self, map: impl FnMut(&T) -> U) -> BoundedMembers<U> {
        BoundedMembers(self.0.iter().map(map).collect())
    }

    /// Applies a fallible `map` to every member, keeping member order.
    pub(crate) fn try_map<U, E>(
        &self,
        map: impl FnMut(&T) -> Result<U, E>,
    ) -> Result<BoundedMembers<U>, E> {
        self.0
            .iter()
            .map(map)
            .collect::<Result<Vec<_>, _>>()
            .map(BoundedMembers)
    }

    pub(crate) fn into_vec(self) -> Vec<T> {
        self.0
    }
}

impl<T, const N: usize> TryFrom<[T; N]> for BoundedMembers<T> {
    type Error = MemberCountOutOfRange;

    fn try_from(values: [T; N]) -> Result<Self, Self::Error> {
        Self::new(values.into())
    }
}

/// Owner readbacks may carry their members as a `Vec`; the count is checked the same way.
impl<T> TryFrom<Vec<T>> for BoundedMembers<T> {
    type Error = MemberCountOutOfRange;

    fn try_from(values: Vec<T>) -> Result<Self, Self::Error> {
        Self::new(values)
    }
}

impl<T> Deref for BoundedMembers<T> {
    type Target = [T];

    fn deref(&self) -> &[T] {
        &self.0
    }
}

impl<T: PartialEq<U>, U, const N: usize> PartialEq<[U; N]> for BoundedMembers<T> {
    fn eq(&self, other: &[U; N]) -> bool {
        self.0[..] == other[..]
    }
}

/// Members may be replaced in place; the count cannot change through a slice.
impl<T> DerefMut for BoundedMembers<T> {
    fn deref_mut(&mut self) -> &mut [T] {
        &mut self.0
    }
}

impl<T> IntoIterator for BoundedMembers<T> {
    type Item = T;
    type IntoIter = std::vec::IntoIter<T>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.into_iter()
    }
}

impl<'a, T> IntoIterator for &'a BoundedMembers<T> {
    type Item = &'a T;
    type IntoIter = std::slice::Iter<'a, T>;

    fn into_iter(self) -> Self::IntoIter {
        self.0.iter()
    }
}

impl<T: Serialize> Serialize for BoundedMembers<T> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(serializer)
    }
}

impl<'de, T: Deserialize<'de>> Deserialize<'de> for BoundedMembers<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::new(Vec::deserialize(deserializer)?).map_err(de::Error::custom)
    }
}

/// Asserts that each named byte string still has the length and SHA-256 recorded for it.
///
/// The member-count widening must not move any two-member byte layout. Each expected value was read
/// by running the same probe on the pre-widening tree `769b50286`, twice, with identical output;
/// a mismatch here means a two-member preimage changed, not that the pin is stale.
#[cfg(test)]
pub(crate) fn assert_two_member_bytes_unchanged(
    actual: &[(&str, &[u8])],
    expected: &[(&str, usize, &str)],
) {
    let actual = actual
        .iter()
        .map(|(name, bytes)| {
            let digest = <sha2::Sha256 as sha2::Digest>::digest(bytes);
            let hex = digest
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            ((*name).to_owned(), bytes.len(), hex)
        })
        .collect::<Vec<_>>();
    let expected = expected
        .iter()
        .map(|(name, len, hex)| ((*name).to_owned(), *len, (*hex).to_owned()))
        .collect::<Vec<_>>();
    assert_eq!(actual, expected);
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    fn construction_and_deserialization_refuse_counts_outside_the_admitted_range() {
        for count in 0..=TARGET_SET_MAX_MEMBER_COUNT + 1 {
            let values = vec![7_u8; count];
            let admitted = is_admitted_member_count(count);
            assert_eq!(
                BoundedMembers::new(values.clone()).is_ok(),
                admitted,
                "count {count}"
            );
            let json = serde_json::to_string(&values).unwrap();
            assert_eq!(
                serde_json::from_str::<BoundedMembers<u8>>(&json).is_ok(),
                admitted,
                "count {count}"
            );
        }
    }

    #[rstest]
    fn an_array_and_a_vec_of_the_same_members_convert_alike() {
        assert_eq!(
            BoundedMembers::try_from([3_u8, 5]),
            BoundedMembers::try_from(vec![3_u8, 5])
        );
        assert_eq!(
            BoundedMembers::try_from(vec![7_u8; TARGET_SET_MAX_MEMBER_COUNT + 1]),
            Err(MemberCountOutOfRange(TARGET_SET_MAX_MEMBER_COUNT + 1))
        );
    }

    #[rstest]
    fn serializes_exactly_as_the_fixed_array_it_replaces() {
        let array = [3_u8, 5];
        let members = BoundedMembers::try_from(array).unwrap();
        assert_eq!(
            serde_json::to_vec(&members).unwrap(),
            serde_json::to_vec(&array).unwrap()
        );
    }
}
