//! Composition roots for the R&D Owner and Product Edge HTTP APIs.

pub mod dashboard_read_api;

/// Reads a required configuration variable, refusing one that is present but carries no value.
///
/// `std::env::var` returns `Ok("")` for a variable set to the empty string, so reading one
/// directly admits an empty value everywhere it admits a set one. For a database URL that fails
/// later at connect time. For a bearer token it does not fail at all: the process stores the
/// digest of the empty string as its secret, and a request whose header is exactly `Bearer `
/// then authenticates against it. No caller in this crate has a meaning for an empty value, so
/// this refuses one on behalf of all of them, and refuses a whitespace-only value for the same
/// reason.
///
/// The two failures carry different messages because they have different fixes: a variable that
/// is absent was never wired, and a variable that is blank was wired to nothing.
///
/// # Errors
///
/// Returns an error when the variable is absent, is not valid Unicode, or holds only whitespace.
pub fn required_env(name: &str) -> anyhow::Result<String> {
    let value = std::env::var(name)
        .map_err(|_| anyhow::anyhow!("required environment variable {name} is missing"))?;
    if value.trim().is_empty() {
        anyhow::bail!("required environment variable {name} is set but carries no value");
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::required_env;

    /// Positive control. Without it, every assertion below is satisfied by a `required_env` that
    /// refuses everything, and the refusals would carry no information.
    #[rstest]
    fn a_variable_with_a_value_is_returned_unchanged() {
        let name = "VIBE_RD_OWNER_API_REQUIRED_ENV_PRESENT";
        unsafe { std::env::set_var(name, " spaced value ") };
        assert_eq!(required_env(name).unwrap(), " spaced value ");
        unsafe { std::env::remove_var(name) };
    }

    #[rstest]
    fn an_absent_variable_is_refused_as_missing() {
        let name = "VIBE_RD_OWNER_API_REQUIRED_ENV_ABSENT";
        unsafe { std::env::remove_var(name) };
        let error = required_env(name).unwrap_err().to_string();
        assert!(error.contains("is missing"), "{error}");
    }

    /// The defect this function exists for: an empty token digests to a value a request can
    /// present, so an empty variable must not reach a caller at all.
    #[rstest]
    fn an_empty_variable_is_refused_rather_than_returned() {
        let name = "VIBE_RD_OWNER_API_REQUIRED_ENV_EMPTY";
        unsafe { std::env::set_var(name, "") };
        let error = required_env(name).unwrap_err().to_string();
        assert!(error.contains("carries no value"), "{error}");
        unsafe { std::env::remove_var(name) };
    }

    #[rstest]
    fn a_whitespace_only_variable_is_refused_rather_than_returned() {
        let name = "VIBE_RD_OWNER_API_REQUIRED_ENV_BLANK";
        unsafe { std::env::set_var(name, "   ") };
        let error = required_env(name).unwrap_err().to_string();
        assert!(error.contains("carries no value"), "{error}");
        unsafe { std::env::remove_var(name) };
    }
}
