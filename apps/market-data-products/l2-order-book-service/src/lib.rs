pub mod collector;
pub mod config;
pub mod grpc;
pub mod persistence;
pub mod state;

pub mod proto {
    tonic::include_proto!("trade.l2.v1");
}
