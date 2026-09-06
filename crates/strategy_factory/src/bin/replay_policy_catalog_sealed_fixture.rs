//! Materializes only the fixed isolated SEALED_ACCEPTANCE signed Catalog inputs.
use std::{fs::OpenOptions, io::Write, path::Path};

use vibe_strategy_factory::replay_policy_catalog_sealed_acceptance_v2::sealed_catalog_fixture_v1;

fn main() -> anyhow::Result<()> {
    if std::env::args_os().len() != 1 {
        anyhow::bail!("fixed Catalog fixture accepts no arguments");
    }

    if std::env::vars_os().any(|(name, _)| name.to_string_lossy().contains("DATABASE")) {
        anyhow::bail!("fixed Catalog fixture must receive no database configuration");
    }
    let output = Path::new("/run/sealed-catalog-fixture");
    if !output.is_dir() || output.read_dir()?.next().is_some() {
        anyhow::bail!("fixed Catalog fixture requires an empty disposable output directory");
    }
    let fixture = sealed_catalog_fixture_v1()?;
    for (name, bytes) in [
        ("request.json", fixture.sealed_request.as_slice()),
        (
            "verifier-public-key.hex",
            fixture.verifier_public_key_hex.as_bytes(),
        ),
        (
            "verifier-identity.txt",
            fixture.verifier_identity.as_bytes(),
        ),
    ] {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(output.join(name))?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    Ok(())
}
