use std::hint::black_box;

use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use vibe_network::http::InnerHttpClient;

fn bench_send_request_roundtrip(c: &mut Criterion) {
    let mut group = c.benchmark_group("http/send_request_roundtrip");

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    let addr = rt.block_on(async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            let router = axum::Router::new().route("/", axum::routing::get(|| async { "ok" }));
            axum::serve(listener, router).await.unwrap();
        });

        addr
    });

    let url = format!("http://{addr}/");
    let client = InnerHttpClient::default();

    for label in ["GET_no_params", "GET_no_headers"] {
        group.bench_function(BenchmarkId::new("method", label), |b| {
            b.iter(|| {
                rt.block_on(async {
                    black_box(
                        client
                            .send_request(
                                reqwest::Method::GET,
                                black_box(url.clone()),
                                None,
                                None,
                                None,
                                None,
                            )
                            .await
                            .unwrap(),
                    )
                })
            });
        });
    }

    group.finish();
}

fn bench_send_request_with_headers(c: &mut Criterion) {
    let mut group = c.benchmark_group("http/send_request_with_headers");

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    let addr = rt.block_on(async {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            let router = axum::Router::new().route("/", axum::routing::get(|| async { "ok" }));
            axum::serve(listener, router).await.unwrap();
        });

        addr
    });

    let url = format!("http://{addr}/");
    let client = InnerHttpClient::default();

    for num_headers in [0, 2, 5, 10] {
        let headers: std::collections::HashMap<String, String> = (0..num_headers)
            .map(|i| (format!("x-custom-header-{i}"), format!("value-{i}")))
            .collect();

        let headers_opt = if headers.is_empty() {
            None
        } else {
            Some(headers)
        };

        group.bench_with_input(
            BenchmarkId::new("headers", num_headers),
            &headers_opt,
            |b, headers| {
                b.iter(|| {
                    rt.block_on(async {
                        black_box(
                            client
                                .send_request(
                                    reqwest::Method::GET,
                                    black_box(url.clone()),
                                    None,
                                    headers.clone(),
                                    None,
                                    None,
                                )
                                .await
                                .unwrap(),
                        )
                    })
                });
            },
        );
    }

    group.finish();
}

criterion_group!(
    benches,
    bench_send_request_roundtrip,
    bench_send_request_with_headers,
);
criterion_main!(benches);
