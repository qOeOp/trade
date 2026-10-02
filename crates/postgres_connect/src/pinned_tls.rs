//! One PostgreSQL connection over TLS that trusts exactly one pinned root.
//!
//! sqlx cannot show which certificate a session's server presented, and its verified modes trust
//! the public web PKI beside any root they are given. So [`connect_pinned`] does not ask sqlx for
//! TLS. It opens the TCP connection itself, sends PostgreSQL's `SSLRequest`, and completes a TLS 1.3
//! handshake that trusts only the pinned root. It then hands sqlx a private Unix socket, and a task
//! carries that one session's bytes over the pinned connection. The certificate it records is the
//! one the session's own server presented, and no other root can stand in for the pinned one.
//!
//! sqlx's own leg states plaintext, because it ends inside this process. The bridge between the two
//! is itself a surface, and three things hold it shut:
//!
//! - **One socket, for one session, briefly.** The socket is made in a directory only this
//!   process's user can enter (mode 0700) and only once the pinned handshake has completed. The
//!   relay accepts exactly one connection, then removes the listener and the directory; if no
//!   session ever arrives, dropping the relay removes them.
//! - **Only this process.** The relay asks the kernel which process connected and carries nothing
//!   for any other: a same-user process that wins the race to the socket gets the connection
//!   closed, and the session it displaced fails rather than travel any other way.
//! - **Nothing before the server is the right one.** A failed handshake, a server certificate under
//!   another root, or one other than the certificate the caller expects ends the attempt before the
//!   socket exists, so no byte of the session, its startup message or its password exchange
//!   included, is ever written to that server.
//!
//! Like every connection here, this one sets no deadline of its own.

use std::{fmt::Debug, sync::Arc};

use rustls::{
    ClientConfig, RootCertStore,
    crypto::{CryptoProvider, aws_lc_rs},
    pki_types::{CertificateDer, ServerName, pem::SectionKind},
};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, postgres::PgConnectOptions};
use thiserror::Error;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpStream, UnixListener},
};
use tokio_rustls::{TlsConnector, client::TlsStream};

use crate::{PostgresTls, connect_with, with_tls};

/// PostgreSQL's `SSLRequest`: length 8, then the request code 80877103.
const SSL_REQUEST: [u8; 8] = [0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f];

/// The one protocol this connection offers, in the name `pg_stat_ssl` reports it by.
pub const PINNED_TLS_PROTOCOL: &str = "TLSv1.3";

/// The one cipher suite this connection offers, in the name `pg_stat_ssl` reports it by. Offering
/// one protocol and one suite keeps what the server negotiates, and so what a binding of it names,
/// a constant.
pub const PINNED_TLS_CIPHER: &str = "TLS_AES_256_GCM_SHA384";

/// Why a pinned connection was not made. Carries no secret.
#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum PinnedTlsError {
    /// The PEM is not exactly one certificate a root store accepts.
    #[error("the pinned root is not exactly one acceptable certificate")]
    InvalidRoot,
    /// The host is neither a DNS name nor an IP address.
    #[error("the host is not a TLS server name")]
    InvalidServerName,
    /// The server could not be reached.
    #[error("the PostgreSQL server is unreachable")]
    Unreachable,
    /// The server refused TLS, or no TLS 1.3 handshake under the pinned root completed.
    #[error("no TLS session under the pinned root")]
    TlsRefused,
    /// The private socket sqlx connects to could not be made.
    #[error("the local socket for the session is unavailable")]
    LocalSocket,
    /// The server presented a certificate under the pinned root, but not the one expected.
    #[error("the server presented another certificate than the one expected")]
    UnexpectedPeer,
    /// A process other than this one connected to the session's socket.
    #[error("another process connected to the session's socket")]
    ForeignPeer,
    /// sqlx could not open its session over the pinned connection.
    #[error("the PostgreSQL session over the pinned connection is unavailable")]
    Session,
}

/// The one root a pinned connection trusts, and the client configuration that trusts only it.
#[derive(Clone)]
pub struct PinnedPostgresRoot {
    trust_policy_identity: String,
    config: Arc<ClientConfig>,
}

impl Debug for PinnedPostgresRoot {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct(stringify!(PinnedPostgresRoot))
            .field("trust_policy_identity", &self.trust_policy_identity)
            .finish_non_exhaustive()
    }
}

