use anyhow::{Context, bail};
use vibe_strategy_factory::artifact_build_postgres::drain_legacy_prepared_attempts_v1;

const DATABASE_URL_ENV: &str = "LEGACY_PREPARED_ATTEMPT_DRAIN_DATABASE_URL";
const FAULT_ENV: &str = "LEGACY_PREPARED_ATTEMPT_DRAIN_FAIL_AFTER_RECEIPT_COUNT";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let expected_target_count = require_option(&mut args, "--expected-target-count")?
        .parse::<u32>()
        .context("invalid --expected-target-count")?;
    let expected_target_set_digest = require_option(&mut args, "--expected-target-set-sha256")?;
    if args.next().is_some() {
        bail!("unexpected legacy drain argument");
    }
    if expected_target_set_digest.len() != 71
        || !expected_target_set_digest.starts_with("sha256:")
        || !expected_target_set_digest[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        bail!("invalid --expected-target-set-sha256");
    }
    let database_url = std::env::var(DATABASE_URL_ENV)
        .with_context(|| format!("{DATABASE_URL_ENV} must be explicitly set"))?;
    let fail_after_receipt_count = std::env::var(FAULT_ENV)
        .ok()
        .map(|value| value.parse::<u32>().context("invalid drain fault count"))
        .transpose()?;
    let summary = drain_legacy_prepared_attempts_v1(
        &database_url,
        expected_target_count,
        &expected_target_set_digest,
        fail_after_receipt_count,
    )
    .await?;
    println!("{}", serde_json::to_string(&summary)?);
    Ok(())
}

fn require_option(
    args: &mut impl Iterator<Item = String>,
    expected: &str,
) -> anyhow::Result<String> {
    let option = args.next().context("missing legacy drain option")?;
    if option != expected {
        bail!("expected {expected}");
    }
    args.next()
        .with_context(|| format!("missing value for {expected}"))
}
