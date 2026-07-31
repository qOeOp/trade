fn main() -> Result<(), Box<dyn std::error::Error>> {
    let protoc = protoc_bin_vendored::protoc_bin_path()?;
    // SAFETY: build scripts run single-threaded here, before tonic-build reads PROTOC.
    unsafe { std::env::set_var("PROTOC", protoc) };
    tonic_build::configure()
        .build_client(true)
        .build_server(true)
        .compile_protos(&["proto/l2_order_book.proto"], &["proto"])?;
    println!("cargo:rerun-if-changed=proto/l2_order_book.proto");
    Ok(())
}
