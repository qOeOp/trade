use anyhow::{Result, bail};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Config {
    pub symbol: String,
    pub output_base: PathBuf,
    pub listen: SocketAddr,
    pub queue_capacity: usize,
    pub segment_frames: usize,
    pub sync_every_frames: usize,
    pub max_book_levels: usize,
    pub stale_after_ms: u64,
    pub epoch_seconds: u64,
    pub duration_seconds: u64,
    pub yes_public_network: bool,
}

impl Config {
    pub fn parse(values: Vec<String>) -> Result<Self> {
        let mut value = Self {
            symbol: "BTCUSDT".to_string(),
            output_base: PathBuf::from("data/l2"),
            listen: SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 50_061),
            queue_capacity: 256,
            segment_frames: 1_000,
            sync_every_frames: 100,
            max_book_levels: 100_000,
            stale_after_ms: 2_000,
            epoch_seconds: 23 * 60 * 60 + 55 * 60,
            duration_seconds: 0,
            yes_public_network: false,
        };
        let mut index = 0;
        while index < values.len() {
            if values[index] == "--yes-public-network" {
                value.yes_public_network = true;
                index += 1;
                continue;
            }
            if index + 1 >= values.len() {
                bail!("incomplete argument: {}", values[index]);
            }
            let next = &values[index + 1];
            match values[index].as_str() {
                "--symbol" => value.symbol = next.clone(),
                "--output-base" => value.output_base = PathBuf::from(next),
                "--listen" => value.listen = next.parse()?,
                "--queue-capacity" => value.queue_capacity = next.parse()?,
                "--segment-frames" => value.segment_frames = next.parse()?,
                "--sync-every-frames" => value.sync_every_frames = next.parse()?,
                "--max-book-levels" => value.max_book_levels = next.parse()?,
                "--stale-after-ms" => value.stale_after_ms = next.parse()?,
                "--epoch-seconds" => value.epoch_seconds = next.parse()?,
                "--duration-seconds" => value.duration_seconds = next.parse()?,
                argument => bail!("unknown argument: {argument}"),
            }
            index += 2;
        }
        value.validate()?;
        Ok(value)
    }

    fn validate(&self) -> Result<()> {
        if !self
            .symbol
            .bytes()
            .all(|value| value.is_ascii_uppercase() || value.is_ascii_digit())
            || !(5..=20).contains(&self.symbol.len())
        {
            bail!("symbol must be an uppercase Binance symbol");
        }
        if !self.yes_public_network {
            bail!("production L2 requires explicit --yes-public-network");
        }
        if !self.listen.ip().is_loopback() {
            bail!("initial gRPC listener must be loopback-only");
        }
        if !(1..=1_000_000).contains(&self.queue_capacity)
            || !(1..=1_000_000).contains(&self.segment_frames)
            || !(1..=self.segment_frames).contains(&self.sync_every_frames)
            || !(2_000..=1_000_000).contains(&self.max_book_levels)
            || !(100..=60_000).contains(&self.stale_after_ms)
            || !(5..=86_400).contains(&self.epoch_seconds)
            || self.duration_seconds > 86_400
        {
            bail!("queue, segment, freshness, epoch, or duration bounds are invalid");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_network_is_explicit_and_listener_is_local() {
        assert!(Config::parse(Vec::new()).is_err());
        assert!(
            Config::parse(vec![
                "--yes-public-network".into(),
                "--listen".into(),
                "0.0.0.0:50061".into(),
            ])
            .is_err()
        );
        let config = Config::parse(vec!["--yes-public-network".into()]).expect("config");
        assert!(config.listen.ip().is_loopback());
    }
}