impl PinnedPostgresRoot {
    /// Pins the root a PEM file holds. The file must hold exactly one section, a certificate.
    ///
    /// # Errors
    ///
    /// Returns [`PinnedTlsError::InvalidRoot`] for anything else, or a certificate no root store
    /// accepts.
    pub fn from_pem(pem: &[u8]) -> Result<Self, PinnedTlsError> {
        let mut reader = pem;
        let mut sections = Vec::new();

        while let Some(section) = rustls::pki_types::pem::from_buf(&mut reader)
            .map_err(|_| PinnedTlsError::InvalidRoot)?
        {
            sections.push(section);
        }
        let [(SectionKind::Certificate, der)] = sections.as_slice() else {
            return Err(PinnedTlsError::InvalidRoot);
        };
        let mut roots = RootCertStore::empty();
        roots
            .add(CertificateDer::from(der.clone()))
            .map_err(|_| PinnedTlsError::InvalidRoot)?;
        let provider = CryptoProvider {
            cipher_suites: vec![aws_lc_rs::cipher_suite::TLS13_AES_256_GCM_SHA384],
            ..aws_lc_rs::default_provider()
        };
        let config = ClientConfig::builder_with_provider(Arc::new(provider))
            .with_protocol_versions(&[&rustls::version::TLS13])
            .map_err(|_| PinnedTlsError::InvalidRoot)?
            .with_root_certificates(roots)
            .with_no_client_auth();

        Ok(Self {
            trust_policy_identity: format!("pinned-root-exclusive-v1:{}", sha256_identity(der)),
            config: Arc::new(config),
        })
    }

    /// The identity of the pinned root: `pinned-root-exclusive-v1:sha256:<hex>` of its DER.
    #[must_use]
    pub fn trust_policy_identity(&self) -> &str {
        &self.trust_policy_identity
    }
}

/// What the pinned handshake observed of its own server.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ObservedPinnedTls {
    /// `sha256:<hex>` of the leaf certificate the server presented.
    pub peer_certificate_identity: String,
    /// Always [`PINNED_TLS_PROTOCOL`].
    pub protocol: &'static str,
    /// Always [`PINNED_TLS_CIPHER`].
    pub cipher: &'static str,
}

/// The task carrying one pinned session. Dropping it aborts the relay, so hold it at least as long
/// as the connection it carries.
#[derive(Debug)]
pub struct PinnedRelay(tokio::task::JoinHandle<Result<(), PinnedTlsError>>);

impl Drop for PinnedRelay {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Opens one sqlx session to `host:port` over TLS that trusts only `root`.
///
/// `options` names the role, password, database and application; this sets where it connects and
/// how. With `expected_peer`, the server must also present exactly that certificate
/// (`sha256:<hex>` of its DER, as [`ObservedPinnedTls`] names it). Returns the session, what the
/// handshake observed, and the relay that carries it.
///
/// # Errors
///
/// Returns a [`PinnedTlsError`] naming the step that failed.
pub async fn connect_pinned(
    host: &str,
    port: u16,
    options: PgConnectOptions,
    root: &PinnedPostgresRoot,
    expected_peer: Option<&str>,
) -> Result<(PgConnection, ObservedPinnedTls, PinnedRelay), PinnedTlsError> {
    let bridge = Bridge::open(host, port, root, expected_peer).await?;
    let options = with_tls(
        options.socket(bridge.socket_directory.path()).port(port),
        PostgresTls::Disabled,
    );
    let observed = bridge.observed.clone();

    let relay = bridge.spawn();
    let connection = connect_with(&options)
        .await
        .map_err(|_| PinnedTlsError::Session)?;

    Ok((connection, observed, relay))
}

/// The pinned connection and the socket it will carry one session from, before any session.
struct Bridge {
    socket_directory: tempfile::TempDir,
    listener: UnixListener,
    tls: TlsStream<TcpStream>,
    observed: ObservedPinnedTls,
}

impl Bridge {
    /// Completes the pinned handshake and checks the server's certificate; only then makes the
    /// socket.
    async fn open(
        host: &str,
        port: u16,
        root: &PinnedPostgresRoot,
        expected_peer: Option<&str>,
    ) -> Result<Self, PinnedTlsError> {
        let server_name =
            ServerName::try_from(host.to_owned()).map_err(|_| PinnedTlsError::InvalidServerName)?;
        let mut tcp = TcpStream::connect((host, port))
            .await
            .map_err(|_| PinnedTlsError::Unreachable)?;
        tcp.write_all(&SSL_REQUEST)
            .await
            .map_err(|_| PinnedTlsError::Unreachable)?;
        // Exactly one byte. Anything the server sends after `S` and before the handshake is read
        // by the TLS layer as a record, and fails it.
        let answer = tcp
            .read_u8()
            .await
            .map_err(|_| PinnedTlsError::Unreachable)?;

        if answer != b'S' {
            return Err(PinnedTlsError::TlsRefused);
        }
        let tls = TlsConnector::from(Arc::clone(&root.config))
            .connect(server_name, tcp)
            .await
            .map_err(|_| PinnedTlsError::TlsRefused)?;
        let observed = observe(tls.get_ref().1)?;

        if expected_peer.is_some_and(|expected| expected != observed.peer_certificate_identity) {
            return Err(PinnedTlsError::UnexpectedPeer);
        }
        let socket_directory =
            private_socket_directory().map_err(|_| PinnedTlsError::LocalSocket)?;
        let listener = UnixListener::bind(socket_directory.path().join(format!(".s.PGSQL.{port}")))
            .map_err(|_| PinnedTlsError::LocalSocket)?;
        Ok(Self {
            socket_directory,
            listener,
            tls,
            observed,
        })
    }

