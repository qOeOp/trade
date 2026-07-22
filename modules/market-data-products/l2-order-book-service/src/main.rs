use anyhow::{Context, Result, bail};
use std::env;
use std::time::Duration;
use tokio::sync::watch;
use tonic::transport::Server;
use tracing_subscriber::EnvFilter;
use trade_l2_order_book_service::collector;
use trade_l2_order_book_service::config::Config;
use trade_l2_order_book_service::grpc::GrpcService;
use trade_l2_order_book_service::proto::l2_order_book_server::L2OrderBookServer;
use trade_l2_order_book_service::state::SharedState;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .init();
    let config = Config::parse(env::args().skip(1).collect())?;
    let state = SharedState::new(config.symbol.clone());
    let grpc = GrpcService::new(state.clone(), config.stale_after_ms);
    let (shutdown_tx, shutdown_rx) = watch::channel(false);

    let server_shutdown = shutdown_rx.clone();
    let listen = config.listen;
    let mut server = tokio::spawn(async move {
        Server::builder()
            .add_service(L2OrderBookServer::new(grpc))
            .serve_with_shutdown(listen, wait_for_shutdown(server_shutdown))
            .await
            .context("gRPC server")
    });
    let collector_shutdown = shutdown_rx.clone();
    let collector_config = config.clone();
    let mut collector =
        tokio::spawn(
            async move { collector::run(collector_config, state, collector_shutdown).await },
        );

    let stop = async {
        if config.duration_seconds == 0 {
            tokio::signal::ctrl_c().await.context("ctrl-c")?;
        } else {
            tokio::time::sleep(Duration::from_secs(config.duration_seconds)).await;
        }
        Result::<()>::Ok(())
    };
    tokio::pin!(stop);

    tokio::select! {
        result = &mut collector => {
            shutdown_tx.send_replace(true);
            result.context("collector task join")??;
        }
        result = &mut server => {
            shutdown_tx.send_replace(true);
            result.context("server task join")??;
            bail!("gRPC server stopped before shutdown");
        }
        result = &mut stop => {
            result?;
            shutdown_tx.send_replace(true);
            collector.await.context("collector task join")??;
            server.await.context("server task join")??;
        }
    }
    Ok(())
}

async fn wait_for_shutdown(mut shutdown: watch::Receiver<bool>) {
    while !*shutdown.borrow() {
        if shutdown.changed().await.is_err() {
            return;
        }
    }
}
