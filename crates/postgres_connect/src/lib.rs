//! The one way this workspace opens a PostgreSQL connection: every connection states how it treats
//! TLS.
//!
//! sqlx falls back to `PgSslMode::Prefer` whenever nothing sets a mode, and a URL without `sslmode=`
//! falls back the same way. Built without a TLS backend, as this workspace is today, `Prefer` is
//! plaintext. Built with one, `Prefer` negotiates TLS whenever the server offers it and accepts any
//! certificate, and nothing reports the change. So no connection may rely on the default.
//!
//! Two things hold that in place. `clippy.toml` refuses every sqlx entry point that opens a pool, a
//! connection or a listener anywhere but here. And everything here that opens one takes a URL with
//! a [`PostgresTls`], or [`StatedConnectOptions`], which only [`connect_options`] and [`with_tls`]
//! make: options parsed or built elsewhere, whatever they carry, reach no connection until they
//! state their TLS. A mode the URL carries is overridden by the stated one, and so is `PGSSLMODE`.

// This crate is the one place those entry points are allowed.
#![allow(
    clippy::disallowed_methods,
    reason = "the workspace's only sanctioned PostgreSQL connection helper"
)]

use sqlx::{
    ConnectOptions, PgConnection, PgPool,
    postgres::{PgConnectOptions, PgPoolOptions, PgSslMode},
};

/// How one PostgreSQL connection treats TLS. There is no default and never will be one.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[non_exhaustive]
pub enum PostgresTls {
    /// Plaintext. Today no TLS backend is compiled into the workspace, so every connection is
    /// plaintext; this says so where it happens. A connection that needs verified TLS gets its own
    /// variant when the backend is compiled in; it never falls back to this one or to a default.
    Disabled,
}

impl PostgresTls {
    const fn ssl_mode(self) -> PgSslMode {
        match self {
            Self::Disabled => PgSslMode::Disable,
        }
    }
}

/// Connection options that have stated their TLS. Only [`connect_options`] and [`with_tls`] make
/// one, and nothing here connects over anything else.
#[derive(Clone, Debug)]
pub struct StatedConnectOptions(PgConnectOptions);

/// Parses `url` into connection options with `tls` stated.
///
/// # Errors
///
/// Returns an error when `url` does not parse as connection options.
pub fn connect_options(url: &str, tls: PostgresTls) -> Result<StatedConnectOptions, sqlx::Error> {
    Ok(with_tls(url.parse::<PgConnectOptions>()?, tls))
}

/// States `tls` on options built field by field.
#[must_use]
pub fn with_tls(options: PgConnectOptions, tls: PostgresTls) -> StatedConnectOptions {
    StatedConnectOptions(options.ssl_mode(tls.ssl_mode()))
}

/// Pool settings that open their pool only with a stated TLS: the sanctioned replacement for
/// `PgPoolOptions::connect` and `PgPoolOptions::connect_lazy`, which fall back to `Prefer`.
pub trait PgPoolOptionsExt {
    /// Opens the pool to `url` with `tls` stated.
    fn connect_url(
        self,
        url: &str,
        tls: PostgresTls,
    ) -> impl Future<Output = Result<PgPool, sqlx::Error>> + Send;

    /// A pool to `url` that connects on first use, with `tls` stated.
    ///
    /// # Errors
    ///
    /// Returns an error when `url` does not parse as connection options.
    fn connect_lazy_url(self, url: &str, tls: PostgresTls) -> Result<PgPool, sqlx::Error>;

    /// Opens the pool over options that have stated their TLS.
    fn connect_stated(
        self,
        options: StatedConnectOptions,
    ) -> impl Future<Output = Result<PgPool, sqlx::Error>> + Send;
}

impl PgPoolOptionsExt for PgPoolOptions {
    // Parsed inside the future, as sqlx's own `connect` does: options held across the await beside
    // the pool's own copy would make every caller's future larger.
    async fn connect_url(self, url: &str, tls: PostgresTls) -> Result<PgPool, sqlx::Error> {
        self.connect_with(connect_options(url, tls)?.0).await
    }

    fn connect_lazy_url(self, url: &str, tls: PostgresTls) -> Result<PgPool, sqlx::Error> {
        Ok(self.connect_lazy_with(connect_options(url, tls)?.0))
    }

    fn connect_stated(
        self,
        options: StatedConnectOptions,
    ) -> impl Future<Output = Result<PgPool, sqlx::Error>> + Send {
        self.connect_with(options.0)
    }
}

/// Opens one connection to `url` with `tls` stated.
///
/// # Errors
///
/// Returns an error when `url` does not parse as connection options or the connection fails.
pub async fn connect(url: &str, tls: PostgresTls) -> Result<PgConnection, sqlx::Error> {
    connect_with(&connect_options(url, tls)?).await
}

/// Opens one connection over options that have stated their TLS.
///
/// # Errors
///
/// Returns an error when the connection fails.
pub async fn connect_with(options: &StatedConnectOptions) -> Result<PgConnection, sqlx::Error> {
    options.0.connect().await
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    #[case::bare("postgres://reader:secret@127.0.0.1:5432/store")]
    #[case::url_says_prefer("postgres://reader:secret@127.0.0.1:5432/store?sslmode=prefer")]
    #[case::url_says_require("postgres://reader:secret@127.0.0.1:5432/store?sslmode=require")]
    fn the_stated_tls_is_the_one_the_options_carry(#[case] url: &str) {
        let options = connect_options(url, PostgresTls::Disabled).unwrap();

        assert!(matches!(options.0.get_ssl_mode(), PgSslMode::Disable));
    }

    #[rstest]
    fn options_built_elsewhere_carry_the_stated_tls() {
        let built = PgConnectOptions::new_without_pgpass().ssl_mode(PgSslMode::Prefer);

        assert!(matches!(
            with_tls(built, PostgresTls::Disabled).0.get_ssl_mode(),
            PgSslMode::Disable
        ));
    }

    #[rstest]
    fn a_url_that_does_not_parse_makes_no_options() {
        assert!(
            connect_options(
                "postgres://reader@127.0.0.1:port/store",
                PostgresTls::Disabled
            )
            .is_err()
        );
    }
}