    /// Carries the one session on a task of its own.
    fn spawn(self) -> PinnedRelay {
        PinnedRelay(tokio::spawn(self.carry()))
    }

    /// Accepts the one local session and carries it until either side closes, if this process
    /// opened it.
    async fn carry(self) -> Result<(), PinnedTlsError> {
        let Self {
            socket_directory,
            listener,
            mut tls,
            ..
        } = self;
        let accepted = listener.accept().await;
        // One connection, whoever made it: no second one can reach the socket, and nothing else
        // needs the directory.
        drop(listener);
        drop(socket_directory);
        let (mut local, _) = accepted.map_err(|_| PinnedTlsError::LocalSocket)?;
        let peer = local
            .peer_cred()
            .map_err(|_| PinnedTlsError::ForeignPeer)?
            .pid();

        if peer.is_none() || peer != i32::try_from(std::process::id()).ok() {
            return Err(PinnedTlsError::ForeignPeer);
        }
        tokio::io::copy_bidirectional(&mut local, &mut tls)
            .await
            .map_err(|_| PinnedTlsError::Session)?;
        tls.shutdown().await.map_err(|_| PinnedTlsError::Session)
    }
}

/// A directory only this process's user can enter (mode 0700), for the one socket sqlx is handed.
fn private_socket_directory() -> std::io::Result<tempfile::TempDir> {
    use std::os::unix::fs::PermissionsExt;

    tempfile::Builder::new()
        .prefix("vibe-postgres-pinned-")
        .permissions(std::fs::Permissions::from_mode(0o700))
        .tempdir()
}

fn observe(connection: &rustls::ClientConnection) -> Result<ObservedPinnedTls, PinnedTlsError> {
    let leaf = connection
        .peer_certificates()
        .and_then(<[CertificateDer<'_>]>::first)
        .ok_or(PinnedTlsError::TlsRefused)?;

    if connection.protocol_version() != Some(rustls::ProtocolVersion::TLSv1_3)
        || connection
            .negotiated_cipher_suite()
            .map(|suite| suite.suite())
            != Some(rustls::CipherSuite::TLS13_AES_256_GCM_SHA384)
    {
        return Err(PinnedTlsError::TlsRefused);
    }
    Ok(ObservedPinnedTls {
        peer_certificate_identity: sha256_identity(leaf.as_ref()),
        protocol: PINNED_TLS_PROTOCOL,
        cipher: PINNED_TLS_CIPHER,
    })
}

fn sha256_identity(bytes: &[u8]) -> String {
    use std::fmt::Write;

    let mut identity = String::from("sha256:");

    for byte in Sha256::digest(bytes) {
        let _ = write!(identity, "{byte:02x}");
    }
    identity
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use rcgen::{
        BasicConstraints, CertificateParams, DnType, IsCa, Issuer, KeyPair, KeyUsagePurpose,
    };
    use rstest::rstest;
    use rustls::{ServerConfig, pki_types::PrivateKeyDer};
    use tokio::net::TcpListener;
    use tokio_rustls::TlsAcceptor;

    use super::*;

    struct Authority {
        pem: String,
        issuer: Issuer<'static, KeyPair>,
    }

    fn authority(name: &str) -> Authority {
        let key = KeyPair::generate().unwrap();
        let mut params = CertificateParams::new(Vec::<String>::new()).unwrap();
        params.distinguished_name.push(DnType::CommonName, name);
        params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
        params.key_usages = vec![KeyUsagePurpose::KeyCertSign];
        let certificate = params.self_signed(&key).unwrap();

        Authority {
            pem: certificate.pem(),
            issuer: Issuer::new(params, key),
        }
    }

    /// A server certificate for `127.0.0.1`, issued by `authority`: its DER and key.
    fn server_certificate(
        authority: &Authority,
    ) -> (CertificateDer<'static>, PrivateKeyDer<'static>) {
        let key = KeyPair::generate().unwrap();
        let params = CertificateParams::new(vec!["127.0.0.1".to_string()]).unwrap();
        let certificate = params.signed_by(&key, &authority.issuer).unwrap();

        (
            certificate.der().clone(),
            PrivateKeyDer::try_from(key.serialize_der()).unwrap(),
        )
    }

    #[derive(Clone, Copy)]
    enum Server {
        /// Answers `S`, completes TLS 1.3 and admits the session it carries.
        Tls13,
        /// Answers `N`: no TLS.
        RefusesTls,
        /// Answers `S` but offers only TLS 1.2.
        Tls12Only,
    }

    /// One fake PostgreSQL TLS endpoint on loopback, serving one connection. Behind TLS it reads
    /// the startup message, sends it back on the returned channel, and admits the session with the
    /// least a client needs: authentication, a backend key and ready-for-query.
    async fn serve(
        behaviour: Server,
        certificate: CertificateDer<'static>,
        key: PrivateKeyDer<'static>,
    ) -> (u16, tokio::sync::oneshot::Receiver<Vec<u8>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let (startup_sender, startup_receiver) = tokio::sync::oneshot::channel();
        let versions: &[&rustls::SupportedProtocolVersion] = match behaviour {
            Server::Tls12Only => &[&rustls::version::TLS12],
            Server::Tls13 | Server::RefusesTls => &[&rustls::version::TLS13],
        };
        let config = ServerConfig::builder_with_provider(Arc::new(aws_lc_rs::default_provider()))
            .with_protocol_versions(versions)
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![certificate], key)
            .unwrap();
        tokio::spawn(async move {
            let (mut tcp, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 8];
            tcp.read_exact(&mut request).await.unwrap();
            assert_eq!(request, SSL_REQUEST);

            if matches!(behaviour, Server::RefusesTls) {
                tcp.write_all(b"N").await.unwrap();
                return;
            }
            tcp.write_all(b"S").await.unwrap();
            let Ok(mut tls) = TlsAcceptor::from(Arc::new(config)).accept(tcp).await else {
                return;
            };
            // A client that sends nothing leaves the channel unsent: the test reads that as "no
            // byte of a session reached this server".
            let Ok(length) = tls.read_u32().await else {
                return;
            };
            let mut startup = vec![0_u8; length as usize - 4];

            if tls.read_exact(&mut startup).await.is_err() {
                return;
            }
            startup_sender.send(startup).unwrap();
            // AuthenticationOk, BackendKeyData, ReadyForQuery (idle).
            tls.write_all(&[b'R', 0, 0, 0, 8, 0, 0, 0, 0])
                .await
                .unwrap();
            tls.write_all(&[b'K', 0, 0, 0, 12, 0, 0, 0, 1, 0, 0, 0, 2])
                .await
                .unwrap();
            tls.write_all(&[b'Z', 0, 0, 0, 5, b'I']).await.unwrap();
            let mut rest = Vec::new();
            let _ = tls.read_to_end(&mut rest).await;
        });
        (port, startup_receiver)
    }

    fn options() -> PgConnectOptions {
        PgConnectOptions::new_without_pgpass()
            .username("pinned_reader")
            .password("pinned-test-only")
            .database("relayed_store")
    }

    /// The handshake names the certificate its server presented, and the session sqlx opens on the
    /// private socket is the one the pinned server reads.
    #[tokio::test]
    async fn the_pinned_session_is_the_one_its_server_reads_and_names_the_certificate_presented() {
        let root = authority("pinned root");
        let (certificate, key) = server_certificate(&root);
        let expected_peer = sha256_identity(certificate.as_ref());
        let (port, startup) = serve(Server::Tls13, certificate, key).await;
        let pinned = PinnedPostgresRoot::from_pem(root.pem.as_bytes()).unwrap();

        let (connection, observed, relay) =
            connect_pinned("127.0.0.1", port, options(), &pinned, Some(&expected_peer))
                .await
                .unwrap();

        assert_eq!(
            observed,
            ObservedPinnedTls {
                peer_certificate_identity: expected_peer.clone(),
                protocol: PINNED_TLS_PROTOCOL,
                cipher: PINNED_TLS_CIPHER,
            }
        );
        let startup = startup.await.unwrap();
        let fields = startup[4..]
            .split(|byte| *byte == 0)
            .map(<[u8]>::to_vec)
            .collect::<Vec<_>>();
        assert!(
            fields
                .windows(2)
                .any(|pair| pair[0] == b"database" && pair[1] == b"relayed_store"),
            "the startup the pinned server read is the session sqlx opened"
        );
        drop(connection);
        drop(relay);
    }

    /// No session opens, and no byte of one reaches the server, unless the server completes TLS 1.3
    /// under the pinned root and presents the certificate expected.
    #[rstest]
    #[case::another_root(Server::Tls13, true, false, PinnedTlsError::TlsRefused)]
    #[case::the_server_refuses_tls(Server::RefusesTls, false, false, PinnedTlsError::TlsRefused)]
    #[case::the_server_offers_only_tls_1_2(
        Server::Tls12Only,
        false,
        false,
        PinnedTlsError::TlsRefused
    )]
    #[case::another_certificate_under_the_root(
        Server::Tls13,
        false,
        true,
        PinnedTlsError::UnexpectedPeer
    )]
    #[tokio::test]
    async fn no_byte_of_a_session_reaches_a_server_outside_the_pin(
        #[case] behaviour: Server,
        #[case] signed_by_another_root: bool,
        #[case] expect_another_certificate: bool,
        #[case] refusal: PinnedTlsError,
    ) {
        let pinned = authority("pinned root");
        let other = authority("another root");
        let issuer = if signed_by_another_root {
            &other
        } else {
            &pinned
        };
        let (certificate, key) = server_certificate(issuer);
        let (port, startup) = serve(behaviour, certificate, key).await;
        let root = PinnedPostgresRoot::from_pem(pinned.pem.as_bytes()).unwrap();
        let another_certificate = format!("sha256:{}", "0".repeat(64));
        let expected_peer = expect_another_certificate.then_some(another_certificate.as_str());

        assert_eq!(
            connect_pinned("127.0.0.1", port, options(), &root, expected_peer)
                .await
                .map(|_| ()),
            Err(refusal)
        );
        assert!(
            startup.await.is_err(),
            "the server read no startup message, so no byte of the session"
        );
    }

    #[rstest]
    fn only_a_file_of_exactly_one_certificate_pins_a_root() {
        let first = authority("first").pem;
        let second = authority("second").pem;
        let key = KeyPair::generate().unwrap().serialize_pem();

        assert!(PinnedPostgresRoot::from_pem(first.as_bytes()).is_ok());

        for refused in [
            String::new(),
            format!("{first}{second}"),
            format!("{first}{key}"),
            key,
        ] {
            assert_eq!(
                PinnedPostgresRoot::from_pem(refused.as_bytes()).map(|_| ()),
                Err(PinnedTlsError::InvalidRoot)
            );
        }
    }

    #[rstest]
    fn the_trust_policy_identity_is_the_pinned_root_and_nothing_else() {
        let root = authority("pinned root");
        let other = authority("another root");
        let pinned = PinnedPostgresRoot::from_pem(root.pem.as_bytes()).unwrap();

        assert_eq!(
            pinned.trust_policy_identity(),
            PinnedPostgresRoot::from_pem(root.pem.as_bytes())
                .unwrap()
                .trust_policy_identity()
        );
        assert_ne!(
            pinned.trust_policy_identity(),
            PinnedPostgresRoot::from_pem(other.pem.as_bytes())
                .unwrap()
                .trust_policy_identity()
        );
    }

    /// The socket exists only between the pinned handshake and the one session it accepts, in a
    /// directory only this process's user can enter; a bridge no session reaches leaves nothing.
    #[tokio::test]
    async fn the_socket_lives_for_one_session_in_a_private_directory() {
        let root = authority("pinned root");
        let pinned = PinnedPostgresRoot::from_pem(root.pem.as_bytes()).unwrap();

        // Accepted: the directory is private while the socket waits, and gone once it is used.
        let (certificate, key) = server_certificate(&root);
        let (port, startup) = serve(Server::Tls13, certificate, key).await;
        let bridge = Bridge::open("127.0.0.1", port, &pinned, None)
            .await
            .unwrap();
        let directory = bridge.socket_directory.path().to_owned();
        let socket = directory.join(format!(".s.PGSQL.{port}"));
        assert_eq!(
            std::fs::metadata(&directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert!(socket.exists());

        let relay = bridge.spawn();
        let connection = connect_with(&with_tls(
            options().socket(&directory).port(port),
            PostgresTls::Disabled,
        ))
        .await
        .unwrap();
        assert!(startup.await.is_ok());
        assert!(
            !directory.exists(),
            "the socket and its directory go with the one session they carried"
        );
        drop(connection);
        drop(relay);

        // Never reached: dropping the bridge, or the relay waiting on it, removes the directory.
        let (certificate, key) = server_certificate(&root);
        let (port, _) = serve(Server::Tls13, certificate, key).await;
        let bridge = Bridge::open("127.0.0.1", port, &pinned, None)
            .await
            .unwrap();
        let directory = bridge.socket_directory.path().to_owned();
        drop(bridge);
        assert!(!directory.exists());
        let (certificate, key) = server_certificate(&root);
        let (port, _) = serve(Server::Tls13, certificate, key).await;
        let bridge = Bridge::open("127.0.0.1", port, &pinned, None)
            .await
            .unwrap();
        let directory = bridge.socket_directory.path().to_owned();
        drop(bridge.spawn());

        for _ in 0..100 {
            if !directory.exists() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        assert!(!directory.exists(), "an aborted relay removes its socket");
    }

    /// Another process that reaches the socket first is carried nowhere: the relay closes its
    /// connection without a byte to or from the server, and the session it displaced fails rather
    /// than travel any other way.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn another_process_on_the_machine_cannot_use_the_bridge() {
        let root = authority("pinned root");
        let pinned = PinnedPostgresRoot::from_pem(root.pem.as_bytes()).unwrap();
        let (certificate, key) = server_certificate(&root);
        let (port, startup) = serve(Server::Tls13, certificate, key).await;
        let bridge = Bridge::open("127.0.0.1", port, &pinned, None)
            .await
            .unwrap();
        let directory = bridge.socket_directory.path().to_owned();
        let socket = directory.join(format!(".s.PGSQL.{port}"));

        let mut relay = bridge.spawn();

        // A separate process: it connects, writes, and reports how many bytes came back.
        let intruder = tokio::task::spawn_blocking(move || {
            std::process::Command::new("python3")
                .arg("-c")
                .arg(
                    "import socket, sys\n\
                     s = socket.socket(socket.AF_UNIX)\n\
                     s.connect(sys.argv[1])\n\
                     s.sendall(b'\\x00\\x00\\x00\\x08\\x04\\xd2\\x16\\x2f')\n\
                     print(len(s.recv(64)))",
                )
                .arg(&socket)
                .output()
                .unwrap()
        })
        .await
        .unwrap();

        assert!(intruder.status.success(), "{intruder:?}");
        assert_eq!(
            String::from_utf8(intruder.stdout).unwrap().trim(),
            "0",
            "the relay closed the other process's connection without answering"
        );
        assert_eq!(
            (&mut relay.0).await.unwrap(),
            Err(PinnedTlsError::ForeignPeer)
        );
        assert!(
            startup.await.is_err(),
            "nothing the other process wrote reached the server"
        );
        assert!(
            connect_with(&with_tls(
                options().socket(&directory).port(port),
                PostgresTls::Disabled,
            ))
            .await
            .is_err(),
            "the displaced session fails rather than reach the server some other way"
        );
    }
}
